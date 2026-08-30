import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FrontendRequest } from "@missingstudio/eva-sdk"
import { Effect, Exit, Fiber, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { ASKING_PATH, askFrame } from "./ask.js"
import { serveWeb } from "./serve.js"

/**
 * The ask channel, over a real socket. What is proven is the honesty of the
 * `interactive: true` row: an ask is offered only while a page is reading, it
 * waits while one is, and it is cancelled the moment the last one goes.
 *
 * Nothing here answers the question. The answer travels the other way, through
 * `SessionAPI.answer`, and the gate races the two doors — so what this suite
 * sees is one door.
 *
 * What this suite reads is what this half wrote. The reader that judges a
 * frame is `plugins/api`'s, and a plugin may not import a plugin — so the
 * conformance suites are where the two halves meet.
 */

// The set one frame carries, or nothing when the text is not a frame of them.
const setIn = (text: string): readonly FrontendRequest[] | undefined => {
  try {
    return (JSON.parse(text) as { readonly asking?: readonly FrontendRequest[] }).asking
  } catch {
    return undefined
  }
}

const REQUEST = { kind: "permission", id: "call_1", question: "run git push?" } as const

const empty = (): string => mkdtempSync(join(tmpdir(), "eva-web-ask-"))

// One surface, bound on an ephemeral loopback port, with the address read back
// out of what it printed.
const serving = async () => {
  const said: string[] = []
  const scope = await Effect.runPromise(Scope.make())
  const frontend = await Effect.runPromise(
    Effect.provideService(
      serveWeb({
        root: empty(),
        bind: { host: "127.0.0.1", port: 0 },
        posture: "local",
        write: (text) => void said.push(text),
      }),
      Scope.Scope,
      scope,
    ),
  )
  return {
    frontend,
    url: said.join("").split(" ")[0] ?? "",
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

/**
 * A page, reading the stream. `frames` is every set it has been told, so a
 * question arriving and a question withdrawn are both visible to a test.
 */
const reading = async (url: string) => {
  const stopping = new AbortController()
  const response = await fetch(`${url}${ASKING_PATH}`, { signal: stopping.signal })
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
  const frames: (readonly FrontendRequest[])[] = []

  const pump = async () => {
    let held = ""
    for (;;) {
      const next = await reader?.read()
      if (next === undefined || next.done) return
      held += next.value
      const parts = held.split("\n\n")
      held = parts.pop() ?? ""
      for (const part of parts) {
        const asking = setIn(part.replace(/^data:/, "").trim())
        if (asking !== undefined) frames.push(asking)
      }
    }
  }
  void pump().catch(() => undefined)

  return {
    frames: () => frames,
    // The set the page last heard, once it has heard `count` of them.
    until: async (count: number) => {
      for (let tries = 0; tries < 200 && frames.length < count; tries += 1) {
        await new Promise((wake) => setTimeout(wake, 5))
      }
      return frames.at(-1)
    },
    stop: () => stopping.abort(),
  }
}

/**
 * Whether the ask has answered yet, without waiting on one that never will.
 * Joining is not interrupting: the fiber is left running, and only the wait on
 * it is given up.
 */
const settledOr = <A>(asked: Fiber.Fiber<A>, waiting: string) =>
  Effect.race(
    Effect.map(Fiber.join(asked), () => "answered"),
    Effect.as(Effect.sleep("20 millis"), waiting),
  )

describe("the frame this half writes", () => {
  // The whole set every time, so a page holds no bookkeeping and a page that
  // joined late reads the same frame as one that was there. Each question
  // carries the kind the gate asked it with.
  it("carries every question that stands, as one frame", () => {
    const asking: readonly FrontendRequest[] = [
      { kind: "permission", id: "call_1", question: "run git push?" },
      { kind: "question", id: "call_2", question: "which of the two?" },
    ]
    const frame = askFrame(asking)

    expect(frame.endsWith("\n\n")).toBe(true)
    expect(setIn(frame.replace(/^data:/, "").trim())).toEqual(asking)
  })
})

describe("an ask with no page open", () => {
  /**
   * The row says `interactive: true`, and this is what makes that honest. A
   * surface that took the ask and held it would stop the Run on a reader who
   * was never there.
   */
  it("is cancelled at once, so the gate denies rather than waits", async () => {
    const served = await serving()
    const answer = await Effect.runPromise(served.frontend.ask(REQUEST))

    expect(answer).toEqual({ kind: "cancelled" })
    await served.close()
  })
})

describe("an ask with a page open", () => {
  it("reaches the page and waits", async () => {
    const served = await serving()
    const page = await reading(served.url)
    expect(await page.until(1)).toEqual([])

    const asked = Effect.runFork(served.frontend.ask(REQUEST))
    expect(await page.until(2)).toEqual([REQUEST])
    // Still waiting: the answer comes back over the socket, not from here.
    expect(await Effect.runPromise(settledOr(asked, "waiting"))).toBe("waiting")

    await Effect.runPromise(Fiber.interrupt(asked))
    page.stop()
    await served.close()
  })

  /**
   * The question is withdrawn the moment the ask ends, however it ended. The
   * gate races two doors, so the answer that landed at the other one
   * interrupts this — and the page hears the smaller set, which is what
   * retires its card.
   */
  it("withdraws the question when the other door answers", async () => {
    const served = await serving()
    const page = await reading(served.url)
    const asked = Effect.runFork(served.frontend.ask(REQUEST))
    await page.until(2)

    await Effect.runPromise(Fiber.interrupt(asked))

    expect(await page.until(3)).toEqual([])
    page.stop()
    await served.close()
  })

  // A page that goes away has nobody behind it, so the ask is cancelled then
  // rather than held for a reader who has gone.
  it("is cancelled when the last page goes", async () => {
    const served = await serving()
    const page = await reading(served.url)
    const asked = Effect.runFork(served.frontend.ask(REQUEST))
    await page.until(2)

    page.stop()

    expect(await Effect.runPromise(Fiber.join(asked))).toEqual({ kind: "cancelled" })
    await served.close()
  })
})

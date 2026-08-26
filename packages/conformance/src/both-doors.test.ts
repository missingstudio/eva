import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apiWire } from "@missingstudio/eva-api"
import { httpTransport } from "@missingstudio/eva-api/client"
import { boot, buildOf, makeSessionAPI, overSurface, type Kernel } from "@missingstudio/eva-boot"
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"
import {
  PERMISSION_OPTIONS,
  type ModelRef,
  type PermissionRequest,
  type ToolCall,
} from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import type { Frontend } from "@missingstudio/eva-sdk"
import { makeWeb, WEB_SURFACE } from "@missingstudio/eva-web"
import { watchAsking, type AskedQuestion } from "@missingstudio/eva-web/client"
import { Effect, Exit, Fiber, Scope } from "effect"
import { describe, expect, it } from "vitest"

/**
 * Both doors of one permission request, over a real socket.
 *
 * The gate races two answers to one question: `Frontend.ask`, the direct call
 * to the surface Eva holds, and `SessionAPI.answer`, which is how a surface at
 * the end of a socket answers by naming the request. This is the second door,
 * driven by the code the page really runs: `eva.web`'s ask channel to read the
 * question, and `eva.api`'s HTTP transport to answer it.
 *
 * A plugin may not import a plugin, so this is where `eva.web` and `eva.api`
 * meet — the two halves of one port, as the composition root joins them.
 *
 * What the terminal does when this door wins is `plugins/tui`'s own suite: its
 * `ask` is interrupted, and that interrupt retires the prompt.
 */

const MODEL: ModelRef = { provider: "anthropic", model: "claude-sonnet-4-5" }
const SESSION = sessionID("sess_doors")
const CALL = "call_1"
const QUESTION = "edit may change something. Run it?"

const request: PermissionRequest = {
  sessionId: SESSION,
  toolCall: { toolCallId: CALL, title: QUESTION },
  options: PERMISSION_OPTIONS,
}

const call: ToolCall = { id: CALL, name: "edit", args: {}, session: SESSION }

/**
 * One `eva.web` surface, bound on an ephemeral loopback port, with `eva.api`
 * answering beside it — and a live Session API behind both. The surface is
 * read through a cell rather than captured, because it is started after the
 * API it answers through is built.
 */
const bench = async () => {
  const said: string[] = []
  const scope = await Effect.runPromise(Scope.make())
  const web = makeWeb({
    assets: () => mkdtempSync(join(tmpdir(), "eva-doors-")),
    host: "127.0.0.1",
    port: 0,
    write: (text) => void said.push(text),
    api: (client) => apiWire(client.api),
  })

  const started = await Effect.runPromise(
    Effect.gen(function* () {
      const kernel: Kernel = yield* boot({
        scope,
        resolved: [{ id: WEB_SURFACE }],
        build: buildOf([web]),
      })
      const api = yield* makeSessionAPI(kernel, MODEL, scope)
      const client = yield* makeClient(yield* localTransport(api.session))
      const rows = yield* kernel.domains.surface.get
      const row = rows.find((one) => one.id === WEB_SURFACE)
      if (row?.start === undefined) throw new Error("no eva.web row")
      const surface = yield* Effect.provideService(row.start(client), Scope.Scope, scope)
      return { kernel, api, surface }
    }),
  )

  let surface: Frontend | undefined = started.surface
  const url = said.join("").split(" ")[0] ?? ""

  // The page's own two halves: the surface's ask channel, and the wire.
  const heard: (readonly AskedQuestion[])[] = []
  const stopReading = watchAsking((asking) => void heard.push(asking), { origin: url })
  const page = await Effect.runPromise(Effect.flatMap(httpTransport({ origin: url }), makeClient))

  const asking = overSurface(started.kernel, {
    frontend: Effect.sync(() => surface),
    request: started.api.request,
  })

  // The set the page last heard, once it holds what the caller is waiting for.
  const until = async (holds: (asking: readonly AskedQuestion[]) => boolean) => {
    for (let tries = 0; tries < 400; tries += 1) {
      const last = heard.at(-1)
      if (last !== undefined && holds(last)) return last
      await new Promise((wake) => setTimeout(wake, 5))
    }
    return heard.at(-1)
  }

  /**
   * The page is reading before anything is asked. It is the presence signal as
   * well as the channel, so an ask offered before the stream is open would be
   * declined for the honest reason that nobody was there yet.
   */
  await until(() => true)

  return {
    url,
    page,
    standing: () => heard.at(-1),
    // The question that stands, once the page has heard of it.
    asked: () => until((asking) => asking.length > 0),
    // Nothing standing, once the page has heard the question withdrawn.
    nothing: () => until((asking) => asking.length === 0),
    // One ask, on a fiber, so a test can answer it from the other side.
    ask: () => Effect.runFork(asking(request, call)),
    // Nobody at this surface, so the direct door cannot answer.
    close: async () => {
      surface = undefined
      stopReading()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

// Whether the ask has answered yet, without waiting on one that never will.
// Joining is not interrupting: the fiber is left running.
const settledOr = <A>(asked: Fiber.Fiber<A>) =>
  Effect.race(
    Effect.map(Fiber.join(asked), (answered) => ({ answered })),
    Effect.as(Effect.sleep("30 millis"), { answered: undefined }),
  )

describe("a permission request the page answers", () => {
  /**
   * The proof scene: the Run streams, a permission request appears on the
   * page, and the page answers it. The id the page names is the tool call's,
   * which is why the request needs nothing else to be answerable from a
   * screen that is only watching.
   */
  it("reaches the page, and the page's answer is the one the gate reads", async () => {
    const desk = await bench()
    const asked = desk.ask()

    expect(await desk.asked()).toEqual([{ id: CALL, question: QUESTION }])

    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }),
    )

    expect(await Effect.runPromise(Fiber.join(asked))).toEqual({ kind: "allow_once" })
    await desk.close()
  })

  // A refusal travels the same way, and it words itself: a gate that denies
  // always says why.
  it("carries a refusal the same way", async () => {
    const desk = await bench()
    const asked = desk.ask()
    await desk.asked()

    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "reject_always" }),
    )

    expect(await Effect.runPromise(Fiber.join(asked))).toEqual({
      kind: "reject_always",
      reason: `a person refused: ${QUESTION}`,
    })
    await desk.close()
  })

  /**
   * The card retires by itself. The question is withdrawn from the stream the
   * moment the ask ends, so a page cannot go on offering four buttons for a
   * question that has been answered — which is the other half of "the first
   * answer wins".
   */
  it("withdraws the question from the page once it is answered", async () => {
    const desk = await bench()
    const asked = desk.ask()
    await desk.asked()

    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }),
    )
    await Effect.runPromise(Fiber.join(asked))

    expect(await desk.nothing()).toEqual([])
    await desk.close()
  })

  /**
   * The second answer is refused as already answered, and the refusal is
   * silence: a surface that reconnects and replays a stale answer must not
   * stop Eva, so `SessionAPI.answer` drops one for a request that is not open.
   *
   * What makes that refusal real rather than a leak is that the request is
   * closed at both doors when one answers. So the stale answer cannot reach
   * the next request that carries the same id — a call id is reused across
   * Runs, and an answer nobody gave is worse than one nobody heard.
   */
  it("drops a second answer, and it cannot reach the next request of that id", async () => {
    const desk = await bench()
    const first = desk.ask()
    await desk.asked()

    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }),
    )
    expect(await Effect.runPromise(Fiber.join(first))).toEqual({ kind: "allow_once" })

    // The stale one. It answers nothing and it stops nothing.
    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "reject_always" }),
    )

    const next = desk.ask()
    await desk.asked()
    expect(await Effect.runPromise(settledOr(next))).toEqual({ answered: undefined })

    await Effect.runPromise(Fiber.interrupt(next))
    await desk.close()
  })
})

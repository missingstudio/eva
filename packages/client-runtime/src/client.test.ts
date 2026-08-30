import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import { makeClient } from "./client.js"
import { CLAIM, CLOSE, fakeApi, given, PROMPT, SESSION, spoken, text } from "./fake-api.js"
import type { RunSignal } from "./run.js"
import { droppableTransport, localTransport } from "./transport.js"

const BOUND = 5

describe("the handle a surface holds", () => {
  it("carries the contract through, unchanged", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([])
        const client = yield* makeClient(yield* localTransport(fake.api))
        expect(client.api).toBe(fake.api)
        // A pipe that is there is a runtime with nothing to catch up on.
        expect(yield* SubscriptionRef.get(client.state)).toBe("ready")
      }),
    )
  })

  /**
   * The handle outlives the call that made it: a surface makes one Client and
   * holds it for as long as it is drawn. So the watcher that turns the pipe's
   * health into the state a surface reads is not supervised by that call — a
   * page that made a Client and then went idle would otherwise never hear
   * that the pipe had gone.
   */
  it("says the pipe is gone after the call that made the handle has ended", async () => {
    const fake = await Effect.runPromise(fakeApi([]))
    const transport = await Effect.runPromise(droppableTransport(fake.api))
    const client = await Effect.runPromise(makeClient(transport))

    await Effect.runPromise(transport.drop)
    await Effect.runPromise(
      Effect.asVoid(
        Stream.runHead(
          Stream.filter(SubscriptionRef.changes(client.state), (one) => one === "disconnected"),
        ),
      ),
    )

    expect(await Effect.runPromise(SubscriptionRef.get(client.state))).toBe("disconnected")
  })

  it("runs the protocol, and the record it gives back is the Run's own", async () => {
    const seen: RunSignal[] = []
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        const client = yield* makeClient(yield* localTransport(fake.api))
        const record = yield* client.run(SESSION, PROMPT, (one) => void seen.push(one), {
          settle: BOUND,
        })
        expect(given(fake, "submit")).toEqual([[SESSION, PROMPT]])
        return record
      }),
    )

    expect(seen).toEqual([
      { kind: "payload", payload: text("par") },
      { kind: "payload", payload: text("tial") },
      { kind: "payload", payload: CLOSE },
    ])
    expect(spoken(outcome.transcript)).toBe("partial")
    // The Run opened with the person's line, said two words, and closed.
    expect(outcome.transcript.at).toEqual({ session: SESSION, seq: 4 })
    expect(outcome.answer).toEqual({ claim: CLAIM, text: "partial" })
  })
})

/**
 * A Session watched rather than opened. The page held this protocol until the
 * handle had a member for it, and the rule is the runtime's: fold, watch to the
 * close of the Run that is open, fold again.
 */
describe("a Session the handle follows", () => {
  const until = Effect.fn("test.until")(function* (what: string, holds: () => boolean) {
    for (let turn = 0; turn < 1000 && !holds(); turn += 1) yield* Effect.yieldNow
    expect([what, holds()]).toEqual([what, true])
  })

  const folds = (seen: readonly RunSignal[]): number =>
    seen.filter((one) => one.kind === "folded").length

  it("folds first, hears the live words, and folds again when the Run closes", async () => {
    const seen: RunSignal[] = []
    const walked = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        const client = yield* makeClient(yield* localTransport(fake.api))
        const said: string[] = []
        yield* Effect.forkChild(
          Stream.runForEach(SubscriptionRef.changes(client.state), (one) =>
            Effect.sync(() => void said.push(one)),
          ),
        )

        const following = yield* Effect.forkChild(
          client.follow(SESSION, (one) => void seen.push(one)),
        )
        // The record is folded before anything is said, which is what a page
        // opening on a Session that is already running gets.
        yield* until("the first fold", () => folds(seen) === 1)

        yield* client.api.submit(SESSION, PROMPT)
        // The Run closed, so the fold replaces the stream it was reading.
        yield* until("the fold after the close", () => folds(seen) === 2)

        yield* Fiber.interrupt(following)
        return said
      }),
    )

    // Every word of the Run reached the caller as a payload of the live
    // stream, and the close came with it.
    const heard = seen.filter((one) => one.kind === "payload")
    expect(heard.some((one) => one.kind === "payload" && one.payload.kind === "finished")).toBe(
      true,
    )

    /**
     * Nothing about the pipe. A Run that closed is the ordinary course, so the
     * fold that replaces its stream is not a recovery — a surface told it was
     * synchronizing at the end of every Run would be told about a drop that
     * never happened.
     */
    expect(walked).not.toContain("synchronizing")
  })

  /**
   * Whether a Run is open rides beside every signal, read off the payloads
   * that bracket one — whichever door opened it. The surface takes the word
   * rather than reading the stream a second time for itself.
   */
  it("says a Run is open beside every signal, whichever door opened it", async () => {
    const seen: { kind: string; running: boolean }[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([], "silent")
        const client = yield* makeClient(yield* localTransport(fake.api))
        const following = yield* Effect.forkChild(
          client.follow(SESSION, (one, running) => void seen.push({ kind: one.kind, running })),
        )
        yield* until("the first fold", () => seen.length === 1)
        yield* fake.say({ kind: "started", intent: "ask" })
        yield* until("the open Run", () => seen.at(-1)?.running === true)
        yield* fake.say(CLOSE)
        yield* until("the close", () => seen.at(-1)?.running === false)
        yield* Fiber.interrupt(following)
      }),
    )

    // The fold before anything ran says nothing is open.
    expect(seen[0]).toEqual({ kind: "folded", running: false })
  })

  // The reader is counted while it reads, so a restore does not say `ready`
  // over a reader that is still catching up.
  it("gives the state back to the pipe when it stops", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([])
        const client = yield* makeClient(yield* localTransport(fake.api))
        const following = yield* Effect.forkChild(client.follow(SESSION, () => {}))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(following)
        expect(yield* SubscriptionRef.get(client.state)).toBe("ready")
      }),
    )
  })
})

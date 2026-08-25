import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import { makeClient } from "./client.js"
import { CLOSE, fakeApi, given, PROMPT, SESSION, spoken, text, type Fake } from "./fake-api.js"
import type { ClientState, RunSignal } from "./run.js"
import { droppableTransport } from "./transport.js"

const BOUND = 5

/**
 * What a surface shows, kept the way a surface keeps it: a payload adds to
 * what is on screen, and a fold replaces it. Reading the two through one
 * queue is what says nothing was lost and nothing arrived twice — the record
 * is coarser than the live deltas, so counting payloads alone would not.
 */
const shownOf = (signals: readonly RunSignal[]): string =>
  signals.reduce(
    (shown, signal) =>
      signal.kind === "folded"
        ? spoken(signal.transcript)
        : signal.payload.kind === "text" && signal.payload.content.type === "text"
          ? shown + signal.payload.content.text
          : shown,
    "",
  )

const foldsIn = (signals: readonly RunSignal[]): number =>
  signals.filter((one) => one.kind === "folded").length

// One value per change. A ref set to what it already holds says nothing new,
// so a repeat is not a step of the walk.
const steps = (walked: readonly ClientState[]): readonly ClientState[] =>
  walked.filter((one, at) => one !== walked[at - 1])

/**
 * The first moment a condition holds. A bounded poll rather than a fixed
 * pause, because a fixed pause misses on a loaded host — and the poll sleeps
 * rather than yielding, because a turn count alone never lets the world's own
 * timers run.
 */
const until = Effect.fn("test.until")(function* (what: string, holds: () => boolean) {
  for (let turn = 0; turn < 1000 && !holds(); turn += 1) yield* Effect.sleep("2 millis")
  expect([what, holds()]).toEqual([what, true])
})

const stateAt = (state: SubscriptionRef.SubscriptionRef<ClientState>, want: ClientState) =>
  until(`state ${want}`, () => SubscriptionRef.getUnsafe(state) === want)

// The watch is running once the API behind the seam has a live subscription.
const subscribed = (fake: Fake) => until("a live watch", () => fake.open() > 0)

describe("a dropped connection", () => {
  it("costs a repaint, and every committed payload reaches the caller once", async () => {
    const seen: RunSignal[] = []
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        // The Run says nothing of its own: this test moves the Trace, so it
        // decides what commits while the pipe is down.
        const fake = yield* fakeApi([], "waits")
        const transport = yield* droppableTransport(fake.api)
        const client = yield* makeClient(transport)

        const running = yield* Effect.forkChild(
          client.run(SESSION, PROMPT, (one) => void seen.push(one), { settle: BOUND }),
        )
        yield* subscribed(fake)
        yield* fake.say(text("par"))
        yield* fake.say(text("tial"))
        yield* until("the live words", () => shownOf(seen) === "partial")

        // The pipe goes while the Run is open, and the Trace moves without
        // it: what commits now is what a live watch would have missed.
        yield* transport.drop
        yield* stateAt(client.state, "disconnected")
        yield* fake.say(text(" work"))

        yield* transport.restore
        yield* until("one repaint", () => foldsIn(seen) === 1)
        yield* stateAt(client.state, "ready")

        // The close commits after the resumed watch, so it arrives on the
        // stream rather than in the record.
        yield* fake.release
        const record = yield* Fiber.join(running)
        return { record, watched: given(fake, "watch") }
      }),
    )

    // The live deltas, then one fold, then the committed groups after it.
    expect(foldsIn(seen)).toBe(1)
    expect(shownOf(seen)).toBe("partial work")
    expect(spoken(found.record)).toBe("partial work")
    // The close reaches the caller once, through whichever side wins.
    expect(seen.filter((one) => one.kind === "payload" && one.payload.kind === "finished")).toEqual(
      [{ kind: "payload", payload: CLOSE }],
    )
    // The resumed watch names the fold's own position, and nothing else.
    expect(found.watched).toEqual([[SESSION], [SESSION, { session: SESSION, seq: 3 }]])
  })

  it("folds again when the resumed watch refuses, and says nothing of the refusal", async () => {
    const seen: RunSignal[] = []
    const record = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([], "waits")
        const transport = yield* droppableTransport(fake.api)
        const client = yield* makeClient(transport)

        // The head moves past the bound between the fold and the watch,
        // once. The answer is the one the Session API names: fold fresh
        // again, and watch from the new position.
        fake.refuse(1)
        const running = yield* Effect.forkChild(
          client.run(SESSION, PROMPT, (one) => void seen.push(one), { settle: BOUND }),
        )
        yield* subscribed(fake)
        yield* fake.say(text("par"))
        yield* fake.say(text("tial"))
        yield* until("the live words", () => shownOf(seen) === "partial")

        yield* transport.drop
        yield* stateAt(client.state, "disconnected")
        yield* fake.say(text(" work"))
        yield* transport.restore

        yield* until("two repaints", () => foldsIn(seen) === 2)
        yield* stateAt(client.state, "ready")
        yield* fake.release
        return yield* Fiber.join(running)
      }),
    )

    // One more repaint, and no error: the refusal never leaves the runtime.
    expect(foldsIn(seen)).toBe(2)
    expect(shownOf(seen)).toBe("partial work")
    expect(spoken(record)).toBe("partial work")
  })

  /**
   * What a surface subscribed to `state` really sees. The refusal is decided
   * on the resumed watch's first pull, so `ready` is read for that pull and
   * the loop returns to `synchronizing`: one repaint per fold, and the walk
   * repeats rather than holding.
   */
  it("says synchronizing before every fold, and ready after it", async () => {
    const seen: RunSignal[] = []
    const walked: ClientState[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([], "waits")
        const transport = yield* droppableTransport(fake.api)
        const client = yield* makeClient(transport)
        const watching = yield* Effect.forkChild(
          Stream.runForEach(SubscriptionRef.changes(client.state), (one) =>
            Effect.sync(() => void walked.push(one)),
          ),
        )

        // Two refusals, so what this proves is the loop and not one retry.
        fake.refuse(2)
        const running = yield* Effect.forkChild(
          client.run(SESSION, PROMPT, (one) => void seen.push(one), { settle: BOUND }),
        )
        yield* subscribed(fake)
        yield* fake.say(text("par"))
        yield* until("the live word", () => shownOf(seen) === "par")

        yield* transport.drop
        yield* stateAt(client.state, "disconnected")
        yield* transport.restore

        yield* until("three repaints", () => foldsIn(seen) === 3)
        yield* stateAt(client.state, "ready")
        yield* fake.release
        yield* Fiber.join(running)
        yield* Fiber.interrupt(watching)
      }),
    )

    // A refusal costs a fold, and a fold costs a repaint. Three folds, three
    // walks, and the caller never saw an error.
    expect(steps(walked)).toEqual([
      "ready",
      "disconnected",
      "synchronizing",
      "ready",
      "synchronizing",
      "ready",
      "synchronizing",
      "ready",
    ])
  })

  it("walks ready to disconnected to ready while no Run is open, and folds at nobody", async () => {
    const walked = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([])
        const transport = yield* droppableTransport(fake.api)
        const client = yield* makeClient(transport)

        const at: ClientState[] = [yield* SubscriptionRef.get(client.state)]
        yield* transport.drop
        yield* stateAt(client.state, "disconnected")
        at.push(yield* SubscriptionRef.get(client.state))

        yield* transport.restore
        yield* stateAt(client.state, "ready")
        at.push(yield* SubscriptionRef.get(client.state))
        return { at, folded: given(fake, "attach") }
      }),
    )

    expect(walked.at).toEqual(["ready", "disconnected", "ready"])
    // Nothing was open, so there was nothing to catch up on.
    expect(walked.folded).toEqual([])
  })
})

import type { Payload } from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import {
  CLAIM,
  CLOSE,
  fakeApi,
  given,
  PROMPT,
  SESSION,
  spoken,
  text,
  type Fake,
} from "./fake-api.js"
import { runPrompt, SETTLE, type ClientState, type RunSignal } from "./run.js"
import { localTransport } from "./transport.js"

// A drain bound short enough that a suite reaches the stop, and far enough
// below SETTLE that reaching it proves the injected bound is the one used.
const BOUND = 5

// What the protocol runs over, and where it says how it is doing. The local
// filler never drops, so these tests are about the four steps alone.
const over = Effect.fn("test.over")(function* (fake: Fake) {
  return {
    transport: yield* localTransport(fake.api),
    state: yield* SubscriptionRef.make<ClientState>("ready"),
    session: SESSION,
  }
})

const payloads = (signals: readonly RunSignal[]): readonly Payload[] =>
  signals.flatMap((one) => (one.kind === "payload" ? [one.payload] : []))

describe("one Run, over the Session API", () => {
  it("hands every payload to `each`, once, in order", async () => {
    const seen: RunSignal[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        yield* runPrompt(yield* over(fake), PROMPT, (one) => void seen.push(one), {
          settle: BOUND,
        })
        expect(given(fake, "submit")).toEqual([[SESSION, PROMPT]])
      }),
    )

    // The close reaches `each` too: it carries the Claim, which is the one
    // thing a Run says that the stream alone can report.
    expect(payloads(seen)).toEqual([text("par"), text("tial"), CLOSE])
    // Nothing dropped, so nothing was refolded at anyone.
    expect(seen.filter((one) => one.kind === "folded")).toEqual([])
  })

  it("returns the record's own fold, `at` included, and what the Run answered", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        return yield* runPrompt(yield* over(fake), PROMPT, () => {}, { settle: BOUND })
      }),
    )

    expect(outcome.transcript.session).toBe(SESSION)
    // Two words and the close: the position a reconnect resumes from.
    expect(outcome.transcript.at).toEqual({ session: SESSION, seq: 3 })
    expect(spoken(outcome.transcript)).toBe("partial")
    // The Answer is the record's own fold, not the stream scraped a second
    // time: the Claim the Run closed with, and the words that Run said.
    expect(outcome.answer).toEqual({ claim: CLAIM, text: "partial" })
  })

  it("returns once `submit` has, even when the watch never says `finished`", async () => {
    const started = Date.now()
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")], "silent")
        return yield* runPrompt(yield* over(fake), PROMPT, () => {}, { settle: BOUND })
      }),
    )

    // The drain stopped on the injected bound rather than on the default,
    // and never on the close that was not coming.
    expect(Date.now() - started).toBeLessThan(SETTLE)
    expect(outcome.transcript.at).toEqual({ session: SESSION, seq: 2 })
    // A Run that never closed answered no Claim, and the words it did say
    // are still the record's.
    expect(outcome.answer).toEqual({ text: "" })
  })

  it("cancels the Run when it is interrupted, and the record still folds", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")], "hangs")
        const running = yield* Effect.forkChild(
          runPrompt(yield* over(fake), PROMPT, () => {}, { settle: BOUND }),
        )
        yield* Deferred.await(fake.said)
        yield* Fiber.interrupt(running)
        return {
          cancelled: given(fake, "cancel"),
          record: yield* Effect.scoped(fake.api.attach(SESSION)),
        }
      }),
    )

    expect(found.cancelled).toEqual([[SESSION, "user"]])
    expect(spoken(found.record)).toBe("partial")
  })

  it("drains for two seconds unless a caller says otherwise", () => {
    expect(SETTLE).toBe(2000)
  })
})

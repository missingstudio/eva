import type { Payload } from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { CLOSE, fakeApi, given, PROMPT, SESSION, spoken, text } from "./fake-api.js"
import { runPrompt, SETTLE } from "./run.js"

// A drain bound short enough that a suite reaches the stop, and far enough
// below SETTLE that reaching it proves the injected bound is the one used.
const BOUND = 5

describe("one Run, over the Session API", () => {
  it("hands every payload to `each`, once, in order", async () => {
    const seen: Payload[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        yield* runPrompt(fake.api, SESSION, PROMPT, (one) => void seen.push(one), {
          settle: BOUND,
        })
        expect(given(fake, "submit")).toEqual([[SESSION, PROMPT]])
      }),
    )

    // The close reaches `each` too: it carries the Claim, which is the one
    // thing a Run says that the stream alone can report.
    expect(seen).toEqual([text("par"), text("tial"), CLOSE])
  })

  it("returns the record's own fold, `at` included", async () => {
    const transcript = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        return yield* runPrompt(fake.api, SESSION, PROMPT, () => {}, { settle: BOUND })
      }),
    )

    expect(transcript.session).toBe(SESSION)
    // Two words and the close: the position a reconnect resumes from.
    expect(transcript.at).toEqual({ session: SESSION, seq: 3 })
    expect(spoken(transcript)).toBe("partial")
  })

  it("returns once `submit` has, even when the watch never says `finished`", async () => {
    const started = Date.now()
    const transcript = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")], "silent")
        return yield* runPrompt(fake.api, SESSION, PROMPT, () => {}, { settle: BOUND })
      }),
    )

    // The drain stopped on the injected bound rather than on the default,
    // and never on the close that was not coming.
    expect(Date.now() - started).toBeLessThan(SETTLE)
    expect(transcript.at).toEqual({ session: SESSION, seq: 2 })
  })

  it("cancels the Run when it is interrupted, and the record still folds", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")], "hangs")
        const running = yield* Effect.forkChild(
          runPrompt(fake.api, SESSION, PROMPT, () => {}, { settle: BOUND }),
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

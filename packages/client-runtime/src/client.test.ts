import { Effect, SubscriptionRef } from "effect"
import { describe, expect, it } from "vitest"
import { makeClient } from "./client.js"
import { CLAIM, CLOSE, fakeApi, given, PROMPT, SESSION, spoken, text } from "./fake-api.js"
import type { RunSignal } from "./run.js"
import { localTransport } from "./transport.js"

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

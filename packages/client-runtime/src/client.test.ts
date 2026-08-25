import type { Payload } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeClient } from "./client.js"
import { CLOSE, fakeApi, given, PROMPT, SESSION, spoken, text } from "./fake-api.js"

const BOUND = 5

describe("the handle a surface holds", () => {
  it("carries the contract through, unchanged", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([])
        expect(makeClient(fake.api).api).toBe(fake.api)
      }),
    )
  })

  it("runs the protocol, and the record it gives back is the Run's own", async () => {
    const seen: Payload[] = []
    const transcript = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* fakeApi([text("par"), text("tial")])
        const client = makeClient(fake.api)
        const record = yield* client.run(SESSION, PROMPT, (one) => void seen.push(one), {
          settle: BOUND,
        })
        expect(given(fake, "submit")).toEqual([[SESSION, PROMPT]])
        return record
      }),
    )

    expect(seen).toEqual([text("par"), text("tial"), CLOSE])
    expect(spoken(transcript)).toBe("partial")
    expect(transcript.at).toEqual({ session: SESSION, seq: 3 })
  })
})

import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { tracePostgres, URL_VARIABLE } from "./index.js"

/**
 * The plugin half, which needs no server: what it does when config names no
 * database. It is the only sink whose plugin can decline to fill its Slot,
 * so the declining is worth a test of its own — an empty Slot is what makes
 * a Run say `degraded`, and a plugin that guessed at a localhost instead
 * would write a Trace nobody asked for.
 */
describe("the postgres plugin without a url", () => {
  it("leaves the slot empty rather than guessing at a server", async () => {
    const found = await withPlugin(tracePostgres, (kernel) =>
      Effect.gen(function* () {
        return yield* kernel.slot.traceSink.peek
      }),
    )
    expect(found).toBeUndefined()
  })

  it("reads the url from the environment when config carries none", async () => {
    const held = process.env[URL_VARIABLE]
    process.env[URL_VARIABLE] = ""
    try {
      const found = await withPlugin(tracePostgres, (kernel) =>
        Effect.gen(function* () {
          return yield* kernel.slot.traceSink.peek
        }),
      )
      expect(found).toBeUndefined()
    } finally {
      if (held === undefined) delete process.env[URL_VARIABLE]
      else process.env[URL_VARIABLE] = held
    }
  })
})

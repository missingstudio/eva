import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { sandboxNone } from "./index.js"

describe("the sandbox-none plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(sandboxNone.id).toBe("eva.sandbox.none")
  })

  it("fills the Sandbox slot and enforces nothing", async () => {
    const found = await withPlugin(sandboxNone, (kernel) =>
      Effect.gen(function* () {
        const sandbox = yield* kernel.slot.sandbox.get
        return yield* sandbox.capabilities
      }),
    )

    expect(found).toEqual({ enforces: [] })
  })

  it("empties the slot when it unloads", async () => {
    const found = await withPlugin(sandboxNone, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.sandbox.none")
        return yield* kernel.slot.sandbox.peek
      }),
    )

    expect(found).toBeUndefined()
  })
})

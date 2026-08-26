import type { DiffApplier } from "@missingstudio/eva-core"
import { define } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { diff } from "./index.js"

/**
 * Through a live kernel, because the half that matters is the effect body: a
 * plugin whose id is right and whose effect fills nothing looks identical
 * from outside until something reads the slot.
 */
describe("the diff plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(diff.id).toBe("eva.diff")
  })

  it("fills the DiffApplier slot", async () => {
    const found = await withPlugin(diff, (kernel) => kernel.slot.diffApplier.peek)

    expect(found?.preview).toBeTypeOf("function")
    expect(found?.apply).toBeTypeOf("function")
    expect(found?.reverse).toBeTypeOf("function")
  })

  it("empties the slot when it unloads", async () => {
    const found = await withPlugin(diff, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.diff")
        return yield* kernel.slot.diffApplier.peek
      }),
    )

    expect(found).toBeUndefined()
  })

  it("is replaced by a second plugin providing the same slot", async () => {
    const stub: DiffApplier = {
      preview: () => Effect.succeed({ path: "a.ts", base: "", after: "", hunks: 0 }),
      apply: () => Effect.succeed({ path: "a.ts", before: "", wrote: "" }),
      reverse: () => Effect.succeed({ path: "a.ts", before: "", wrote: "" }),
    }
    const second = define({
      id: "acme.diff",
      effect: Effect.fn(function* (ctx) {
        yield* ctx.slot.diffApplier.provide(ctx.id, stub)
      }),
    })

    const found = await withPlugin(second, (kernel) => kernel.slot.diffApplier.get, {
      before: [diff],
    })

    expect(found).toBe(stub)
  })
})

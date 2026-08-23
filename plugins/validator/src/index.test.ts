import type { Validator } from "@missingstudio/eva-core"
import { define } from "@missingstudio/eva-sdk"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { validator } from "./index.js"

/**
 * Through a live kernel, because the half that matters is the effect body:
 * a plugin whose id is right and whose effect fills nothing looks identical
 * from outside until something reads the slot.
 */
describe("the validator plugin", () => {
  it("carries the id the kernel registers it under", () => {
    expect(validator.id).toBe("eva.validator")
  })

  it("fills the Validator slot", async () => {
    const found = await withPlugin(validator, (kernel) => kernel.slot.validator.peek)

    expect(found?.accepts).toBeTypeOf("function")
    expect(found?.check).toBeTypeOf("function")
  })

  it("empties the slot when it unloads", async () => {
    const found = await withPlugin(validator, (kernel) =>
      Effect.gen(function* () {
        yield* kernel.runtime.remove("eva.validator")
        return yield* kernel.slot.validator.peek
      }),
    )

    expect(found).toBeUndefined()
  })

  it("is replaced by a second plugin providing the same slot", async () => {
    const stub: Validator = {
      accepts: () => Effect.void,
      check: () => Effect.succeed({ verdict: "valid", value: null }),
    }
    const second = define({
      id: "acme.validator",
      effect: Effect.fn(function* (ctx) {
        yield* ctx.slot.validator.provide(ctx.id, stub)
      }),
    })

    const found = await withPlugin(second, (kernel) => kernel.slot.validator.get, {
      before: [validator],
    })

    expect(found).toBe(stub)
  })
})

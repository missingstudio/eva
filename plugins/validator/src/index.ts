import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { accepts, check } from "./check.js"

/**
 * Fills the `Validator` slot: judges one Candidate against a JSON Schema and
 * names every Fault, as data. It never calls a model and it holds no loop —
 * the Repair belongs to the caller.
 */
export const validator = define({
  id: "eva.validator",
  effect: Effect.fn("eva.validator")(function* (ctx) {
    yield* ctx.slot.validator.provide(ctx.id, { accepts, check })
  }),
})

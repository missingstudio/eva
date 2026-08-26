import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { applier } from "./apply.js"

/**
 * Fills the `DiffApplier` slot: previews a structured Edit, applies it so
 * every Hunk lands or none does, and reverses an applied Edit byte for byte.
 * It reads and writes through the `FileSystem` each call hands it, so it
 * carries no files of its own and reads no other slot.
 */
export const diff = define({
  id: "eva.diff",
  effect: Effect.fn("eva.diff")(function* (ctx) {
    yield* ctx.slot.diffApplier.provide(ctx.id, applier)
  }),
})

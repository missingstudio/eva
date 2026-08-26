import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { editToolOf } from "./row.js"

export * from "./row.js"
export * from "./tool.js"

/**
 * The write tool. It computes an Edit as a diff, previews it, applies it
 * through the `DiffApplier` so every Hunk lands or none does, records an
 * `edit` payload, and keeps the apply so the write can be reversed.
 *
 * It reads the `FileSystem`, `DiffApplier`, and `Recorder` slots at the
 * moment of use, and fills none. It edits a file that is there: it creates
 * none and deletes none, because an undo of a create is a delete and a
 * `FileSystem` cannot delete.
 */
export const toolEdit = define({
  id: "eva.tool.edit",
  effect: Effect.fn("eva.tool.edit")(function* (ctx) {
    const made = yield* editToolOf(ctx)
    yield* ctx.tool.transform((draft) => {
      draft.set(made.row)
    })
  }),
})

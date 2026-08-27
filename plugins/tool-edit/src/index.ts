import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { editToolOf } from "./row.js"
import type { UndoOutcome } from "./tool.js"

export * from "./row.js"
export * from "./tool.js"

// The slash command a person reverses a write with.
export const UNDO_COMMAND = "undo"

// What the person is told, from the outcome the tool answered.
const saidOf = (outcome: UndoOutcome): string => {
  switch (outcome.kind) {
    case "undone":
      return `${outcome.path} is as it was. /${UNDO_COMMAND} ${outcome.undo} puts the change back.`
    case "unknown":
      return `no write is held under ${outcome.undo}: this process reverses only its own writes`
    case "refused":
      return `${outcome.path}: ${outcome.message}`
    case "degraded":
      return `nothing fills ${outcome.missing.join(", ")}`
  }
}

/**
 * The write tool. It computes an Edit as a diff, previews it, applies it
 * through the `DiffApplier` so every Hunk lands or none does, records an
 * `edit` payload, and keeps the apply so the write can be reversed.
 *
 * It reads the `FileSystem`, `DiffApplier`, and `Recorder` slots at the
 * moment of use, and fills none. It edits a file that is there: it creates
 * none and deletes none, because an undo of a create is a delete and a
 * `FileSystem` cannot delete.
 *
 * Two doors, and they are different acts. A model calls the row; a person
 * types `/undo`. Reversing a write is not a call a model makes, so the
 * command is how the undo this tool keeps reaches a person at all.
 */
export const toolEdit = define({
  id: "eva.tool.edit",
  effect: Effect.fn("eva.tool.edit")(function* (ctx) {
    const made = yield* editToolOf(ctx)
    yield* ctx.tool.transform((draft) => {
      draft.set(made.row)
    })

    /**
     * `/undo` — the person's door onto the writes this process made. It opens
     * a Run of its own, the `/mode` precedent: the tool commits its `edit`
     * payload through the Recorder, and a commit outside a Run has nowhere to
     * land.
     */
    yield* ctx.command.transform((draft) => {
      draft.set({
        ...draft.get(UNDO_COMMAND),
        id: UNDO_COMMAND,
        description: "reverses a write this process made, the newest one by default",
        argumentHint: "token",
        run: Effect.fn("eva.tool.edit.command")(function* (command) {
          const recorder = yield* ctx.slot.recorder.peek
          if (recorder === undefined) {
            command.write("nothing fills Recorder, so no write was recorded to reverse")
            return
          }

          const named = command.argument
          yield* recorder.open(command.session)
          yield* recorder.commit([
            {
              kind: "started",
              intent: `/${UNDO_COMMAND}${named === undefined ? "" : ` ${named}`}`,
            },
          ])
          const outcome = yield* made.tool.undo(named)
          yield* recorder.close({ result: outcome.kind === "undone" ? "done" : "failed" })

          command.write(saidOf(outcome))
        }),
      })
    })
  }),
})

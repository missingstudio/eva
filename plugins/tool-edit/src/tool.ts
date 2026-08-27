import type {
  Applied,
  DiffApplier,
  DiffRefused,
  FileSystem,
  FileSystemError,
  Hunk,
  Recorder,
} from "@missingstudio/eva-core"
import type { Payload } from "@missingstudio/eva-schema"
import { Effect } from "effect"

/**
 * What the tool is asked to do: an Edit, and whether to stop at the Preview.
 *
 * The input is an Edit and nothing more, so anything that holds the two slots
 * can compute the same Preview from the arguments alone. That is how a gate
 * shows a person the change before this tool runs — the tool hands out no
 * preview handle, because a handle would be a second way to reach one.
 */
export interface EditInput {
  readonly path: string
  readonly hunks: readonly Hunk[]
  // A dry run: the Preview is answered and nothing is written.
  readonly dryRun?: boolean
}

/**
 * Why a write did not happen. Every reason belongs to a boundary that refused
 * — three to the applier and three to the file system — and no reason is
 * coined here.
 */
export type EditRefusal = DiffRefused["reason"] | FileSystemError["reason"]

// A dry run: what an apply would write, with nothing written.
export interface EditPreviewed {
  readonly kind: "previewed"
  readonly path: string
  readonly hunks: number
  readonly after: string
}

export interface EditApplied {
  readonly kind: "applied"
  readonly path: string
  readonly hunks: number
  readonly after: string
  // What `undo` reverses this write with.
  readonly undo: string
}

// A boundary refused, and nothing was written. Data the model can act on.
export interface EditRefused {
  readonly kind: "refused"
  readonly path: string
  readonly reason: EditRefusal
  readonly message: string
}

// A slot nothing fills, by the name a `degraded` payload names it.
export interface EditDegraded {
  readonly kind: "degraded"
  readonly missing: readonly string[]
}

export type EditOutcome = EditPreviewed | EditApplied | EditRefused | EditDegraded

export interface EditUndone {
  readonly kind: "undone"
  readonly path: string
  // The same token, which now reverses the undo.
  readonly undo: string
}

// No write is held under this token. It was never issued, or the plugin that
// issued it has been unloaded since.
export interface EditUnknown {
  readonly kind: "unknown"
  readonly undo: string
}

export type UndoOutcome = EditUndone | EditUnknown | EditRefused | EditDegraded

/**
 * The slots the tool reads, as reads and never as values: a slot is read at
 * the moment of use, so a tool built once still writes through the
 * `FileSystem` that fills the slot now.
 */
export interface EditDeps {
  readonly files: Effect.Effect<FileSystem | undefined>
  readonly applier: Effect.Effect<DiffApplier | undefined>
  readonly recorder: Effect.Effect<Recorder | undefined>
}

/**
 * Where an `edit` record goes. `ToolContext.emit` is what the row hands over,
 * so the record lands in the call's own group and in the order it happened —
 * the execution buffers a call's records until the call ends, and a commit
 * straight to the Recorder would land ahead of the `tool_call` it belongs to.
 *
 * Absent, the Recorder is what commits it. An undo has no call and so no
 * context.
 */
export type Recording = (payload: Payload) => Effect.Effect<void>

export interface EditTool {
  readonly execute: (input: EditInput, record?: Recording) => Effect.Effect<EditOutcome>
  readonly undo: (token: string) => Effect.Effect<UndoOutcome>
}

/**
 * A refusal, from whichever boundary refused. Both faults carry the path, the
 * reason, and the sentence, so there is nothing to branch on.
 */
const refusedOf = (fault: DiffRefused | FileSystemError): EditRefused => ({
  kind: "refused",
  path: fault.path,
  reason: fault.reason,
  message: fault.message,
})

/**
 * The write tool.
 *
 * Every write is previewed: an apply takes a Preview, so there is no path
 * through the applier that writes content nothing resolved first. Every write
 * is undoable: the apply is kept, and `undo` reverses it byte for byte or
 * refuses. Every write is recorded: an `edit` payload lands on the Trace, and
 * a write this tool cannot record is a write it does not make.
 */
export const makeEditTool = (deps: EditDeps): EditTool => {
  /**
   * Each apply, by the token its outcome carries.
   *
   * The token reaches the caller and the `Applied` does not: an `Applied`
   * holds the whole content the file had before the write, and a result that
   * carried it would send a file back to the model to get an undo. It is kept
   * in this process and for as long as the plugin is loaded, which is the
   * honest span — the Trace records that a file changed, never how to change
   * it back, so nothing here survives a restart.
   */
  const applies = new Map<string, Applied>()
  let issued = 0

  /**
   * The three slots, read at the moment of use, or the names of the ones
   * nothing fills. An empty Recorder is as disabling as an empty FileSystem,
   * because the Trace and not the tool's word is what shows a file changed.
   */
  const ground = Effect.gen(function* () {
    const files = yield* deps.files
    const applier = yield* deps.applier
    const recorder = yield* deps.recorder

    if (files === undefined || applier === undefined || recorder === undefined) {
      const missing = [
        ...(files === undefined ? ["FileSystem"] : []),
        ...(applier === undefined ? ["DiffApplier"] : []),
        ...(recorder === undefined ? ["Recorder"] : []),
      ]
      if (recorder !== undefined) yield* recorder.commit([{ kind: "degraded", missing }])
      return { kind: "degraded", missing } as const
    }

    return { kind: "ready", files, applier, recorder } as const
  })

  return {
    execute: Effect.fn("eva.tool.edit")(function* (input: EditInput, record?: Recording) {
      const held = yield* ground
      if (held.kind === "degraded") return held

      const previewed = yield* Effect.result(
        held.applier.preview(held.files, { path: input.path, hunks: input.hunks }),
      )
      if (previewed._tag === "Failure") return refusedOf(previewed.failure)
      const preview = previewed.success

      if (input.dryRun === true) {
        return {
          kind: "previewed",
          path: preview.path,
          hunks: preview.hunks,
          after: preview.after,
        } as const
      }

      const written = yield* Effect.result(held.applier.apply(held.files, preview))
      if (written._tag === "Failure") return refusedOf(written.failure)

      const landed: Payload = { kind: "edit", path: preview.path, hunks: preview.hunks }
      yield* record === undefined ? held.recorder.commit([landed]) : record(landed)

      issued += 1
      const token = String(issued)
      applies.set(token, written.success)

      return {
        kind: "applied",
        path: preview.path,
        hunks: preview.hunks,
        after: preview.after,
        undo: token,
      } as const
    }),

    /**
     * Reverses one apply. The token is kept and now names the reverse, so
     * undoing twice puts the change back: one token names one write and
     * reverses it whichever way it stands.
     *
     * An undo writes a whole content and lands no Hunk, so its `edit` payload
     * counts zero — the Trace says the file changed, and the count says the
     * change was not a set of Hunks.
     */
    undo: Effect.fn("eva.tool.edit.undo")(function* (token: string) {
      const applied = applies.get(token)
      if (applied === undefined) return { kind: "unknown", undo: token } as const

      const held = yield* ground
      if (held.kind === "degraded") return held

      const reversed = yield* Effect.result(held.applier.reverse(held.files, applied))
      if (reversed._tag === "Failure") return refusedOf(reversed.failure)

      yield* held.recorder.commit([{ kind: "edit", path: applied.path, hunks: 0 }])
      applies.set(token, reversed.success)

      return { kind: "undone", path: applied.path, undo: token } as const
    }),
  }
}

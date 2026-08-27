import type { DiffApplier, FileSystem, Hunk } from "@missingstudio/eva-core"
import { readShape } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

/**
 * The change a question shows, so a person answers about a write rather than
 * about a tool's name.
 *
 * Nothing is asked of the tool. A write tool's input **is** an Edit, so
 * anything holding the `FileSystem` and `DiffApplier` slots resolves the same
 * preview from the arguments alone — which is why the gate can do this with no
 * change to the tool and no second way to reach a preview.
 *
 * It is bounded on purpose. The question is one string a terminal writes and a
 * page draws, so at most two hunks are shown, each side on one line of sixty
 * characters. A whole diff in a prompt is its own defect, and the whole diff is
 * on the Trace.
 */

const HUNKS = 2
const SIDE = 60

export interface Ground {
  readonly files: Effect.Effect<FileSystem | undefined>
  readonly applier: Effect.Effect<DiffApplier | undefined>
}

interface Edited {
  readonly path: string
  readonly hunks: readonly Hunk[]
}

/**
 * The arguments read as the Edit they are, or nothing when they name none.
 *
 * It reads the shape and never the tool's name, so a second write tool that
 * takes an Edit is previewed the same way and one that takes something else is
 * left alone.
 */
export const editIn = (args: unknown): Edited | undefined => {
  const found = readShape(args, "mapping")
  if (found === undefined) return undefined

  const path = readShape(found["path"], "string")
  const listed = readShape(found["hunks"], "list")
  if (path === undefined || path === "" || listed === undefined || listed.length === 0) {
    return undefined
  }

  const hunks: Hunk[] = []
  for (const one of listed) {
    const hunk = readShape(one, "mapping")
    if (hunk === undefined) return undefined
    const find = readShape(hunk["find"], "string")
    const replace = readShape(hunk["replace"], "string")
    if (find === undefined || replace === undefined) return undefined
    hunks.push({ find, replace })
  }
  return { path, hunks }
}

/**
 * One side of one hunk, on one line and inside the bound. A side that is
 * whitespace alone is the mark by itself: there is nothing to read in it, and
 * the head line already says how many hunks there are.
 */
const side = (mark: string, text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat === "") return mark
  return `${mark} ${flat.length > SIDE ? `${flat.slice(0, SIDE)}…` : flat}`
}

const shown = (edit: Edited): readonly string[] => [
  ...edit.hunks.slice(0, HUNKS).flatMap((hunk) => [side("-", hunk.find), side("+", hunk.replace)]),
  ...(edit.hunks.length > HUNKS ? [`… and ${edit.hunks.length - HUNKS} more`] : []),
]

const counted = (hunks: number): string => `${hunks} hunk${hunks === 1 ? "" : "s"}`

/**
 * The question about a call that names an Edit, or nothing when the arguments
 * name none — a caller that gets nothing asks what it was going to ask.
 *
 * The applier answers whether the change resolves, so a person is told when
 * the edit cannot land at all rather than approving a call that then fails.
 * With either slot empty the words the model wrote are still shown: a preview
 * nobody can resolve is not a reason to hide the change.
 */
export const previewed = Effect.fn("eva.approval.preview")(function* (
  ground: Ground,
  name: string,
  args: unknown,
) {
  const edit = editIn(args)
  if (edit === undefined) return undefined

  const files = yield* ground.files
  const applier = yield* ground.applier
  const refused =
    files === undefined || applier === undefined
      ? undefined
      : yield* Effect.map(Effect.result(applier.preview(files, edit)), (found) =>
          found._tag === "Failure" ? found.failure.reason : undefined,
        )

  const head =
    refused === undefined
      ? `${name} changes ${edit.path}, ${counted(edit.hunks.length)}:`
      : `${name} cannot change ${edit.path} — ${refused}:`
  return [head, ...shown(edit), "Run it?"].join("\n")
})

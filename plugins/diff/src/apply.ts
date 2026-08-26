import { createHash } from "node:crypto"
import type { Applied, DiffApplier, DiffFiles, Hunk } from "@missingstudio/eva-core"
import { DiffRefused } from "@missingstudio/eva-core"
import { Effect } from "effect"

/**
 * What a Preview was computed against, in one short string.
 *
 * A content hash and not a timestamp or a size: the only question a Preview
 * asks is whether the file still holds the bytes it read, and a hash answers
 * exactly that. A modification time answers a different question — it moves
 * when a write restores the same bytes, and it does not move for two writes
 * inside one clock tick — so it both refuses writes that are safe and passes
 * writes that are not.
 */
export const fingerprint = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex")

// How many times `find` appears. An empty `find` appears at every index.
const occurrences = (content: string, find: string): number => {
  if (find === "") return content.length + 1

  let count = 0
  let at = content.indexOf(find)
  while (at !== -1) {
    count += 1
    at = content.indexOf(find, at + find.length)
  }
  return count
}

/**
 * Every Hunk landed in one string, or the first Hunk that could not land.
 *
 * A Hunk is placed by index and slice rather than by `String.replace`, whose
 * string form reads `$&` and `$'` in the replacement as substitutions — a
 * replacement carrying either would land as something the caller never wrote.
 *
 * Each Hunk is counted against what the Hunks before it produced, so a Hunk
 * that becomes ambiguous only after an earlier one landed is still refused.
 */
const landed = Effect.fn("eva.diff.land")(function* (
  path: string,
  content: string,
  hunks: readonly Hunk[],
) {
  let after = content

  for (const [index, hunk] of hunks.entries()) {
    const found = occurrences(after, hunk.find)

    if (found === 0) {
      return yield* new DiffRefused({
        reason: "hunk_missing",
        path,
        hunk: index,
        message: `hunk ${index} does not appear in ${path}`,
      })
    }
    if (found > 1) {
      return yield* new DiffRefused({
        reason: "hunk_ambiguous",
        path,
        hunk: index,
        found,
        message: `hunk ${index} appears ${found} times in ${path} — it must appear once`,
      })
    }

    const at = after.indexOf(hunk.find)
    after = after.slice(0, at) + hunk.replace + after.slice(at + hunk.find.length)
  }

  return after
})

/**
 * One write, behind the one staleness check both directions share. It reads
 * the file, refuses when the bytes are not the ones the caller's record was
 * computed against, and otherwise writes whole.
 */
const wrote = Effect.fn("eva.diff.write")(function* (
  files: DiffFiles,
  path: string,
  expected: string,
  content: string,
  since: string,
) {
  const found = yield* files.read(path)

  if (fingerprint(found) !== expected) {
    return yield* new DiffRefused({
      reason: "stale",
      path,
      message: `${path} changed ${since}`,
    })
  }

  yield* files.write(path, content)
  return { path, before: found, wrote: fingerprint(content) } satisfies Applied
})

/**
 * The `DiffApplier` this plugin fills the Slot with.
 *
 * Atomicity is a property of the Preview, not of the write. Every Hunk is
 * resolved into one content before anything is written, so a Hunk that cannot
 * land refuses the Preview and an apply is a single `write` — which is what
 * lets the contract hold over a `FileSystem` that is an interface and offers
 * no rename into place, no transaction, and no lock.
 */
export const applier: DiffApplier = {
  preview: (files, edit) =>
    Effect.gen(function* () {
      const content = yield* files.read(edit.path)
      return {
        path: edit.path,
        base: fingerprint(content),
        after: yield* landed(edit.path, content, edit.hunks),
        hunks: edit.hunks.length,
      }
    }),

  apply: (files, preview) =>
    wrote(files, preview.path, preview.base, preview.after, "after the preview read it"),

  reverse: (files, applied) =>
    wrote(files, applied.path, applied.wrote, applied.before, "after it was applied"),
}

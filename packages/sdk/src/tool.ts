import {
  toolText,
  type FileSystem,
  type FileSystemError,
  type ToolResult,
} from "@missingstudio/eva-core"
import { Effect } from "effect"
import { readShape } from "./options.js"

/**
 * What a tool that reads files takes, and how one call of it ends.
 *
 * Three tools read the `FileSystem` slot the same way, and each one wrote the
 * same empty-slot sentence, the same refusal tail, and the same argument
 * reader under a name of its own. One answer to each, here, so a fourth tool
 * inherits them and no two of them can drift apart.
 */

/**
 * The read of the `FileSystem` slot, and never a `FileSystem`. A tool reads it
 * at the moment of use, so a build that swapped the filler reads through the
 * new one on the next call.
 */
export interface FileDeps {
  readonly files: Effect.Effect<FileSystem | undefined>
}

/**
 * One call over the slot. Both endings a file tool has are Dispositions the
 * model can act on: a slot nothing fills, and a path the file system refused.
 * Nothing here throws.
 */
export const overFiles = (
  deps: FileDeps,
  use: (files: FileSystem) => Effect.Effect<ToolResult, FileSystemError>,
): Effect.Effect<ToolResult> =>
  Effect.gen(function* () {
    const files = yield* deps.files
    if (files === undefined) return toolText("failed", "the FileSystem slot is empty")
    return yield* use(files)
  }).pipe(
    Effect.catchTag("FileSystemError", (fault) =>
      Effect.succeed(toolText("failed", `${fault.path}: ${fault.message}`)),
    ),
  )

/**
 * One string argument of a call, or nothing when the model wrote another
 * shape. An empty string is nothing: a tool asked for a path and handed `""`
 * was handed no path.
 */
export const textIn = (input: unknown, key: string): string | undefined => {
  const found = readShape(input, "mapping")
  if (found === undefined) return undefined
  const asked = readShape(found[key], "string")
  return asked === undefined || asked === "" ? undefined : asked
}

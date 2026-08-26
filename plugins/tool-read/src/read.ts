import { toolText, type FileSystem, type ToolInfo } from "@missingstudio/eva-core"
import { Effect } from "effect"

export interface ReadDeps {
  /**
   * The read of the `FileSystem` slot, not a `FileSystem`. The tool reads it
   * at the moment of use, so a build that swapped the filler reads through
   * the new one on the next call.
   */
  readonly files: Effect.Effect<FileSystem | undefined>
}

const INPUT = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "The file to read, relative to the workspace root.",
    },
  },
  required: ["path"],
  additionalProperties: false,
}

const pathOf = (input: unknown): string | undefined => {
  const asked = (input as { path?: unknown } | undefined)?.path
  return typeof asked === "string" && asked !== "" ? asked : undefined
}

/**
 * Reads one file, whole. The content reaches the model as it is on the disk:
 * nothing is numbered and nothing is trimmed, because the edit tool matches
 * the text it was shown.
 */
export const readTool = (deps: ReadDeps): ToolInfo => ({
  id: "read",
  kind: "read",
  description: "Read a file under the workspace root and answer its content.",
  input: INPUT,
  execute: (input) =>
    Effect.gen(function* () {
      const path = pathOf(input)
      if (path === undefined) return toolText("failed", "read wants a `path` string")

      const files = yield* deps.files
      if (files === undefined) return toolText("failed", "the FileSystem slot is empty")

      return toolText("ok", yield* files.read(path))
    }).pipe(
      Effect.catchTag("FileSystemError", (fault) =>
        Effect.succeed(toolText("failed", `${fault.path}: ${fault.message}`)),
      ),
    ),
})

import { toolText, type FileSystem, type ToolInfo } from "@missingstudio/eva-core"
import { Effect } from "effect"

export interface GlobDeps {
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
    pattern: {
      type: "string",
      description: "A glob, matched against paths relative to the workspace root.",
    },
  },
  required: ["pattern"],
  additionalProperties: false,
}

const patternOf = (input: unknown): string | undefined => {
  const asked = (input as { pattern?: unknown } | undefined)?.pattern
  return typeof asked === "string" && asked !== "" ? asked : undefined
}

/**
 * Names the files a glob matches, one per line. The paths are relative to the
 * root, files only, and sorted, because that is what the `FileSystem`
 * contract answers — the pattern rule is core's `globMatcher` and not this
 * tool's.
 */
export const globTool = (deps: GlobDeps): ToolInfo => ({
  id: "glob",
  kind: "search",
  description: "Name the files under the workspace root that a glob matches.",
  input: INPUT,
  // A listing changes nothing, so two listings may run at once.
  parallelSafe: () => true,
  execute: (input) =>
    Effect.gen(function* () {
      const pattern = patternOf(input)
      if (pattern === undefined) return toolText("failed", "glob wants a `pattern` string")

      const files = yield* deps.files
      if (files === undefined) return toolText("failed", "the FileSystem slot is empty")

      const found = yield* files.glob(pattern)
      return found.length === 0
        ? toolText("ok", `no file matches ${pattern}`)
        : toolText("ok", found.join("\n"))
    }).pipe(
      Effect.catchTag("FileSystemError", (fault) =>
        Effect.succeed(toolText("failed", `${fault.path}: ${fault.message}`)),
      ),
    ),
})

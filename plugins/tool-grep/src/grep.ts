import { toolText, type FileSystem, type ToolInfo } from "@missingstudio/eva-core"
import { Effect } from "effect"

export interface GrepDeps {
  /**
   * The read of the `FileSystem` slot, not a `FileSystem`. The tool reads it
   * at the moment of use, so a build that swapped the filler reads through
   * the new one on the next call.
   */
  readonly files: Effect.Effect<FileSystem | undefined>
}

// Every file under the root, when the call names no glob.
const EVERY = "**/*"

const INPUT = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "A regular expression, matched against each line.",
    },
    glob: {
      type: "string",
      description: `Which files to search. Defaults to \`${EVERY}\`.`,
    },
  },
  required: ["pattern"],
  additionalProperties: false,
}

interface Asked {
  readonly pattern?: unknown
  readonly glob?: unknown
}

const stringOf = (found: unknown): string | undefined =>
  typeof found === "string" && found !== "" ? found : undefined

// The compiled pattern, or nothing when the model wrote one no engine reads.
const matcherOf = (pattern: string): RegExp | undefined => {
  try {
    return new RegExp(pattern)
  } catch {
    return undefined
  }
}

const hits = (path: string, content: string, matcher: RegExp): readonly string[] =>
  content
    .split("\n")
    .flatMap((line, at) => (matcher.test(line) ? [`${path}:${at + 1}:${line}`] : []))

/**
 * Searches the content of files under the root, line by line, and answers
 * `path:line:text` for every match. It walks the `FileSystem` slot rather
 * than a search program, so the same call answers the same lines over a disk
 * and over a map.
 */
export const grepTool = (deps: GrepDeps): ToolInfo => ({
  id: "grep",
  kind: "search",
  description: "Search the content of files under the workspace root.",
  input: INPUT,
  execute: (input) =>
    Effect.gen(function* () {
      const asked = (input ?? {}) as Asked
      const pattern = stringOf(asked.pattern)
      if (pattern === undefined) return toolText("failed", "grep wants a `pattern` string")

      const matcher = matcherOf(pattern)
      if (matcher === undefined) return toolText("failed", `${pattern} is not a regular expression`)

      const files = yield* deps.files
      if (files === undefined) return toolText("failed", "the FileSystem slot is empty")

      const found: string[] = []
      for (const path of yield* files.glob(stringOf(asked.glob) ?? EVERY))
        found.push(...hits(path, yield* files.read(path), matcher))

      return found.length === 0
        ? toolText("ok", `nothing matches ${pattern}`)
        : toolText("ok", found.join("\n"))
    }).pipe(
      Effect.catchTag("FileSystemError", (fault) =>
        Effect.succeed(toolText("failed", `${fault.path}: ${fault.message}`)),
      ),
    ),
})

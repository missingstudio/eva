import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { overFiles, textIn, type FileDeps } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

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
export const grepTool = (deps: FileDeps): ToolInfo => ({
  id: "grep",
  kind: "search",
  description: "Search the content of files under the workspace root.",
  input: INPUT,
  // A search changes nothing, so two searches may run at once.
  parallelSafe: () => true,
  execute: (input) => {
    const pattern = textIn(input, "pattern")
    if (pattern === undefined) {
      return Effect.succeed(toolText("failed", "grep wants a `pattern` string"))
    }

    const matcher = matcherOf(pattern)
    if (matcher === undefined) {
      return Effect.succeed(toolText("failed", `${pattern} is not a regular expression`))
    }

    return overFiles(deps, (files) =>
      Effect.gen(function* () {
        const found: string[] = []
        for (const path of yield* files.glob(textIn(input, "glob") ?? EVERY))
          found.push(...hits(path, yield* files.read(path), matcher))

        return found.length === 0
          ? toolText("ok", `nothing matches ${pattern}`)
          : toolText("ok", found.join("\n"))
      }),
    )
  },
})

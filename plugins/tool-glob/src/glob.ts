import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { overFiles, textIn, type FileDeps } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

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

/**
 * Names the files a glob matches, one per line. The paths are relative to the
 * root, files only, and sorted, because that is what the `FileSystem`
 * contract answers — the pattern rule is core's `globMatcher` and not this
 * tool's.
 */
export const globTool = (deps: FileDeps): ToolInfo => ({
  id: "glob",
  kind: "search",
  description: "Name the files under the workspace root that a glob matches.",
  input: INPUT,
  // A listing changes nothing, so two listings may run at once.
  parallelSafe: () => true,
  execute: (input) => {
    const pattern = textIn(input, "pattern")
    if (pattern === undefined) {
      return Effect.succeed(toolText("failed", "glob wants a `pattern` string"))
    }
    return overFiles(deps, (files) =>
      Effect.map(files.glob(pattern), (found) =>
        found.length === 0
          ? toolText("ok", `no file matches ${pattern}`)
          : toolText("ok", found.join("\n")),
      ),
    )
  },
})

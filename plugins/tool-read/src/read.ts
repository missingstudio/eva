import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { overFiles, textIn, type FileDeps } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

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

/**
 * Reads one file, whole. The content reaches the model as it is on the disk:
 * nothing is numbered and nothing is trimmed, because the edit tool matches
 * the text it was shown.
 */
export const readTool = (deps: FileDeps): ToolInfo => ({
  id: "read",
  kind: "read",
  description: "Read a file under the workspace root and answer its content.",
  input: INPUT,
  // A read changes nothing, so two reads may run at once.
  parallelSafe: () => true,
  execute: (input) => {
    const path = textIn(input, "path")
    if (path === undefined) return Effect.succeed(toolText("failed", "read wants a `path` string"))
    return overFiles(deps, (files) => Effect.map(files.read(path), (text) => toolText("ok", text)))
  },
})

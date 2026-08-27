import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { overFiles, takes, type FileDeps } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

const TAKES = takes({
  path: { shape: "string", description: "The file to read, relative to the workspace root." },
})

/**
 * Reads one file, whole. The content reaches the model as it is on the disk:
 * nothing is numbered and nothing is trimmed, because the edit tool matches
 * the text it was shown.
 */
export const readTool = (deps: FileDeps): ToolInfo => ({
  id: "read",
  kind: "read",
  description: "Read a file under the workspace root and answer its content.",
  input: TAKES.schema,
  // A read changes nothing, so two reads may run at once.
  parallelSafe: () => true,
  execute: (input) => {
    const found = TAKES.of("read", input)
    if (found.kind === "refused") return Effect.succeed(found.result)
    return overFiles(deps, (files) =>
      Effect.map(files.read(found.args.path), (text) => toolText("ok", text)),
    )
  },
})

import { offering } from "@missingstudio/eva-sdk"
import { readTool } from "./read.js"

export * from "./read.js"

/**
 * Offers the `read` tool: it reads one file through the `FileSystem` slot, so
 * the workspace root is the whole reach of the call.
 *
 * The row is registered whole, and the domain rebuilds on every plugin load
 * and unload — which is how a mode change rebuilds the tools an agent sees.
 */
export const toolRead = offering("eva.tool.read", (ctx) =>
  readTool({ files: ctx.slot.fileSystem.peek }),
)

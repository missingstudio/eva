import { offering } from "@missingstudio/eva-sdk"
import { grepTool } from "./grep.js"

export * from "./grep.js"

/**
 * Offers the `grep` tool: it searches file content through the `FileSystem`
 * slot, so the workspace root is the whole reach of the call.
 */
export const toolGrep = offering("eva.tool.grep", (ctx) =>
  grepTool({ files: ctx.slot.fileSystem.peek }),
)

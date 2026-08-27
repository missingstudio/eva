import { offering } from "@missingstudio/eva-sdk"
import { globTool } from "./glob.js"

export * from "./glob.js"

/**
 * Offers the `glob` tool: it names files through the `FileSystem` slot, so the
 * workspace root is the whole reach of the call.
 */
export const toolGlob = offering("eva.tool.glob", (ctx) =>
  globTool({ files: ctx.slot.fileSystem.peek }),
)

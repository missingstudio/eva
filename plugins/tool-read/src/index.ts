import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { readTool } from "./read.js"

export * from "./read.js"

/**
 * Registers the `read` tool: it reads one file through the `FileSystem` slot,
 * so the workspace root is the whole reach of the call.
 *
 * The row is registered whole, and the domain rebuilds on every plugin load
 * and unload — which is how a mode change rebuilds the tools an agent sees.
 */
export const toolRead = define({
  id: "eva.tool.read",
  effect: Effect.fn("eva.tool.read")(function* (ctx) {
    const row = readTool({ files: ctx.slot.fileSystem.peek })
    yield* ctx.tool.transform((draft) => {
      draft.set(row)
    })
  }),
})

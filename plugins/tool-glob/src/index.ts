import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { globTool } from "./glob.js"

export * from "./glob.js"

/**
 * Registers the `glob` tool: it names files through the `FileSystem` slot, so
 * the workspace root is the whole reach of the call.
 */
export const toolGlob = define({
  id: "eva.tool.glob",
  effect: Effect.fn("eva.tool.glob")(function* (ctx) {
    const row = globTool({ files: ctx.slot.fileSystem.peek })
    yield* ctx.tool.transform((draft) => {
      draft.set(row)
    })
  }),
})

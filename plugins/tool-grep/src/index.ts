import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { grepTool } from "./grep.js"

export * from "./grep.js"

/**
 * Registers the `grep` tool: it searches file content through the
 * `FileSystem` slot, so the workspace root is the whole reach of the call.
 */
export const toolGrep = define({
  id: "eva.tool.grep",
  effect: Effect.fn("eva.tool.grep")(function* (ctx) {
    const row = grepTool({ files: ctx.slot.fileSystem.peek })
    yield* ctx.tool.transform((draft) => {
      draft.set(row)
    })
  }),
})

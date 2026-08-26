import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { overFetch, webTool } from "./web.js"

export * from "./web.js"

/**
 * Registers the `web` tool: it reads one http or https address. It is the one
 * tool of this stage that reaches past the workspace, and the reader that
 * does the reaching is handed in — so the tool is tested with no network.
 */
export const toolWeb = define({
  id: "eva.tool.web",
  effect: Effect.fn("eva.tool.web")(function* (ctx) {
    const row = webTool({ get: overFetch })
    yield* ctx.tool.transform((draft) => {
      draft.set(row)
    })
  }),
})

import { offering } from "@missingstudio/eva-sdk"
import { overFetch, webTool } from "./web.js"

export * from "./web.js"

/**
 * Offers the `web` tool: it reads one http or https address. It is the one
 * tool of this stage that reaches past the workspace, and the reader that does
 * the reaching is handed in — so the tool is tested with no network.
 */
export const toolWeb = offering("eva.tool.web", () => webTool({ get: overFetch }))

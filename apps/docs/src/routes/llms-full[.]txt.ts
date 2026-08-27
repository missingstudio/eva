import { plain } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"
import { llmsFullTxt } from "../lib/llms.js"

// Every page's markdown in one file, for a reader that wants the whole manual
// in context rather than twenty-five fetches.
export const Route = createFileRoute("/llms-full.txt")({
  server: { handlers: { GET: async () => plain(await llmsFullTxt()) } },
})

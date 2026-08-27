import { plain } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"
import { llmsTxt } from "../lib/llms.js"

export const Route = createFileRoute("/llms.txt")({
  server: { handlers: { GET: () => plain(llmsTxt()) } },
})

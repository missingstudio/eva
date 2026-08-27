import { createFileRoute } from "@tanstack/react-router"
import { markdownPages } from "../lib/markdown.js"
import { markdown } from "@missingstudio/machine/serve"

export const Route = createFileRoute("/about.md")({
  server: { handlers: { GET: () => markdown(markdownPages["/about.md"]()) } },
})

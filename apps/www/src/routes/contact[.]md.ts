import { createFileRoute } from "@tanstack/react-router"
import { markdownPages } from "../lib/markdown.js"
import { markdown } from "@missingstudio/ui/serve"

export const Route = createFileRoute("/contact.md")({
  server: { handlers: { GET: () => markdown(markdownPages["/contact.md"]()) } },
})

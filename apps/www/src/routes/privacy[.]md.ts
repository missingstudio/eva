import { createFileRoute } from "@tanstack/react-router"
import { markdownPages } from "../lib/markdown.js"
import { markdown } from "@missingstudio/machine/serve"

export const Route = createFileRoute("/privacy.md")({
  server: { handlers: { GET: () => markdown(markdownPages["/privacy.md"]()) } },
})

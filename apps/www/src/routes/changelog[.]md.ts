import { createFileRoute } from "@tanstack/react-router"
import { markdownPages } from "../lib/markdown.js"
import { markdown } from "@missingstudio/ui/serve"

export const Route = createFileRoute("/changelog.md")({
  server: { handlers: { GET: () => markdown(markdownPages["/changelog.md"]()) } },
})

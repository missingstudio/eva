import { createFileRoute } from "@tanstack/react-router"
import { markdownPages } from "../lib/markdown.js"
import { markdown } from "@missingstudio/machine/serve"

export const Route = createFileRoute("/changelog.md")({
  server: { handlers: { GET: () => markdown(markdownPages["/changelog.md"]()) } },
})

import { createFileRoute } from "@tanstack/react-router"
import { llmsTxt } from "../lib/markdown.js"
import { plain } from "@missingstudio/machine/serve"

// The index an agent reads first. llmstxt.org asks for a level-one heading, a
// blockquote summary, and sections of markdown links. It registers no media
// type of its own, and the files in the field serve text/plain.
export const Route = createFileRoute("/llms.txt")({
  server: { handlers: { GET: () => plain(llmsTxt()) } },
})

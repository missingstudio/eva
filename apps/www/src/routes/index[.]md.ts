import { createFileRoute } from "@tanstack/react-router"
import { homeMarkdown } from "../lib/markdown.js"
import { markdown } from "@missingstudio/ui/serve"

// The home page as markdown. `/.md` is not a path, so the root's twin is named
// the way a directory index is named.
export const Route = createFileRoute("/index.md")({
  server: { handlers: { GET: () => markdown(homeMarkdown()) } },
})

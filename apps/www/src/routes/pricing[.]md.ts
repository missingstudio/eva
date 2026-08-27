import { createFileRoute } from "@tanstack/react-router"
import { markdownPages } from "../lib/markdown.js"
import { markdown } from "@missingstudio/ui/serve"

// Pricing has no HTML page. There is one price and it is zero, so a page with
// a tier table would invent a hierarchy the product does not have. The file
// exists because an agent comparing tools needs to read the zero as a fact.
export const Route = createFileRoute("/pricing.md")({
  server: { handlers: { GET: () => markdown(markdownPages["/pricing.md"]()) } },
})

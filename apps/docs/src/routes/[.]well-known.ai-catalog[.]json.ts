import { json } from "@missingstudio/ui/serve"
import { createFileRoute } from "@tanstack/react-router"
import { aiCatalog } from "../lib/discovery.js"

// The predecessor path. The specification says a publisher should move to
// ard.json and that reading this one is a courtesy rather than conformance,
// but the readers in the field still ask here first, so both are served.
export const Route = createFileRoute("/.well-known/ai-catalog.json")({
  server: { handlers: { GET: () => json(aiCatalog()) } },
})

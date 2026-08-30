import { ardManifest, webCatalog } from "@missingstudio/machine"
import { json } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"

// Agentic Resource Discovery, at the path the current specification names.
export const Route = createFileRoute("/.well-known/ard.json")({
  server: { handlers: { GET: () => json(ardManifest(webCatalog())) } },
})

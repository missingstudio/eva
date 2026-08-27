import { createFileRoute } from "@tanstack/react-router"
import { ard } from "../lib/discovery.js"
import { json } from "@missingstudio/ui/serve"

// Agentic Resource Discovery, at the path the current specification names.
export const Route = createFileRoute("/.well-known/ard.json")({
  server: { handlers: { GET: () => json(ard()) } },
})

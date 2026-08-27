import { json } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"
import { ard } from "../lib/discovery.js"

// Agentic Resource Discovery, at the path the current specification names.
export const Route = createFileRoute("/.well-known/ard.json")({
  server: { handlers: { GET: () => json(ard()) } },
})

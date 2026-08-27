import { pricingMarkdown } from "@missingstudio/machine"
import { markdown } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"

// Both origins answer what Eva costs, from one source in the ui package. A
// reader that landed here is not sent to another host to ask.
export const Route = createFileRoute("/pricing.md")({
  server: { handlers: { GET: () => markdown(pricingMarkdown()) } },
})

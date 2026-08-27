import { authMarkdown } from "@missingstudio/ui"
import { markdown } from "@missingstudio/ui/serve"
import { createFileRoute } from "@tanstack/react-router"

// How an agent obtains a credential, which is by not needing one. The sections
// are the ones the WorkOS draft prescribes, so a reader looking for them finds
// them answered rather than missing.
export const Route = createFileRoute("/auth.md")({
  server: { handlers: { GET: () => markdown(authMarkdown()) } },
})

import { origin, robotsTxt } from "@missingstudio/machine"
import { plain } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"

// The policy is the ui package's, because it is the same policy on both
// origins. What this origin says for itself is the opening line and the two
// sitemaps: a crawler that finds the marketing site should be told where the
// documentation's sitemap is as well.
const body = robotsTxt({
  says: "Eva is open source and meant to be read, quoted, and trained on.",
  sitemaps: [`${origin.web}/sitemap.xml`, `${origin.docs}/sitemap.xml`],
})

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: { GET: () => plain(body) } },
})

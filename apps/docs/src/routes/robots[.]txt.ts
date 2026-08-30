import { origin, robotsTxt } from "@missingstudio/machine"
import { plain } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"

// The policy is the machine package's, because it is the same policy on both
// origins. This one names its own sitemap: the marketing origin's robots.txt
// names both, so a crawler that arrives at either finds the pair.
const body = robotsTxt({
  says: "Eva's documentation is meant to be read, quoted, and trained on.\nNothing here is paywalled and everything here is MIT.",
  sitemaps: [`${origin.docs}/sitemap.xml`],
})

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: { GET: () => plain(body) } },
})

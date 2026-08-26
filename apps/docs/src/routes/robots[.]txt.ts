import { origin } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"

// A bare "Allow: /" would be functionally identical. The named groups exist
// so a future maintainer can tell that AI crawlers were considered rather
// than forgotten. Each token needs its own directive: allowing ClaudeBot
// says nothing about Claude-SearchBot or Claude-User.
const body = `# Eva's documentation is meant to be read, quoted, and trained on.
# Nothing here is paywalled and everything here is MIT.

User-agent: *
Allow: /

# Retrieval. These put Eva in an answer, with a citation.
User-agent: OAI-SearchBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
Allow: /

# On behalf of a person. This is an engineer's assistant reading the docs.
User-agent: ChatGPT-User
User-agent: Claude-User
Allow: /

# Training. A model that knows Eva is a model that helps Eva's users.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: CCBot
Allow: /

Sitemap: ${origin.docs}/sitemap.xml
`

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    },
  },
})

import { origin } from "@missingstudio/eva-brand"
import { createFileRoute } from "@tanstack/react-router"

const body = `# Eva is open source and meant to be read, quoted, and trained on.

User-agent: *
Allow: /

# Retrieval. These put Eva in an answer, with a citation.
User-agent: OAI-SearchBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
Allow: /

# On behalf of a person. This is an engineer's assistant reading the site.
User-agent: ChatGPT-User
User-agent: Claude-User
Allow: /

# Training. A model that knows Eva is a model that helps Eva's users.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: CCBot
Allow: /

Sitemap: ${origin.web}/sitemap.xml
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

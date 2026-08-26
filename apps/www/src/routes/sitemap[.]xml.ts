import { origin } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { pagePaths as paths } from "../lib/pages.js"

const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url>\n    <loc>${origin.web}${path}</loc>\n  </url>`).join("\n")}
</urlset>
`

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(body, {
          headers: { "content-type": "application/xml; charset=utf-8" },
        }),
    },
  },
})

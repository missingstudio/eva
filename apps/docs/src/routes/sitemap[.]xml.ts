import { origin } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { lastModifiedOf, source } from "../lib/source.js"

const body = () => {
  const entries = source.getPages().map((page) => {
    const path = page.url === "/" ? "" : page.url

    // A page with no description is a page a search result describes badly.
    // The contract is enforced here, where every page passes through.
    if (!page.data.description) {
      throw new Error(`${page.url} has no description in its frontmatter`)
    }

    // lastmod comes from git, never from the build clock. A sitemap that
    // claims every page changed on every deploy teaches a crawler to ignore
    // its own dates.
    const modified = lastModifiedOf(page.data)
    const lastmod = modified
      ? `\n    <lastmod>${new Date(modified).toISOString().slice(0, 10)}</lastmod>`
      : ""

    return `  <url>\n    <loc>${origin.docs}${path}</loc>${lastmod}\n  </url>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(body(), {
          headers: { "content-type": "application/xml; charset=utf-8" },
        }),
    },
  },
})

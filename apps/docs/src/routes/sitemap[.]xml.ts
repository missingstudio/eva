import { origin } from "@missingstudio/ui"
import { xml } from "@missingstudio/ui/serve"
import { createFileRoute } from "@tanstack/react-router"
import { modifiedOn } from "../lib/modified.js"
import { source } from "../lib/source.js"

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
    const modified = modifiedOn(page.url)
    const lastmod = modified ? `\n    <lastmod>${modified}</lastmod>` : ""

    return `  <url>\n    <loc>${origin.docs}${path}</loc>${lastmod}\n  </url>`
  })

  // Flush left on purpose. `dedent` measures the static lines and leaves an
  // interpolated block alone, so indenting this template would strip the
  // entries' own indentation off every line after the first.
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`
}

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: () => xml(body()) } },
})

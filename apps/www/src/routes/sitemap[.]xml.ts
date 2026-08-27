import { origin } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { pagePaths as paths } from "../lib/pages.js"
import { xml } from "@missingstudio/ui/serve"

// Flush left on purpose. `dedent` measures the static lines and leaves an
// interpolated block alone, so indenting this template would strip the
// entries' own indentation off every line after the first.
const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url>\n    <loc>${origin.web}${path}</loc>\n  </url>`).join("\n")}
</urlset>
`

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: () => xml(body) } },
})

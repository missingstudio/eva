import { entity, origin } from "@missingstudio/eva-brand"
import { createFileRoute } from "@tanstack/react-router"
import { source } from "../lib/source.js"

// Not an SEO artifact. No major answer engine reads this file. It is here
// because coding assistants fetch documentation into context, and that is
// exactly who reads Eva's docs.
const body = () => {
  const lines = [
    `# ${entity.product.name}`,
    "",
    `> ${entity.product.description}`,
    "",
    "## Documentation",
    "",
  ]

  for (const page of source.getPages()) {
    const path = page.url === "/" ? "" : page.url
    const description = page.data.description ?? ""
    lines.push(`- [${page.data.title}](${origin.docs}${path}): ${description}`)
  }

  return `${lines.join("\n")}\n`
}

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(body(), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    },
  },
})

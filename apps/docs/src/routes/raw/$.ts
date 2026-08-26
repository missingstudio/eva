import { createFileRoute } from "@tanstack/react-router"
import { source } from "../../lib/source.js"

// The endpoint a tool fetches after it has found a page. More useful in
// practice than llms.txt, because it answers "give me this one page".
export const Route = createFileRoute("/raw/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = params._splat?.split("/").filter(Boolean) ?? []
        const page = source.getPage(slugs)
        if (!page) return new Response("Not found", { status: 404 })

        const text = await page.data.getText("raw")

        return new Response(text, {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        })
      },
    },
  },
})

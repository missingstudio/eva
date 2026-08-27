import { markdown, missing } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"
import { pageMarkdown } from "../../lib/markdown.js"
import { source } from "../../lib/source.js"

/**
 * The endpoint a tool fetches after it has found a page. More useful in
 * practice than llms.txt, because it answers "give me this one page".
 *
 * The build files each answer under the page's own name with `.md` appended,
 * which is where a reader looks for it, and `vercel.json` rewrites these URLs
 * onto those files so both forms answer.
 */
export const Route = createFileRoute("/raw/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = params._splat?.split("/").filter(Boolean) ?? []
        const page = source.getPage(slugs)

        if (!page) {
          return missing(`No page is at /${slugs.join("/")}.\n\nEvery page: /llms.txt`)
        }

        return markdown(
          pageMarkdown({
            title: page.data.title,
            description: page.data.description,
            url: page.url,
            raw: await page.data.getText("raw"),
          }),
        )
      },
    },
  },
})

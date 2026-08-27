import { missing, plain } from "@missingstudio/ui/serve"
import { createFileRoute } from "@tanstack/react-router"
import { sectionLlmsTxt } from "../lib/llms.js"
import type { Section } from "../lib/twins.js"

/**
 * One area's index. An agent working on configuration fetches the
 * configuration pages rather than the whole manual.
 *
 * The handler is written out rather than wrapped, because reading `params` is
 * what gives them their types.
 */
export const Route = createFileRoute("/$section/llms.txt")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const body = sectionLlmsTxt(params.section as Section)

        return body ? plain(body) : missing(`No section is named "${params.section}".`)
      },
    },
  },
})

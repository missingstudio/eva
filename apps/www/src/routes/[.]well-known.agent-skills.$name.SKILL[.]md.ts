import { markdown, missing } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"
import { skill } from "../lib/discovery.js"

/**
 * One skill, at the path the index points to. The draft asks a publisher to
 * answer 404 for a skill that does not exist, rather than to answer with
 * something else.
 *
 * The handler is written out rather than wrapped, because reading `params` is
 * what gives them their types.
 */
export const Route = createFileRoute("/.well-known/agent-skills/$name/SKILL.md")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const body = skill(params.name)

        return body ? markdown(body) : missing(`No skill is named "${params.name}".`)
      },
    },
  },
})

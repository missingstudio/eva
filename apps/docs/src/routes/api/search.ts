import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"
import { source } from "../../lib/source.js"

const server = createFromSource(source)

/**
 * The search index, as a file.
 *
 * `GET` used to answer a query per request, which needs a server. This site
 * deploys as static files, so that handler was never reached in production and
 * search returned nothing on the deployed site for as long as it was deployed.
 * `staticGET` answers with the whole index instead, the build writes it to a
 * file, and the dialog searches it in the browser.
 */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: () => server.staticGET(),
    },
  },
})

import { entity, ogSiteName, titleTemplate } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { NotFound } from "../components/not-found.js"

/**
 * The 404 body, as a route the build can render.
 *
 * Static hosting answers an unmatched path with the file named `404.html`, and
 * nothing renders a router's not-found component into a file. The router keeps
 * its own not-found component for a client-side miss; both draw this one.
 *
 * It carries no canonical link and no markdown twin: a canonical on a body
 * served at every wrong URL points nowhere true, and an advertised twin that
 * does not exist is worse than no advertisement.
 */
export const Route = createFileRoute("/404")({
  head: () => ({
    meta: [
      { title: titleTemplate.docs("Page not found") },
      {
        name: "description",
        content: `The page is not here. Where to look instead in ${entity.product.name}'s documentation.`,
      },
      { name: "robots", content: "noindex" },
      { property: "og:site_name", content: ogSiteName.docs },
    ],
  }),
  component: NotFound,
})

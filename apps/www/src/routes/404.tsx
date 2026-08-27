import { entity, ogSiteName, titleTemplate } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { NotFound } from "../marketing/not-found.js"

/**
 * The 404 body, as a route the build can render.
 *
 * Static hosting answers an unmatched path with the file named `404.html`, and
 * nothing renders a router's not-found component into a file — so the build
 * prerenders this route to that one filename. The router keeps its own
 * not-found component for a client-side miss; both draw the same component.
 *
 * It is deliberately absent from `pagePaths`, and it is the one page that does
 * not use the shared head. A sitemap that advertises the page a crawler gets
 * when it is lost has misunderstood itself, a canonical link on a body served
 * at every wrong URL points nowhere true, and a markdown twin of it does not
 * exist — an advertised twin that 404s is worse than no advertisement.
 */
export const Route = createFileRoute("/404")({
  head: () => ({
    meta: [
      { title: titleTemplate.web("Page not found") },
      {
        name: "description",
        content: `The page is not here. Where to look instead on ${entity.product.name}'s site.`,
      },
      { name: "robots", content: "noindex" },
      { property: "og:site_name", content: ogSiteName.web },
    ],
  }),
  component: NotFound,
})

import { ogSiteName, origin, titleTemplate } from "@missingstudio/machine"
import { twinOf } from "./pages.js"

/**
 * The metadata contract every page on this surface meets. A page cannot opt
 * out of a canonical link, an Open Graph card, or the link that advertises its
 * markdown twin.
 *
 * The twin link is the one an agent follows, and an advertisement that points
 * at HTML is worse than none — so the href comes from `twinOf`, the same rule
 * the build uses to decide which twins to write.
 */
export const pageHead = (page: { title?: string; description: string; path: string }) => {
  const url = `${origin.web}${page.path}`
  const title = titleTemplate.web(page.title)

  return {
    meta: [
      { title },
      { name: "description", content: page.description },
      { property: "og:title", content: title },
      { property: "og:description", content: page.description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: ogSiteName.web },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "canonical", href: url },
      { rel: "alternate", type: "text/markdown", href: `${origin.web}${twinOf(page.path)}` },
    ],
  }
}

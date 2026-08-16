import { entity, ogSiteName, origin, titleTemplate } from "@missingstudio/eva-brand"
import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { glossaryTerms } from "./glossary.js"
import { lastModifiedOf, source } from "./source.js"

export const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    const modified = lastModifiedOf(page.data)
    const path = page.url === "/" ? "" : page.url

    // The terms come out of the page's own markdown, so the markup cannot
    // describe a definition the page does not carry.
    const terms = glossaryTerms(await page.data.getText("raw"))

    return {
      path: page.path,
      slug: slugs.join("/"),
      url: `${origin.docs}${path}`,
      title: page.data.title,
      description: page.data.description ?? entity.product.description,
      ...(modified ? { modified: new Date(modified).toISOString().slice(0, 10) } : {}),
      ...(terms.length > 0 ? { terms } : {}),
      pageTree: await source.serializePageTree(source.getPageTree()),
    }
  })

type Head = { title: string; description: string; url: string }

/** Every page emits the same metadata contract. A page cannot opt out. */
export const pageHead = (page: Head | undefined) => {
  if (!page) return {}

  return {
    meta: [
      { title: titleTemplate.docs(page.title) },
      { name: "description", content: page.description },
      { property: "og:title", content: titleTemplate.docs(page.title) },
      { property: "og:description", content: page.description },
      { property: "og:url", content: page.url },
      { property: "og:type", content: "article" },
      { property: "og:site_name", content: ogSiteName.docs },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: page.url }],
  }
}

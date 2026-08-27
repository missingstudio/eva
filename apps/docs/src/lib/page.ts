import { entity, ogSiteName, origin, titleTemplate } from "@missingstudio/machine"
import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { glossaryTerms } from "./glossary.js"
import { modifiedOn } from "./modified.js"
import { asksQuestions, questionsIn } from "./questions.js"
import { source } from "./source.js"
import { sections, twinOf } from "./twins.js"

/**
 * Where a page sits, from the documentation root down to itself. A page in a
 * section gets three steps; a top-level page gets two, and the caller drops a
 * trail that short because a breadcrumb of one step describes nothing.
 */
const trailOf = (url: string, title: string) => {
  const trail: { name: string; url: string }[] = [{ name: "Eva docs", url: origin.docs }]
  const slug = url.replace(/^\//, "")
  const [first] = slug.split("/")
  const section = sections.find((entry) => entry.slug === first)

  if (section) {
    trail.push({ name: section.title, url: `${origin.docs}/${section.slug}` })
  }

  if (slug !== "") trail.push({ name: title, url: `${origin.docs}/${slug}` })

  return trail
}

export const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    const modified = modifiedOn(page.url)
    const path = page.url === "/" ? "" : page.url

    // The terms and the questions come out of the page's own markdown, so the
    // markup cannot describe a definition or an answer the page does not
    // carry. Only the troubleshooting page is written as symptoms, and it is
    // the only one whose sections are questions rather than prose.
    const raw = await page.data.getText("raw")
    const terms = glossaryTerms(raw)
    const questions = asksQuestions(page.url) ? questionsIn(raw) : []

    return {
      path: page.path,
      slug: slugs.join("/"),
      url: `${origin.docs}${path}`,
      title: page.data.title,
      description: page.data.description ?? entity.product.description,
      ...(modified ? { modified } : {}),
      ...(terms.length > 0 ? { terms } : {}),
      ...(questions.length > 0 ? { questions } : {}),
      trail: trailOf(page.url, page.data.title),
      pageTree: await source.serializePageTree(source.getPageTree()),
    }
  })

type Head = { title: string; description: string; url: string; slug: string }

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
    links: [
      { rel: "canonical", href: page.url },
      // The markdown twin of this page. It is the same document, and the
      // advertised URL serves markdown rather than the markup it is a twin of.
      {
        rel: "alternate",
        type: "text/markdown",
        href: `${origin.docs}${twinOf(page.slug === "" ? "/" : `/${page.slug}`)}`,
      },
    ],
  }
}

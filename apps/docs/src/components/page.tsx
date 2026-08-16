import { docPageGraph, glossaryGraph } from "@missingstudio/eva-brand"
import { useFumadocsLoader } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/notebook"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/notebook/page"
import { Suspense, use } from "react"
import { useMDXComponents } from "./mdx.js"
import { baseOptions } from "../lib/layout.shared.js"
import type { Term } from "../lib/glossary.js"
import { docs } from "../lib/source.js"

export type PageData = {
  path: string
  url: string
  slug: string
  title: string
  description: string
  modified?: string
  terms?: Term[]
  pageTree: unknown
}

function Content({ data }: { data: PageData }) {
  const page = docs.getPage(data.path)
  if (!page) throw new Error(`unknown page: ${data.path}`)

  const { toc } = use(page.load())
  const MDX = page.body

  // The raw endpoint from §14.8 finally has a button in front of it.
  const markdownUrl = `/raw/${data.slug}`

  return (
    // The notebook layout renders the article as `<article id="nd-page">` and
    // names none of its regions. A reader arriving with a screen reader needs
    // to skip two navigation regions to reach the page, and cannot tell which
    // is which until each one is named. The layout spreads props onto the
    // elements it owns, so the landmarks are set from here: the article
    // becomes the main region the skip link targets, and the table of contents
    // becomes a navigation region with the name the guidelines give it.
    <DocsPage
      toc={toc}
      role="main"
      tableOfContent={{ container: { role: "navigation", "aria-label": "On this page" } }}
    >
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="mb-6 flex items-center gap-2">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} />
      </div>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export function DocPage({ data }: { data: PageData }) {
  const loaded = useFumadocsLoader(data)

  return (
    <DocsLayout {...baseOptions()} tree={loaded.pageTree as never}>
      <script
        type="application/ld+json"
        // The graph is built from frontmatter and from the page's own body, so
        // the markup cannot disagree with the page it describes.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            docPageGraph({
              title: data.title,
              description: data.description,
              url: data.url,
              ...(data.modified ? { modified: data.modified } : {}),
            }),
            ...(data.terms
              ? [glossaryGraph({ title: data.title, url: data.url }, data.terms)]
              : []),
          ]),
        }}
      />
      <Suspense>
        <Content data={loaded} />
      </Suspense>
    </DocsLayout>
  )
}

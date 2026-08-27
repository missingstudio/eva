import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

// `async` keeps each page's compiled body out of the entry bundle and gives
// the load/preload pair the routes use.
//
// The collection carried `lastModified: true` and it resolved to nothing for
// every page, so the sitemap shipped without a single date. `modified.ts` asks
// git directly instead, and the option is gone rather than left declaring
// something that did not happen.
export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true },
})

// The documentation is at the root of its own domain, so there is no /docs
// prefix. docs.evafactory.co/install, not docs.evafactory.co/docs/install.
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
})

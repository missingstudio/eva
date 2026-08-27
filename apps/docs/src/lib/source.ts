import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

// `async` keeps each page's compiled body out of the entry bundle and gives
// the load/preload pair the routes use.
export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true, lastModified: true },
})

// The documentation is at the root of its own domain, so there is no /docs
// prefix. docs.evafactory.co/install, not docs.evafactory.co/docs/install.
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
})

// `lastModified` is added by the collection flag above, but the conditional
// type that carries it does not survive inference through the loader. It is
// optional either way: git metadata is absent until a file is committed.
export const lastModifiedOf = (data: unknown): Date | undefined =>
  (data as { lastModified?: Date }).lastModified

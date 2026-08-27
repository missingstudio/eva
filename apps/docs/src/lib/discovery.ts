import { aiCatalogManifest, ardManifest, catalogEntry } from "@missingstudio/machine"
import { sections } from "./twins.js"

/**
 * What this origin tells an agent it offers.
 *
 * An agent that arrives at a documentation page — which is where a search
 * result usually lands one — should not have to guess that the catalog lives
 * on another host. So the documentation publishes its own, listing the pages
 * it serves and pointing at what the marketing origin holds.
 *
 * The entries are the ui package's, so the documentation's index carries the
 * same identifier here as it does in the other catalog. It is one resource.
 */
const entries = () => [
  catalogEntry.docsIndex(),
  ...sections.map((section) => catalogEntry.docsSection(section)),
  catalogEntry.docsSearch(),
  catalogEntry.siteIndex(),
  catalogEntry.skills(),
  // This origin serves both of these at its own paths as well. They are
  // catalogued because an agent that landed here must be able to find what
  // Eva costs and how to authenticate without a request to another host —
  // and under the marketing origin's identifier, because it is one document.
  catalogEntry.pricing(),
  catalogEntry.auth(),
]

export const ard = () => ardManifest(entries())
export const aiCatalog = () => aiCatalogManifest(entries())

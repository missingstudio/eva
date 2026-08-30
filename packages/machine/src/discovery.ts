import { capabilities, summary } from "./agents.js"
import { entity, external, origin } from "./site.js"

/**
 * The resource catalog both sites publish, as entries either of them can list.
 *
 * A resource is one thing with one identifier, wherever it is catalogued. The
 * documentation's index appears in the marketing site's catalog and in the
 * documentation's own, and it is the same `urn:air:` identifier in both —
 * because it is the same document, and a reader that meets it twice under two
 * names has to work out that it is not two documents.
 *
 * `Agentic Resource Discovery` names `/.well-known/ard.json` and calls
 * `/.well-known/ai-catalog.json` its predecessor. `ArdManifest` requires
 * `entries` and nothing more; the predecessor schema also requires
 * `specVersion`, refuses top-level keys it does not define, and holds
 * `representativeQueries` to between two and five. Every entry here satisfies
 * the stricter of the two, so one list serves both paths.
 *
 * Nothing here names a surface Eva does not serve. That rules out an A2A agent
 * card: its `supportedInterfaces` is a required field whose entries must be
 * live HTTPS agent endpoints, and Eva is a local program with none. A card with
 * an endpoint that refuses the connection is worse than no card, because an
 * agent spends a call to learn what the card should have told it.
 */

export type CatalogEntry = {
  identifier: string
  displayName: string
  type: string
  url: string
  description: string
  representativeQueries: readonly string[]
  tags?: readonly string[]
}

/** One area of the documentation, as the site that names its areas states it. */
export type DocsSection = {
  slug: string
  title: string
  queries: readonly string[]
}

const urn = (namespace: string, name: string) => `urn:air:evafactory.co:${namespace}:${name}`

export const catalogEntry = {
  docsIndex: (): CatalogEntry => ({
    identifier: urn("docs", "index"),
    displayName: `${entity.product.name} documentation`,
    type: "text/markdown",
    url: `${origin.docs}/llms.txt`,
    description:
      "Every documentation page as one markdown index: install, configuration, the command surface, and the plugin contract.",
    representativeQueries: [
      "how do I install eva",
      "how do I connect a model to eva",
      "what does eva -p do",
    ],
    tags: ["documentation", "cli", "coding-agent"],
  }),

  /** One area of the documentation, for an agent that needs one area. */
  docsSection: (section: DocsSection): CatalogEntry => ({
    identifier: urn("docs", section.slug),
    displayName: `${section.title} — ${entity.product.name} documentation`,
    type: "text/markdown",
    url: `${origin.docs}/${section.slug}/llms.txt`,
    description: `The ${section.slug} pages of Eva's documentation, as one markdown index.`,
    representativeQueries: section.queries,
    tags: ["documentation", section.slug],
  }),

  docsSearch: (): CatalogEntry => ({
    identifier: urn("docs", "search"),
    displayName: `${entity.product.name} documentation search index`,
    type: "application/json",
    url: `${origin.docs}/api/search`,
    description:
      "The full-text index the documentation's own search reads. Fetch it to search the documentation without a request per query.",
    representativeQueries: ["search the eva documentation", "find a page about trust"],
    tags: ["documentation", "search"],
  }),

  siteIndex: (): CatalogEntry => ({
    identifier: urn("site", "llms"),
    displayName: `${entity.product.name} agent index`,
    type: "text/markdown",
    url: `${origin.web}/llms.txt`,
    description:
      "What Eva is, when to reach for it, when not to, and how to call it from a script.",
    representativeQueries: ["when should an agent use eva", "what is eva", "is eva free"],
    tags: ["overview", "when-to-use"],
  }),

  skills: (): CatalogEntry => ({
    identifier: urn("skills", "index"),
    displayName: `${entity.product.name} agent skills`,
    // The type an entry declares is the type its URL serves. The index is
    // JSON; the skills it lists are markdown.
    type: "application/json",
    url: `${origin.web}/.well-known/agent-skills/index.json`,
    description: `The ${capabilities.length} things Eva can do today, each as a skill with the command that runs it.`,
    representativeQueries: ["what can eva do", "how do I run a coding prompt from a script"],
    tags: ["skills"],
  }),

  pricing: (): CatalogEntry => ({
    identifier: urn("pricing", "current"),
    displayName: `${entity.product.name} pricing`,
    type: "text/markdown",
    url: `${origin.web}/pricing.md`,
    description:
      "Eva is free and MIT licensed. You pay your model provider directly, and the managed service is not priced yet.",
    representativeQueries: ["how much does eva cost", "does eva have a free tier"],
    tags: ["pricing"],
  }),

  /*
    Authentication, which is the absence of it. The identifier and the URL are
    the marketing origin's on both catalogs: the documentation serves the same
    bytes at its own path, but a resource is one thing with one identifier, so
    the catalog names one location rather than minting a second id for a
    second copy of one document.
  */
  auth: (): CatalogEntry => ({
    identifier: urn("auth", "current"),
    displayName: `${entity.product.name} authentication`,
    type: "text/markdown",
    url: `${origin.web}/auth.md`,
    description:
      "Eva runs on your machine and serves no hosted API. There is no key to obtain from this publisher; a model credential is read from the environment.",
    representativeQueries: ["how do I authenticate with eva", "does eva need an api key"],
    tags: ["authentication"],
  }),

  source: (): CatalogEntry => ({
    identifier: urn("source", "repository"),
    displayName: `${entity.product.name} source`,
    type: "text/html",
    url: external.repo,
    description: `${summary} The whole tree is public and MIT licensed.`,
    representativeQueries: ["where is the eva source code", "is eva open source"],
    tags: ["source", "open-source"],
  }),
}

/**
 * What the marketing origin catalogues: the product. What it is, what it costs,
 * what it can do, and where its documentation and source are.
 */
export const webCatalog = (): CatalogEntry[] => [
  catalogEntry.docsIndex(),
  catalogEntry.siteIndex(),
  catalogEntry.skills(),
  catalogEntry.pricing(),
  catalogEntry.auth(),
  catalogEntry.source(),
]

/**
 * What the documentation origin catalogues: the pages it serves, and what the
 * marketing origin holds.
 *
 * An agent that arrives at a documentation page — which is where a search
 * result usually lands one — must not have to guess that the catalog lives on
 * another host. So the documentation publishes its own. Pricing and
 * authentication are in it because this origin serves both at its own paths,
 * and under the marketing origin's identifier, because each is one document.
 *
 * The sections are a parameter because the site that names its areas states
 * them in a module this package may not be imported into.
 */
export const docsCatalog = (sections: readonly DocsSection[]): CatalogEntry[] => [
  catalogEntry.docsIndex(),
  ...sections.map((section) => catalogEntry.docsSection(section)),
  catalogEntry.docsSearch(),
  catalogEntry.siteIndex(),
  catalogEntry.skills(),
  catalogEntry.pricing(),
  catalogEntry.auth(),
]

/** The document at `/.well-known/ard.json`. */
export const ardManifest = (entries: readonly CatalogEntry[]) => ({ entries })

/** The same catalog at the predecessor path, under the stricter schema. */
export const aiCatalogManifest = (entries: readonly CatalogEntry[]) => ({
  specVersion: "1.0",
  host: { displayName: entity.product.name },
  entries,
})

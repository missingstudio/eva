// Eva is the product, and it is open source. missing studio is the company.
// missing studio's first product is Eva as a managed service. One product,
// two ways to get it, one publisher. Nothing here may blur those apart.

export const entity = {
  product: {
    name: "Eva",
    // The tagline. README.md and docs/product.md carry the same words.
    // Changing it here alone makes the site disagree with the repository.
    tagline: "an open-source autonomous software factory.",
    description:
      "Eva is an open-source, autonomous software factory. It runs coding work end to end, from a spec a machine can check to evidence that it was done.",
  },
  company: {
    name: "Missing studio",
    // A company sentence, not a product sentence. It names no capability
    // and no category, so nothing reads the company as a piece of software.
    description: "The company behind Eva.",
    // The country the company declares on its own GitHub organisation
    // profile. It is the whole address, because a street nobody publishes is
    // not a fact this repository holds.
    country: "IN",
  },
} as const

export const origin = {
  web: "https://evafactory.co",
  docs: "https://docs.evafactory.co",
} as const

const devOrigin = {
  web: "http://localhost:3000",
  docs: "http://localhost:3001",
} as const

export const external = {
  repo: "https://github.com/missingstudio/eva",
  org: "https://github.com/missingstudio",
  npm: "https://www.npmjs.com/package/@missingstudio/eva",
  license: "https://opensource.org/licenses/MIT",
  // Where a question is answered. There is no support address, so the issue
  // tracker is the contact channel, and it answers in public.
  issues: "https://github.com/missingstudio/eva/issues",
  releases: "https://github.com/missingstudio/eva/releases",
  tap: "https://github.com/missingstudio/homebrew-tap",
  // Every profile here is one the company publishes on its own organisation
  // profile, and each one resolves. An unverified profile in `sameAs` teaches
  // an answer engine to distrust the rest of the list.
  x: "https://x.com/madebymissing",
} as const

/**
 * Every documentation page the marketing site may link to. A union rather
 * than a string, so a link to a page nobody wrote does not compile. The
 * documentation app owns the test that proves each one resolves.
 */
export const docSlugs = [
  "",
  "install",
  "connect-a-model",
  "first-run",
  "concepts",
  "software-factory",
  "use/console",
  "use/commands",
  "use/print-mode",
  "use/sessions",
  "use/cost",
  "use/themes",
  "use/keys",
  "configure/configuration",
  "configure/trust",
  "configure/models",
  "configure/providers",
  "configure/plugins",
  "extend/how-plugins-work",
  "extend/write-a-plugin",
  "reference/cli",
  "reference/exit-codes",
  "about/troubleshooting",
  "about/roadmap",
  "about/contributing",
] as const

export type DocSlug = (typeof docSlugs)[number]

// A renamed page keeps its old URL alive. A moved URL that 301s keeps the
// links and the citations that point at it; one that vanishes does not.
export const movedDocSlugs: Record<string, DocSlug> = {}

export const links = (dev = false) => {
  const web = dev ? devOrigin.web : origin.web
  const docs = dev ? devOrigin.docs : origin.docs

  return {
    web,
    docs,
    doc: (slug: DocSlug) => (slug === "" ? docs : `${docs}/${slug}`),
  }
}

export const nav = [
  { label: "Docs", href: "doc" as const, slug: "" as DocSlug },
  { label: "Roadmap", href: "doc" as const, slug: "about/roadmap" as DocSlug },
  { label: "Changelog", href: "web" as const, path: "/changelog" },
  { label: "GitHub", href: "external" as const, url: external.repo },
]

export const titleTemplate = {
  // The documentation says Eva, because those pages document the open-source
  // product. The title is where a reader learns which of the two names they
  // are looking at.
  docs: (page: string) => `${page} — Eva docs`,
  web: (page?: string) =>
    page ? `${page} — Eva` : "Eva — an open-source autonomous software factory",
} as const

export const ogSiteName = {
  docs: "Eva docs",
  web: "Eva",
} as const

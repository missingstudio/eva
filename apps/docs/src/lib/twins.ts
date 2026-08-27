/**
 * The naming rules the whole site depends on, and the work order they produce,
 * kept away from the content.
 *
 * `source.ts` reaches the compiled collection through a macro that only
 * resolves under the bundler plugin, so anything importing it needs a bundler
 * to run. These facts need no content at all, and holding them here is what
 * lets a test check them and the build read them.
 *
 * This module imports nothing, for the same reason: `vite.config.ts` reads it,
 * and Vite loads that config through Node rather than through the bundler, so
 * a bare package specifier anywhere in the import graph fails the build. The
 * slugs the work order needs are passed in rather than imported.
 */

/**
 * The areas the documentation is divided into, named as a reader would name
 * them.
 *
 * The queries are what someone would actually type when the answer is in that
 * area. The resource catalog publishes them, and Agentic Resource Discovery
 * holds a catalog entry to between two and five — so two is the floor here,
 * not a style preference.
 */
export const sections = [
  {
    slug: "use",
    title: "Using Eva",
    queries: [
      "how do I run eva without a terminal",
      "what slash commands does eva have",
      "how do I see what a run cost",
    ],
  },
  {
    slug: "configure",
    title: "Configuring Eva",
    queries: [
      "where does eva read its configuration",
      "how do I change the model eva uses",
      "why does eva ignore my .eva directory",
    ],
  },
  {
    slug: "extend",
    title: "Extending Eva",
    queries: ["how do I write an eva plugin", "how does eva's plugin kernel work"],
  },
  {
    slug: "reference",
    title: "Reference",
    queries: ["what eva flags exist", "what does eva exit code 1 mean"],
  },
  {
    slug: "about",
    title: "About",
    queries: ["what is on eva's roadmap", "how do I contribute to eva", "eva is not working"],
  },
] as const

export type Section = (typeof sections)[number]["slug"]

/**
 * The markdown twin of a documentation page. `/install` is served as HTML and
 * `/install.md` as markdown, and the root's twin is `/index.md` because `/.md`
 * is not a path.
 */
export const twinOf = (url: string) => (url === "/" ? "/index.md" : `${url}.md`)

/**
 * The twin of a documentation slug. A slug is what the content collection and
 * the build name a page by; a url is what a route sees. They differ only in
 * the root, so the slug form is stated in terms of the rule above rather than
 * beside it.
 */
export const twinOfSlug = (slug: string) => twinOf(slug === "" ? "/" : `/${slug}`)

/** One thing the build renders: the path it asks for, and where it files it. */
export type Emit = { path: string; prerender?: { outputPath: string } }

/** Where the route that renders a twin is reached, before the build files it. */
export const rawPath = (slug: string) => (slug === "" ? "/raw/" : `/raw/${slug}`)

/** The 404 body, written to the one filename static hosting looks for. */
export const notFoundPath = "/404.html"

/**
 * The build's whole work order.
 *
 * Prerender discovers a page by looking for a route with a `component`. None of
 * these has one — they answer with text — so without this list they exist in
 * the route tree, work in `vite dev`, and are absent from the deployed site.
 * That is why robots.txt, sitemap.xml, llms.txt, every raw page, and the search
 * index all answered 404 in production.
 *
 * A markdown twin is the `/raw/<slug>` route's answer, filed under the twin's
 * own name: the reader asks for `/install.md`, and `/raw/install` is what
 * renders it. One route, two names, no second copy of the page.
 *
 * Only the twin is written. Prerender keys its work by request path, so asking
 * for `/raw/install` twice — once under its own name and once under the
 * twin's — silently drops one of the two. `/raw/` keeps working in production
 * because `vercel.json` rewrites it onto the twin, not because it is written
 * a second time.
 *
 * The slugs are a parameter because they live in the ui package, which this
 * module may not import. `machine.test.ts` folds this same list, so the order
 * is checked rather than read out of the config's source.
 */
export const emittedFor = (slugs: readonly string[]): Emit[] => [
  { path: "/robots.txt" },
  { path: "/sitemap.xml" },
  { path: "/llms.txt" },
  { path: "/llms-full.txt" },
  // Both origins answer these, from one source. A reader that landed here is
  // not sent to another host to ask what Eva costs or how to authenticate.
  { path: "/pricing.md" },
  { path: "/auth.md" },
  // The search index. Without it the search dialog has nothing to read.
  { path: "/api/search" },
  // The resource catalog, at the current path and at its predecessor.
  { path: "/.well-known/ard.json" },
  { path: "/.well-known/ai-catalog.json" },
  { path: "/.well-known/agent-skills/index.json" },
  ...sections.map((section) => ({ path: `/${section.slug}/llms.txt` })),
  ...slugs.map((slug) => ({
    path: rawPath(slug),
    prerender: { outputPath: twinOfSlug(slug) },
  })),
  { path: "/404", prerender: { outputPath: notFoundPath } },
]

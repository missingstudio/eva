/**
 * Both sites' `vercel.json`, generated from the lists the sites already hold.
 *
 * The edge cannot derive which paths have a markdown twin: `vercel.json` is a
 * static file that Vercel reads *before* the build runs, so it cannot be an
 * output. It has to be committed — and it was written by hand, which meant a
 * new page needed four edits in one file and nothing said so when it got three.
 *
 * The alternation is not ceremony. Without it `/:page` matches `/llms.txt` and
 * `/robots.txt`, and a reader asking for `text/markdown` — which is exactly
 * what an agent fetching llms.txt sends — is rewritten onto a file that does
 * not exist. The list is what says "these paths, and no others, have twins."
 *
 * Usage:
 *   bun scripts/vercel-config.ts          # write both files
 *   bun scripts/vercel-config.ts --check  # fail if either is out of date
 */

import { writeFileSync } from "node:fs"
import process from "node:process"
// Paths into the packages rather than their names: `scripts/` is not a
// workspace package, so a bare specifier does not resolve here.
import { pagePaths } from "../apps/www/src/lib/pages.js"
import { sections } from "../apps/docs/src/lib/twins.js"
import { docSlugs } from "../packages/machine/src/site.js"
import { json, markdown, plain } from "../packages/machine/src/serve.js"

/** The content type a route answers with, so the edge states the same one. */
const type = (response: Response) => response.headers.get("content-type")!

/*
  `Accept: text/markdown;q=0` means never. A pattern that only looks for the
  type would answer with the one representation the reader ruled out, so the
  refusal is matched first and sent to the markup.
*/
const refusesMarkdown = {
  type: "header",
  key: "accept",
  value: ".*text/markdown\\s*;\\s*q=0(\\.0+)?([,;].*)?$",
}
const acceptsMarkdown = { type: "header", key: "accept", value: ".*text/markdown.*" }
// An escape hatch for a reader that cannot set a header.
const asksForAgentMode = { type: "query", key: "mode", value: "agent" }

/** The three rules one negotiable path needs, in the order they must match. */
const negotiate = (source: string, markup: string, twin: string) => [
  { source, has: [refusesMarkdown], destination: markup },
  { source, has: [acceptsMarkdown], destination: twin },
  { source, has: [asksForAgentMode], destination: twin },
]

const group = (param: string, names: readonly string[]) => `/:${param}(${names.join("|")})`

const linkHeader = (...links: string[]) => ({ key: "link", value: links.join(", ") })
const alternate = (twin: string) => `<${twin}>; rel="alternate"; type="text/markdown"`
const describedBy = (index: string) => `<${index}>; rel="describedby"; type="text/plain"`
const sitemap = '</sitemap.xml>; rel="sitemap"'
const catalog = '</.well-known/ard.json>; rel="ard"; type="application/json"'

// `Accept-Encoding` travels with `Accept` because the edge compresses and the
// route does not. It is the edge's to add, not a divergence from the route.
const negotiated = { key: "vary", value: "Accept, Accept-Encoding" }
// Without this a browser-based agent cannot read these files cross-origin.
const anyOrigin = { key: "access-control-allow-origin", value: "*" }

const shell = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  installCommand: "bun install --frozen-lockfile",
  buildCommand: "bun run build",
  outputDirectory: "dist/client",
}

/** The marketing origin: a flat set of pages, each with a twin. */
const web = () => {
  const pages = pagePaths.filter((path) => path !== "").map((path) => path.slice(1))
  const named = group("page", pages)

  return {
    ...shell,
    rewrites: [
      ...negotiate("/", "/index.html", "/index.md"),
      ...negotiate(named, "/:page/index.html", "/:page.md"),
    ],
    headers: [
      {
        source: "/assets/(.*)",
        headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/(.*).md",
        headers: [{ key: "content-type", value: type(markdown("")) }, negotiated, anyOrigin],
      },
      {
        source: "/llms.txt",
        headers: [{ key: "content-type", value: type(plain("")) }, anyOrigin],
      },
      {
        source: "/.well-known/(.*).json",
        headers: [{ key: "content-type", value: type(json({})) }, anyOrigin],
      },
      {
        source: "/",
        headers: [
          negotiated,
          linkHeader(sitemap, alternate("/index.md"), describedBy("/llms.txt"), catalog),
        ],
      },
      { source: named, headers: [negotiated, linkHeader(sitemap, alternate("/:page.md"))] },
    ],
  }
}

/** The documentation origin: pages at the root and pages inside a section. */
const docs = () => {
  const top = docSlugs.filter((slug) => slug !== "" && !slug.includes("/"))
  const named = group("page", top)
  const inSection = `${group(
    "section",
    sections.map((section) => section.slug),
  )}/:page`

  return {
    ...shell,
    rewrites: [
      ...negotiate("/", "/index.html", "/index.md"),
      ...negotiate(named, "/:page/index.html", "/:page.md"),
      ...negotiate(inSection, "/:section/:page/index.html", "/:section/:page.md"),
      // `/raw/<slug>` is the route that renders a twin. The build files each
      // answer under the twin's own name, so these point at the file rather
      // than rendering it a second time.
      { source: "/raw", destination: "/index.md" },
      { source: "/raw/:page", destination: "/:page.md" },
      { source: "/raw/:section/:page", destination: "/:section/:page.md" },
    ],
    headers: [
      {
        source: "/assets/(.*)",
        headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/(.*).md",
        headers: [{ key: "content-type", value: type(markdown("")) }, negotiated, anyOrigin],
      },
      // Every scoped index as well as the root one, which is why the pattern
      // is not anchored the way the marketing origin's is.
      {
        source: "/(.*)llms.txt",
        headers: [{ key: "content-type", value: type(plain("")) }, anyOrigin],
      },
      {
        source: "/api/search",
        headers: [{ key: "content-type", value: type(json({})) }, anyOrigin],
      },
      {
        source: "/.well-known/(.*).json",
        headers: [{ key: "content-type", value: type(json({})) }, anyOrigin],
      },
      {
        source: "/",
        headers: [
          negotiated,
          linkHeader(sitemap, alternate("/index.md"), describedBy("/llms.txt"), catalog),
        ],
      },
      { source: named, headers: [negotiated, linkHeader(sitemap, alternate("/:page.md"))] },
      {
        source: inSection,
        headers: [
          negotiated,
          linkHeader(sitemap, alternate("/:section/:page.md"), describedBy("/:section/llms.txt")),
        ],
      },
    ],
  }
}

export const configs = () => ({ "apps/www/vercel.json": web(), "apps/docs/vercel.json": docs() })
export const render = (config: unknown) => `${JSON.stringify(config, null, 2)}\n`

if (import.meta.main) {
  const checking = process.argv.includes("--check")
  for (const [path, config] of Object.entries(configs())) {
    const body = render(config)

    if (checking) {
      const { readFileSync } = await import("node:fs")
      if (readFileSync(path, "utf8") !== body) {
        console.error(`${path} is out of date. Run: bun scripts/vercel-config.ts`)
        process.exit(1)
      }
      console.log(`ok  ${path}`)
    } else {
      writeFileSync(path, body)
      console.log(`wrote ${path}`)
    }
  }
}

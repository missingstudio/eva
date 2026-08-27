import { agentSkillFields, capabilities, origin, resources } from "@missingstudio/machine"
import { json, markdown, plain } from "@missingstudio/machine/serve"
import { readdirSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { agentSkills, aiCatalog, ard, skill } from "./discovery.js"
import { llmsTxt, markdownPages } from "./markdown.js"
import { machinePathsFor, pagePaths, skillPath, twinOf } from "./pages.js"

const routes = fileURLToPath(new URL("../routes", import.meta.url))
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
const vercel = JSON.parse(read("../../vercel.json")) as {
  rewrites: { source: string; destination: string; has?: unknown[] }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

/** Every alternative named inside a `:param(a|b|c)` pattern. */
const alternatives = (source: string) =>
  [...source.matchAll(/:[a-z]+\(([^)]+)\)/g)].flatMap((match) => match[1]!.split("|"))

/** The pages the edge names one at a time, without their leading slash. */
const named = pagePaths.filter((path) => path !== "").map((path) => path.slice(1))

/** What a route actually sends, so the edge can be checked against it. */
const typeOf = (response: Response) => response.headers.get("content-type")
const paths = machinePathsFor(capabilities.map((capability) => capability.name))
const sha256 = (body: string) => createHash("sha256").update(body, "utf8").digest("hex")

/**
 * The path a route file serves, worked out the way the route generator works
 * it out: `[.]` escapes a dot into the segment, and every other dot separates
 * segments. `sitemap[.]xml.ts` serves /sitemap.xml, and
 * `[.]well-known.ard[.]json.ts` serves /.well-known/ard.json.
 */
const pathOf = (file: string) => {
  // An escaped dot is held aside while the separating dots become slashes.
  const held = "\u0000"

  return `/${file
    .replace(/\.tsx?$/, "")
    .replaceAll("[.]", held)
    .split(".")
    .join("/")
    .replaceAll(held, ".")}`
}

const routeFiles = () => readdirSync(routes).filter((name) => /\.tsx?$/.test(name))

// A route that answers with text has no component, so prerender cannot find
// it. These are the files the emit list has to name.
const textRoutes = () =>
  routeFiles().filter((name) => name.endsWith(".ts") && name !== "routeTree.gen.ts")

describe("the emit list", () => {
  /*
    This is the check that would have caught the whole defect. robots.txt,
    sitemap.xml and llms.txt existed as routes, worked in `vite dev`, and 404ed
    in production for as long as the sites were deployed, because prerender
    discovers a route by looking for a component and none of them has one.
  */
  test("names every route that answers with text", () => {
    const dynamic = (path: string) => path.includes("$")

    for (const file of textRoutes()) {
      const path = pathOf(file)
      if (dynamic(path)) continue

      expect(paths, `${file} serves ${path} and nothing emits it`).toContain(path)
    }
  })

  test("names a route for every path it lists", () => {
    const served = new Set(textRoutes().map(pathOf))

    for (const path of paths) {
      // A skill is served by one dynamic route rather than by a file each.
      if (path.startsWith("/.well-known/agent-skills/") && path.endsWith("/SKILL.md")) continue

      expect(served, `${path} is emitted and no route serves it`).toContain(path)
    }
  })

  test("names each path once", () => {
    expect(new Set(paths).size).toBe(paths.length)
  })

  test("gives every page a markdown twin", () => {
    for (const page of pagePaths) {
      expect(paths, `${page || "/"} has no twin`).toContain(twinOf(page))
    }
  })

  test("gives every capability a skill", () => {
    for (const capability of capabilities) {
      expect(paths).toContain(skillPath(capability.name))
    }
  })
})

describe("the sitemap", () => {
  // The sitemap listed the home page and the changelog, and the privacy page
  // was reachable only from the footer. This is the check that would have
  // caught it.
  test("lists every page the site serves", () => {
    const pages = routeFiles()
      .filter((name) => name.endsWith(".tsx") && name !== "__root.tsx" && !name.includes("["))
      // The 404 body is a page the build renders to a file and the sitemap
      // must not advertise: it is what a crawler gets when it is lost.
      .filter((name) => name !== "404.tsx")
      .map((name) => name.slice(0, -4))
      .map((name) => (name === "index" ? "" : `/${name}`))

    expect([...pagePaths].sort()).toEqual(pages.sort())
  })

  test("names each page once", () => {
    expect(new Set(pagePaths).size).toBe(pagePaths.length)
  })
})

describe("every markdown body", () => {
  const bodies = Object.entries(markdownPages).map(([path, render]) => [path, render()] as const)

  test("starts with a level-one heading", () => {
    // An agent that asked for markdown and got a body starting with `<` has
    // been told a lie about the content type.
    for (const [path, body] of bodies) {
      expect(body.startsWith("# "), `${path} starts "${body.slice(0, 20)}"`).toBe(true)
    }
  })

  test("carries no markup", () => {
    for (const [path, body] of bodies) {
      expect(body, path).not.toMatch(/<\/?(html|div|p|span|script)\b/i)
    }
  })

  test("says enough to be worth fetching", () => {
    for (const [path, body] of bodies) {
      expect(body.length, `${path} is ${body.length} chars`).toBeGreaterThan(150)
    }
  })

  /*
    The pages an agent reads to decide whether a publisher is real. The
    threshold is the one the readers in the field use, and it applies to the
    twin as well as to the page: an agent that follows the markdown
    advertisement must not land on less than the reader who did not.
  */
  test("the trust anchors and the pricing carry 500 characters each", () => {
    for (const path of ["/index.md", "/about.md", "/contact.md", "/privacy.md", "/pricing.md"]) {
      const body = markdownPages[path as keyof typeof markdownPages]()
      expect(body.length, `${path} is ${body.length} chars`).toBeGreaterThan(500)
    }
  })

  test("ends with exactly one newline", () => {
    for (const [path, body] of bodies) {
      expect(body.endsWith("\n"), path).toBe(true)
      expect(body.endsWith("\n\n"), path).toBe(false)
    }
  })
})

describe("llms.txt", () => {
  const body = llmsTxt()

  test("opens with a heading and a blockquote summary", () => {
    const [heading, blank, quote] = body.split("\n")
    expect(heading).toMatch(/^# /)
    expect(blank).toBe("")
    expect(quote).toMatch(/^> /)
  })

  test("says when to reach for Eva, and when not to", () => {
    // Generic marketing copy does not read as guidance. The test pins the
    // guidance rather than the words: both lists have to be there.
    expect(body).toContain("## When to use Eva")
    expect(body).toContain("## When not to use Eva")
  })

  test("names the command an agent would run", () => {
    expect(body).toContain("eva -p")
  })

  test("is an index of links rather than a manual", () => {
    const links = body.match(/\[[^\]]+\]\(https:\/\/[^)]+\)/g) ?? []
    expect(links.length).toBeGreaterThan(10)
  })

  test("stays under the length a reader will accept", () => {
    expect(body.length).toBeLessThan(30_000)
  })

  test("links every page this site serves", () => {
    // The other direction. A page could ship, be routed, be twinned, and be
    // absent from the one index an agent actually reads.
    for (const path of pagePaths) {
      expect(body, `llms.txt never links ${path || "/"}`).toContain(`${origin.web}${twinOf(path)}`)
    }
  })

  test("links no page this site does not serve", () => {
    const own = body.match(/\(https:\/\/evafactory\.co([^)]*)\)/g) ?? []
    const known = new Set<string>([...pagePaths, ...paths, ""])

    for (const link of own) {
      const path = link.slice("(https://evafactory.co".length, -1)
      expect(known, `llms.txt links ${path || "/"}`).toContain(path)
    }
  })
})

describe("the discovery documents", () => {
  test("the catalog declares the predecessor schema's required fields", () => {
    const catalog = aiCatalog()
    expect(catalog.specVersion).toBe("1.0")
    expect(catalog.host.displayName).toBeTruthy()
    expect(catalog.entries.length).toBeGreaterThan(0)
  })

  test("both catalogs carry the same entries", () => {
    expect(ard().entries).toEqual(aiCatalog().entries)
  })

  test("every entry has an identifier in the specified form", () => {
    for (const entry of ard().entries) {
      expect(entry.identifier).toMatch(/^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/)
    }
  })

  test("every entry has exactly one of a url or inline data", () => {
    for (const entry of ard().entries) {
      expect(typeof entry.url, entry.identifier).toBe("string")
      expect("data" in entry, entry.identifier).toBe(false)
    }
  })

  test("every entry carries two to five representative queries", () => {
    // The predecessor schema enforces the bounds. The current one warns.
    for (const entry of ard().entries) {
      expect(entry.representativeQueries.length, entry.identifier).toBeGreaterThanOrEqual(2)
      expect(entry.representativeQueries.length, entry.identifier).toBeLessThanOrEqual(5)
    }
  })

  test("no entry names a surface Eva does not serve", () => {
    // An A2A card, an MCP server card, or an OpenAPI document would each
    // promise a hosted endpoint. Eva is a local program and has none.
    const json = JSON.stringify(ard())
    for (const absent of ["a2a", "mcp", "openapi", "oauth"]) {
      expect(json.toLowerCase()).not.toContain(absent)
    }
  })
})

describe("the agent skills index", () => {
  const index = agentSkills(sha256)

  /*
    The one place the version is written as a literal. Everything else — the
    documentation's index, the pre-deploy prober — folds the constant, so this
    is what pins the value a client actually matches on.
  */
  test("declares the schema version clients match on", () => {
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json")
  })

  test("every skill carries all five required fields", () => {
    for (const entry of index.skills) {
      expect(Object.keys(entry).sort()).toEqual([...agentSkillFields])
    }
  })

  test("every name fits the specified shape", () => {
    for (const entry of index.skills) {
      expect(entry.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(entry.name.length).toBeLessThanOrEqual(64)
    }
  })

  test("every type is one the draft defines", () => {
    for (const entry of index.skills) expect(["skill-md", "archive"]).toContain(entry.type)
  })

  test("every description stays inside the limit", () => {
    for (const entry of index.skills) {
      expect(entry.description.length, entry.name).toBeGreaterThan(0)
      expect(entry.description.length, entry.name).toBeLessThanOrEqual(1024)
    }
  })

  test("every digest is the hash of the bytes the url serves", () => {
    for (const entry of index.skills) {
      const body = skill(entry.name)!
      expect(entry.digest, entry.name).toBe(`sha256:${sha256(body)}`)
      expect(entry.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  test("a skill's frontmatter name matches its parent directory", () => {
    for (const entry of index.skills) {
      const body = skill(entry.name)!
      const declared = body.match(/^name:\s*(.+)$/m)?.[1]
      const directory = entry.url.split("/").at(-2)

      expect(declared).toBe(entry.name)
      expect(directory).toBe(entry.name)
    }
  })

  test("a skill's description matches the index entry", () => {
    for (const entry of index.skills) {
      expect(skill(entry.name)!).toContain(`description: ${entry.description}`)
    }
  })

  test("an unknown skill has no body to serve", () => {
    expect(skill("no-such-skill")).toBeUndefined()
  })
})

describe("every skill body", () => {
  test("opens its prose with a heading and shows the command", () => {
    for (const capability of capabilities) {
      const body = skill(capability.name)!
      const prose = body.slice(body.indexOf("---", 3) + 3).trimStart()

      expect(prose.startsWith("# "), capability.name).toBe(true)
      expect(body).toContain(capability.command)
    }
  })

  test("says there is no hosted endpoint to call", () => {
    // The one thing an agent must not guess wrong about a local-first program.
    for (const capability of capabilities) {
      expect(skill(capability.name)!).toContain("no hosted endpoint")
    }
  })
})

/*
  The build turns every route into a static file, and a static file's headers
  and content negotiation come from `vercel.json` — which no route imports and
  no type checks. This is where the two are made to agree.
*/
describe("the edge configuration", () => {
  /*
    A rewrite naming pages one at a time is a rewrite that goes stale when a
    page is added. It cannot be derived at the edge, because vercel.json is a
    static file — so it is pinned here instead. A new page fails this test
    rather than silently losing its markdown twin.
  */
  test("negotiates markdown for every page", () => {
    const pages = new Set(
      vercel.rewrites
        .filter((rule) => rule.source.startsWith("/:page("))
        .flatMap((rule) => alternatives(rule.source)),
    )

    for (const page of named) expect(pages, `no rewrite names ${page}`).toContain(page)
  })

  test("negotiates markdown for the home page", () => {
    // The root cannot be named in a `:page(…)` group, so it carries its own
    // rules and would be the one page to lose its twin unnoticed.
    const root = vercel.rewrites.filter((rule) => rule.source === "/")

    expect(root.length).toBeGreaterThan(0)
    expect(root.some((rule) => rule.destination === twinOf(""))).toBe(true)
  })

  test("names no page the site does not serve", () => {
    for (const rule of [...vercel.rewrites, ...vercel.headers]) {
      for (const page of alternatives(rule.source)) {
        expect(named, `${rule.source} names ${page}`).toContain(page)
      }
    }
  })

  test("answers a request for markdown with markdown", () => {
    const negotiated = vercel.rewrites.filter((rule) =>
      JSON.stringify(rule.has ?? []).includes("text/markdown"),
    )

    expect(negotiated.length).toBeGreaterThan(0)

    for (const rule of negotiated) {
      // A rule either serves the twin or, for a refused type, the markup.
      const serves = rule.destination.endsWith(".md") || rule.destination.endsWith(".html")
      expect(serves, `${rule.source} sends ${rule.destination}`).toBe(true)
    }
  })

  test("refuses markdown when the reader gave it a zero quality", () => {
    // `Accept: text/markdown;q=0` means never. A regex that only looks for the
    // type would answer with the one representation the reader ruled out.
    const refusals = vercel.rewrites.filter((rule) =>
      JSON.stringify(rule.has ?? []).includes("q=0"),
    )

    expect(refusals.length).toBeGreaterThan(0)
    for (const rule of refusals) expect(rule.destination).toContain(".html")
  })

  test("varies on Accept wherever it negotiates", () => {
    // Without this a cache hands the markdown to a reader who asked for the
    // markup, or the other way round, depending on which arrived first.
    const negotiated = new Set(
      vercel.rewrites
        .filter((rule) => JSON.stringify(rule.has ?? []).includes("text/markdown"))
        .map((rule) => rule.source),
    )

    for (const source of negotiated) {
      const rule = vercel.headers.find((entry) => entry.source === source)
      const vary = rule?.headers.find((header) => header.key === "vary")

      expect(vary?.value, `${source} negotiates without a vary`).toContain("Accept")
    }
  })

  /*
    The three types the edge states are the three the routes state. Each pair
    was a matching literal in two files that nothing compared, so the edge could
    be corrected and the route left behind, or the reverse.
  */
  test("states the types the routes state", () => {
    const typeAt = (ending: string) =>
      vercel.headers
        .find((entry) => entry.source.endsWith(ending))
        ?.headers.find((header) => header.key === "content-type")?.value

    expect(typeAt(".md")).toBe(typeOf(markdown("")))
    expect(typeAt("llms.txt")).toBe(typeOf(plain("")))
    expect(typeAt(".json")).toBe(typeOf(json({})))
  })

  test("advertises the sitemap and the twin in a Link header", () => {
    const root = vercel.headers.find((entry) => entry.source === "/")
    const link = root?.headers.find((header) => header.key === "link")

    expect(link?.value).toContain('rel="sitemap"')
    expect(link?.value).toContain('type="text/markdown"')
  })
})

/*
  The list an agent is handed when it asks where to go next. Every path in it
  is meant to be a file this site emits, and nothing said so — an entry could
  name a path the build never wrote and the only reader to find out would be
  the agent that followed it.
*/
describe("where an agent is sent next", () => {
  test("every path it names is one this site serves", () => {
    const served = new Set<string>([...paths, ...pagePaths])

    for (const resource of resources) {
      // An absolute URL is another host's to answer for, and `docs` names the
      // other origin rather than a path on this one.
      if (resource.path.startsWith("http") || !resource.path.startsWith("/")) continue

      expect(served, `${resource.name} points at ${resource.path}`).toContain(resource.path)
    }
  })

  test("names each resource once", () => {
    const names = resources.map((resource) => resource.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

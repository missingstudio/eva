import {
  authMarkdown,
  catalogEntry,
  docPageEntities,
  docPageGraph,
  docSlugs,
  pricingMarkdown,
} from "@missingstudio/machine"
import { json, markdown, plain } from "@missingstudio/machine/serve"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { aiCatalog, ard } from "./discovery.js"
import { modifiedOn } from "./modified.js"
import { asksQuestions, questionsIn } from "./questions.js"
import { taught, taughtSlugs } from "./skills.js"
import { emittedFor, notFoundPath, rawPath, sections, twinOf, twinOfSlug } from "./twins.js"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
const vercel = JSON.parse(read("../../vercel.json")) as {
  rewrites: { source: string; destination: string; has?: unknown[] }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

/** Every alternative named inside a `:param(a|b|c)` pattern. */
const alternatives = (source: string) =>
  [...source.matchAll(/:[a-z]+\(([^)]+)\)/g)].flatMap((match) => match[1]!.split("|"))

const topLevel = docSlugs.filter((slug) => slug !== "" && !slug.includes("/"))
const nested = docSlugs.filter((slug) => slug.includes("/"))

describe("the twin rule", () => {
  test("the root's twin is the index, and a page's twin is its own path", () => {
    expect(twinOf("/")).toBe("/index.md")
    expect(twinOf("/install")).toBe("/install.md")
    expect(twinOf("/use/console")).toBe("/use/console.md")
  })
})

describe("the sections", () => {
  // src/lib/llms.ts names them for a reader, vite.config.ts names them for the
  // build, and vercel.json names them for the edge. Three lists that have to
  // be the same list.
  test("are the directories the content actually has", () => {
    const found = new Set(nested.map((slug) => slug.split("/")[0]))
    expect(new Set(sections.map((section) => section.slug))).toEqual(found)
  })

  test("are the ones the build emits an index for", () => {
    const emitted = new Set(emittedFor(docSlugs).map((entry) => entry.path))

    for (const section of sections) {
      expect(emitted, `nothing emits the ${section.slug} index`).toContain(
        `/${section.slug}/llms.txt`,
      )
    }
  })

  test("each carries two to five queries a reader would actually type", () => {
    // The resource catalog publishes them, and the predecessor schema holds a
    // catalog entry to between two and five.
    for (const section of sections) {
      expect(section.queries.length, section.slug).toBeGreaterThanOrEqual(2)
      expect(section.queries.length, section.slug).toBeLessThanOrEqual(5)

      for (const query of section.queries) {
        // A question, not a keyword. A catalog full of nouns matches nothing a
        // person asks.
        expect(query.split(" ").length, query).toBeGreaterThan(2)
        expect(query.endsWith("?"), query).toBe(false)
      }
    }
  })
})

describe("the edge configuration", () => {
  /*
    A rewrite naming pages one at a time is a rewrite that goes stale when a
    page is added. It cannot be derived at the edge, because vercel.json is a
    static file — so it is pinned here instead. A new page fails this test
    rather than silently losing its markdown twin.
  */
  test("negotiates markdown for every top-level page", () => {
    const named = new Set(
      vercel.rewrites
        .filter((rule) => rule.source.startsWith("/:page("))
        .flatMap((rule) => alternatives(rule.source)),
    )

    for (const slug of topLevel) expect(named, `no rewrite names ${slug}`).toContain(slug)
  })

  test("negotiates markdown for every section", () => {
    const named = new Set(
      vercel.rewrites
        .filter((rule) => rule.source.startsWith("/:section("))
        .flatMap((rule) => alternatives(rule.source)),
    )

    for (const section of sections) expect(named).toContain(section.slug)
  })

  test("names no page the content does not have", () => {
    const pages = new Set<string>([...topLevel, ...sections.map((section) => section.slug)])

    for (const rule of [...vercel.rewrites, ...vercel.headers]) {
      for (const named of alternatives(rule.source)) {
        expect(pages, `${rule.source} names ${named}`).toContain(named)
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
    const typeOf = (response: Response) => response.headers.get("content-type")
    const stated = (source: string) =>
      vercel.headers
        .find((entry) => entry.source.endsWith(source))
        ?.headers.find((header) => header.key === "content-type")?.value

    expect(stated(".md")).toBe(typeOf(markdown("")))
    expect(stated("llms.txt")).toBe(typeOf(plain("")))
    expect(stated("/api/search")).toBe(typeOf(json({})))
  })

  test("advertises the sitemap and the twin in a Link header", () => {
    const root = vercel.headers.find((entry) => entry.source === "/")
    const link = root?.headers.find((header) => header.key === "link")

    expect(link?.value).toContain('rel="sitemap"')
    expect(link?.value).toContain('type="text/markdown"')
  })

  test("keeps the raw endpoint reachable", () => {
    // /raw/* is the route that renders a twin. It answered 404 in production
    // for as long as the site was deployed; these rewrites are what fix it.
    const raw = vercel.rewrites.filter((rule) => rule.source.startsWith("/raw"))

    expect(raw.length).toBe(3)
    for (const rule of raw) expect(rule.destination).toContain(".md")
  })
})

describe("the resource catalog this origin publishes", () => {
  test("lists the index, every section, and the search index", () => {
    const urls = ard().entries.map((entry) => entry.url)

    expect(urls).toContain("https://docs.evafactory.co/llms.txt")
    expect(urls).toContain("https://docs.evafactory.co/api/search")
    for (const section of sections) {
      expect(urls, section.slug).toContain(`https://docs.evafactory.co/${section.slug}/llms.txt`)
    }
  })

  test("points at what the other origin holds rather than copying it", () => {
    const urls = ard().entries.map((entry) => entry.url)

    expect(urls).toContain("https://evafactory.co/llms.txt")
    expect(urls).toContain("https://evafactory.co/.well-known/agent-skills/index.json")
  })

  test("names the documentation index with the identifier the other catalog uses", () => {
    // One resource, one identifier, in every catalog that lists it.
    const entry = ard().entries.find((item) => item.url.endsWith("docs.evafactory.co/llms.txt"))
    expect(entry?.identifier).toBe(catalogEntry.docsIndex().identifier)
  })

  test("every entry meets the stricter of the two schemas", () => {
    const catalog = aiCatalog()

    expect(catalog.specVersion).toBe("1.0")
    expect(catalog.host.displayName).toBeTruthy()

    for (const entry of catalog.entries) {
      expect(entry.identifier).toMatch(/^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/)
      expect(entry.displayName).toBeTruthy()
      expect(entry.type).toBeTruthy()
      expect(entry.url).toMatch(/^https:\/\//)
      expect(entry.representativeQueries.length, entry.identifier).toBeGreaterThanOrEqual(2)
      expect(entry.representativeQueries.length, entry.identifier).toBeLessThanOrEqual(5)
    }
  })

  test("names each resource once", () => {
    const ids = ard().entries.map((entry) => entry.identifier)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("both paths carry the same entries", () => {
    expect(ard().entries).toEqual(aiCatalog().entries)
  })
})

describe("a documentation page's structured data", () => {
  const entities = docPageEntities()
  const page = docPageGraph({
    title: "Install",
    description: "Install Eva.",
    url: "https://docs.evafactory.co/install",
  })

  /*
    The page graph names the company and the product by id, and those ids are
    apex URLs. A reader that fetches one documentation page and nothing else
    used to be handed two references it could not resolve.
  */
  test("declares every node the page references", () => {
    const declared = new Set(entities["@graph"].map((node) => node["@id"]))

    for (const reference of [page.about, page.publisher, page.isPartOf]) {
      const id = (reference as { "@id": string })["@id"]
      expect(declared, `${id} is referenced but never declared`).toContain(id)
    }
  })

  test("says who publishes it, and how to reach them", () => {
    const company = entities["@graph"].find((node) => node["@type"] === "Organization")!

    expect(company["contactPoint"]).toBeTruthy()
    expect(company["address"]).toBeTruthy()
  })

  test("the documentation is a site of its own, about the product", () => {
    const site = entities["@graph"].find((node) => node["@type"] === "WebSite")!

    expect(site["url"]).toBe("https://docs.evafactory.co")
    expect(site["about"]).toEqual({ "@id": "https://evafactory.co/#eva" })
  })
})

describe("the skills these pages teach", () => {
  test("every skill names a page that exists", () => {
    for (const slug of taughtSlugs) expect(docSlugs, slug).toContain(slug)
  })

  test("every skill is named once, in the shape the draft allows", () => {
    const names = taught.map((skill) => skill.name)

    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(name.length).toBeLessThanOrEqual(64)
    }
  })

  test("every description says what it does and when to reach for it", () => {
    for (const skill of taught) {
      expect(skill.description.length, skill.name).toBeGreaterThan(80)
      expect(skill.description.length, skill.name).toBeLessThanOrEqual(1024)
      expect(skill.description, skill.name).toContain("Use when")
    }
  })

  test("this list is not the marketing origin's list", () => {
    // That one publishes what the program can do. This one publishes what the
    // documentation can teach, and each skill is a page.
    expect(taught.map((skill) => skill.name)).not.toContain("answer-once")
  })
})

describe("the files both origins answer", () => {
  /*
    An origin is read, and scored, on its own. A reader that lands on a
    documentation page and wants to know what Eva costs, or which credential it
    needs, must not be told to go and ask another host.
  */
  test("pricing states one price, and no tier that does not exist", () => {
    const body = pricingMarkdown()

    expect(body.startsWith("# Pricing")).toBe(true)
    expect(body).toContain("0 USD")
    expect(body).toContain("MIT")
    expect(body.length).toBeGreaterThan(500)
    // A table with rows Eva does not sell is a claim an agent will quote.
    expect(body).not.toMatch(/\|\s*(Pro|Team|Enterprise|Starter)\s*\|/i)
  })

  test("auth answers every section the draft prescribes", () => {
    const body = authMarkdown()

    expect(body.startsWith("# Authentication")).toBe(true)
    for (const heading of [
      "## Discover",
      "## Pick a method",
      "## Register",
      "## Claim",
      "## Use the credential",
      "## Errors",
      "## Revocation",
    ]) {
      expect(body, `auth.md has no ${heading}`).toContain(heading)
    }
  })

  test("auth uses the spec's own words, so a reader searching for them finds them", () => {
    // A reader looks for these terms. Saying "there is no `register_uri`" is
    // an answer; omitting the word leaves the reader unsure the file is about
    // what they came for.
    const body = authMarkdown()

    for (const keyword of ["register_uri", "claim_uri", "WWW-Authenticate", "agent_auth"]) {
      expect(body, `auth.md never mentions ${keyword}`).toContain(keyword)
    }
  })

  test("auth names no URL that would be probed and found missing", () => {
    /*
      The scan fetches any URI the file names, and an invented endpoint is
      worse than an absent one: it costs the reader a request and tells it
      something false. The keywords above are prose; these are addresses, and
      every one has to be a page that exists.
    */
    const urls = authMarkdown().match(/https?:\/\/[^\s)`]+/g) ?? []
    const pages = new Set(docSlugs.map((slug) => `https://docs.evafactory.co/${slug}`))

    expect(urls.length).toBeGreaterThan(0)

    for (const url of urls) {
      const known = pages.has(url) || url.startsWith("https://evafactory.co/")
      expect(known, `auth.md names ${url}`).toBe(true)
    }
  })

  test("auth says plainly that there is no credential to obtain", () => {
    const body = authMarkdown().toLowerCase()

    expect(body).toContain("no eva account")
    expect(body).toContain("connect-a-model")
  })
})

describe("the questions a troubleshooting page carries", () => {
  const page = read("../../content/docs/about/troubleshooting.mdx")
  const questions = questionsIn(page)

  test("every section becomes a question with an answer", () => {
    expect(questions.length).toBeGreaterThan(3)

    for (const entry of questions) {
      expect(entry.question.length, entry.question).toBeGreaterThan(5)
      expect(entry.answer.length, entry.question).toBeGreaterThan(40)
    }
  })

  test("an answer carries no markup an engine would lift verbatim", () => {
    for (const entry of questions) {
      expect(entry.answer, entry.question).not.toMatch(/[<>`*]|\]\(/)
    }
  })

  test("a section with nothing to answer with is dropped", () => {
    // The filter is on the answer, not on the heading: a section that is only
    // a heading carries nothing an engine can lift.
    expect(questionsIn("## A heading and nothing else\n\n## Another\n\nx\n")).toEqual([])
  })

  /*
    `questionsIn` is a mechanical extractor: any page with `##` sections yields
    something. What makes a page a FAQ is the caller, and only one page here is
    written as symptoms — so the gate lives in the loader and is checked here.
  */
  test("only the troubleshooting page publishes its sections as questions", () => {
    expect(asksQuestions("/about/troubleshooting")).toBe(true)

    for (const slug of docSlugs) {
      if (slug === "about/troubleshooting") continue
      expect(asksQuestions(slug === "" ? "/" : `/${slug}`), slug).toBe(false)
    }

    // A page of prose has headings too, and they are not questions.
    expect(questionsIn(read("../../content/docs/concepts.mdx")).length).toBeGreaterThan(0)
  })
})

describe("when a page last changed", () => {
  /*
    The collection declared `lastModified: true` and every page's date came back
    undefined, so the sitemap shipped 25 URLs and no dates at all. Nothing
    failed, because a missing date is allowed. These are the checks that make
    the silence audible.
  */
  test("git can say, for every page it has seen", () => {
    // A page nobody has committed yet has no date, which is correct: the
    // sitemap leaves its `lastmod` out rather than claiming today. So the
    // check is that the mechanism works, not that every file is committed.
    const dated = docSlugs.filter((slug) => modifiedOn(slug === "" ? "/" : `/${slug}`))

    expect(dated.length, "no page carries a date at all").toBeGreaterThan(0)
    expect(modifiedOn("/install"), "a long-committed page has no date").toBeTruthy()
  })

  test("the date is a day, not a timestamp or a build clock", () => {
    for (const slug of docSlugs) {
      const date = modifiedOn(slug === "" ? "/" : `/${slug}`)
      if (date) expect(date, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  test("a page nobody wrote has no date rather than today's", () => {
    expect(modifiedOn("/no-such-page")).toBeUndefined()
  })
})

/*
  The work order is data the config folds rather than a list written inside it,
  so these read the order itself. They used to assert on the text of
  `vite.config.ts`, which failed on a rename and passed on a behaviour change.
*/
describe("the build's work order", () => {
  const emitted = emittedFor(docSlugs)
  const paths = new Set(emitted.map((entry) => entry.path))
  const writes = new Set(
    emitted.map((entry) => entry.prerender?.outputPath).filter((path) => path !== undefined),
  )

  test("emits the search index", () => {
    // Search asked a server for each query and there is no server, so the
    // deployed site's search returned nothing. The index has to be a file.
    expect(paths).toContain("/api/search")
    expect(read("../routes/api/search.ts")).toContain("staticGET")
  })

  test("emits robots, the sitemap, and the index", () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
      expect(paths, `nothing emits ${path}`).toContain(path)
    }
  })

  test("emits a twin for every documentation page", () => {
    for (const slug of docSlugs) {
      expect(writes, `${slug || "the root"} has no twin`).toContain(twinOfSlug(slug))
    }
  })

  test("renders each twin from the route that renders a page", () => {
    // The twin is the /raw/<slug> answer under another name. A twin emitted
    // from anywhere else is a second copy of the page.
    for (const slug of docSlugs) {
      const entry = emitted.find((item) => item.prerender?.outputPath === twinOfSlug(slug))
      expect(entry?.path, slug).toBe(rawPath(slug))
    }
  })

  test("asks for each path once", () => {
    // Prerender keys its work by request path, so a path asked for twice
    // silently drops one of the two answers.
    expect(paths.size).toBe(emitted.length)
  })

  test("emits the 404 body under the name static hosting looks for", () => {
    expect(writes).toContain(notFoundPath)
    expect(notFoundPath).toBe("/404.html")
  })
})

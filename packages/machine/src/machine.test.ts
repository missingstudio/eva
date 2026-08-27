import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { agentSkillsIndex } from "./skills.js"
import { authMarkdown, pricingMarkdown, robotsTxt } from "./agent-files.js"
import { entity, external, origin } from "./site.js"

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")

/*
  Two of these modules are read by a build rather than by a bundler:
  `apps/www/vite.config.ts` imports `agents.js` and `apps/docs/vite.config.ts`
  imports `site.js`, both through Node. Node resolves a bare specifier without
  the bundler's `.js`-means-`.ts` rule and fails on a package's own internal
  imports, so one bare import anywhere in their graph breaks both builds.

  docs/reference/hosting.md states the rule. Until this test it was stated
  nowhere a machine could read.
*/
describe("the modules a build config reads", () => {
  const graph = ["site.ts", "agents.ts"]

  test("import no package by name", () => {
    for (const name of graph) {
      const bare = [...read(name).matchAll(/^import .*? from "([^".]+)"/gm)]

      expect(
        bare.map((match) => match[1]),
        `${name} imports a package by name`,
      ).toEqual([])
    }
  })

  test("import only each other", () => {
    // A relative import is safe, but only inside this set: a file outside it
    // may take a bare import at any time and pull it into the graph.
    for (const name of graph) {
      const relative = [...read(name).matchAll(/from "\.\/([^"]+)\.js"/g)].map(
        (match) => `${match[1]}.ts`,
      )

      for (const target of relative) {
        expect(graph, `${name} imports ${target}, which is outside the graph`).toContain(target)
      }
    }
  })
})

/*
  `pricing.md` and `auth.md` are the two documents both origins serve from one
  source. Their tests lived in `apps/docs`, so the marketing origin served a
  body no suite of its own had ever read.
*/
describe("the documents both origins serve", () => {
  test("each opens with a level-one heading and carries no markup", () => {
    for (const [name, body] of [
      ["pricing.md", pricingMarkdown()],
      ["auth.md", authMarkdown()],
    ] as const) {
      expect(body.startsWith("# "), `${name} starts "${body.slice(0, 20)}"`).toBe(true)
      expect(body, name).not.toMatch(/<\/?(html|div|p|span|script)\b/i)
      expect(body.endsWith("\n"), name).toBe(true)
      expect(body.endsWith("\n\n"), name).toBe(false)
    }
  })

  test("each says enough to be worth fetching", () => {
    expect(pricingMarkdown().length).toBeGreaterThan(500)
    expect(authMarkdown().length).toBeGreaterThan(500)
  })

  test("the pricing says the price, and the price is zero", () => {
    expect(pricingMarkdown()).toContain("free")
  })

  test("the auth document says there is no credential to obtain", () => {
    // The one thing an agent must not guess wrong about a local-first program.
    const body = authMarkdown().toLowerCase()
    expect(body).toContain("no")
    expect(body).toMatch(/api key|credential|token/)
  })
})

describe("the crawler policy", () => {
  const body = robotsTxt({ says: "A line.", sitemaps: [`${origin.web}/sitemap.xml`] })

  test("grants every crawler, and says so in both vocabularies", () => {
    expect(body).toContain("User-agent: *")
    expect(body).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=yes")
    expect(body).toContain("Allow: /")
  })

  test("names the sitemaps the origin gave it, and only those", () => {
    const named = [...body.matchAll(/^Sitemap: (.+)$/gm)].map((match) => match[1])
    expect(named).toEqual([`${origin.web}/sitemap.xml`])
  })

  test("opens with what the origin says it is", () => {
    expect(body.startsWith("# A line.\n")).toBe(true)
  })

  test("ends with exactly one newline", () => {
    expect(body.endsWith("\n")).toBe(true)
    expect(body.endsWith("\n\n")).toBe(false)
  })
})

describe("the agent skills index", () => {
  const index = agentSkillsIndex(
    [{ name: "a-skill", description: "What it does.", url: "/a.md", body: "# A\n" }],
    () => "f".repeat(64),
  )

  test("declares the schema version clients match on", () => {
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json")
  })

  test("takes the digest over the body it was handed", () => {
    expect(index.skills[0]!.digest).toBe(`sha256:${"f".repeat(64)}`)
  })

  test("names the publisher's own entity, not a vendor's", () => {
    expect(entity.product.name).toBe("Eva")
    expect(external.repo).toContain("missingstudio")
  })
})

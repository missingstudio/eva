import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { configs, render } from "./vercel-config.js"
import { pagePaths } from "../apps/www/src/lib/pages.js"

/*
  The edge config is generated from the sites' own lists. This is what makes
  the committed file the generator's output rather than a file that agrees
  with it today — a new page changes the generator's answer, and this fails
  until the file is rewritten.
*/
describe("the committed edge configuration", () => {
  for (const [path, config] of Object.entries(configs())) {
    test(`${path} is what the generator produces`, () => {
      expect(readFileSync(path, "utf8"), `run: bun scripts/vercel-config.ts`).toBe(render(config))
    })
  }
})

describe("what the generated configuration promises", () => {
  const web = configs()["apps/www/vercel.json"]!

  test("every page can be asked for as markdown", () => {
    const named = new Set(
      web.rewrites
        .filter((rule) => rule.source.startsWith("/:page("))
        .flatMap((rule) =>
          [...rule.source.matchAll(/\(([^)]+)\)/g)].flatMap((m) => m[1]!.split("|")),
        ),
    )

    for (const path of pagePaths) {
      if (path === "") continue
      expect(named, `no rewrite names ${path}`).toContain(path.slice(1))
    }
  })

  test("a refused markdown type is answered with the markup", () => {
    const refusals = web.rewrites.filter((rule) => JSON.stringify(rule.has ?? []).includes("q=0"))

    expect(refusals.length).toBeGreaterThan(0)
    for (const rule of refusals) expect(rule.destination).toContain(".html")
  })

  test("nothing that is not a page is rewritten onto a twin", () => {
    // `/:page` unconstrained matches `/llms.txt` and `/robots.txt`, and an
    // agent fetching either sends `Accept: text/markdown`. The alternation is
    // what stops those being rewritten onto a file that does not exist.
    for (const rule of web.rewrites) {
      if (!rule.source.includes(":page")) continue
      expect(rule.source, `${rule.source} matches every single-segment path`).toMatch(/\(/)
    }
  })
})

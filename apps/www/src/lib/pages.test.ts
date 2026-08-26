import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { pagePaths } from "./pages.js"

const routes = fileURLToPath(new URL("../routes", import.meta.url))

// A route file is a page when it renders one: `__root` is the shell, and the
// bracketed names are the text endpoints — robots.txt and sitemap.xml, which
// are not pages and do not belong in a sitemap.
const routePaths = () =>
  readdirSync(routes)
    .filter((name) => name.endsWith(".tsx") && name !== "__root.tsx" && !name.includes("["))
    .map((name) => name.slice(0, -4))
    .map((name) => (name === "index" ? "" : `/${name}`))

describe("the sitemap", () => {
  // The sitemap listed the home page and the changelog, and the privacy page
  // was reachable only from the footer. This is the check that would have
  // caught it.
  test("lists every page the site serves", () => {
    expect([...pagePaths].sort()).toEqual(routePaths().sort())
  })

  test("names each page once", () => {
    expect(new Set(pagePaths).size).toBe(pagePaths.length)
  })
})

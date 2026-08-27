import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
// A path into the ui package rather than its name: `scripts/` is not a
// workspace package, so a bare specifier does not resolve here.
import { external, origin } from "../packages/machine/src/site.js"

/*
  The two artifacts a registry reads out of the repository rather than off the
  website: the Agent Plugin manifest, which is a file in a plugin root and not
  a well-known URL, and the skills beside it.
*/

const root = fileURLToPath(new URL("../", import.meta.url))
const read = (path: string) => readFileSync(`${root}${path}`, "utf8")

const manifest = JSON.parse(read("plugin.json")) as Record<string, unknown>

const skills = readdirSync(`${root}skills`, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, body: read(`skills/${entry.name}/SKILL.md`) }))

const frontmatter = (body: string) => {
  const block = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  expect(block, "a SKILL.md must open with a frontmatter block").toBeTruthy()

  const fields: Record<string, string> = {}
  for (const line of block![1]!.split("\n")) {
    const pair = line.match(/^([a-z-]+):\s*(.*)$/)
    if (pair && pair[2]) fields[pair[1]!] = pair[2].trim()
  }
  return fields
}

describe("the plugin manifest", () => {
  test("declares the schema and a name, which are the required fields", () => {
    expect(manifest["$schema"]).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json")
    expect(manifest["name"]).toBeTruthy()
  })

  test("points at the product and the source, so a reader can tell it is ours", () => {
    expect(manifest["homepage"]).toBe(origin.web)
    expect(manifest["repository"]).toBe(external.repo)
  })
})

describe("every skill in the repository", () => {
  test("there is at least one", () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  test("its frontmatter name matches its directory", () => {
    for (const skill of skills) {
      expect(frontmatter(skill.body)["name"], skill.name).toBe(skill.name)
    }
  })

  test("its name fits the shape the specification allows", () => {
    for (const skill of skills) {
      expect(skill.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(skill.name.length).toBeLessThanOrEqual(64)
      expect(skill.name).not.toMatch(/anthropic|claude/)
    }
  })

  test("its description says what it does and when to use it", () => {
    for (const skill of skills) {
      const description = frontmatter(skill.body)["description"]!

      expect(description.length, skill.name).toBeGreaterThan(40)
      expect(description.length, skill.name).toBeLessThanOrEqual(1024)
      // A description that does not say when to reach for the skill leaves the
      // reader to guess, which is the one thing the field is for.
      expect(description.toLowerCase(), skill.name).toContain("use when")
    }
  })

  test("its prose opens with a heading", () => {
    for (const skill of skills) {
      const prose = skill.body.slice(skill.body.indexOf("---", 3) + 3).trimStart()
      expect(prose.startsWith("# "), skill.name).toBe(true)
    }
  })

  test("it names no endpoint Eva does not serve", () => {
    for (const skill of skills) {
      const text = skill.body.toLowerCase()
      expect(text, skill.name).toContain("no hosted api")
      expect(text, skill.name).not.toMatch(/api\.evafactory\.co/)
    }
  })
})

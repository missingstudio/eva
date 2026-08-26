import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { glossaryTerms } from "./glossary.js"

const root = fileURLToPath(new URL("../../content/docs", import.meta.url))

const read = (slug: string) => readFileSync(`${root}/${slug}.mdx`, "utf8")

const allPages = () => {
  const found: { slug: string; text: string }[] = []

  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`)
      else if (entry.name.endsWith(".mdx"))
        found.push({
          slug: `${prefix}${entry.name.slice(0, -4)}`,
          text: readFileSync(`${dir}/${entry.name}`, "utf8"),
        })
    }
  }

  walk(root, "")
  return found
}

describe("the glossary markup", () => {
  test("the concepts page yields the terms it defines", () => {
    const terms = glossaryTerms(read("concepts"))
    const names = terms.map((entry) => entry.term)

    // The vocabulary the whole tree is held to. If one of these stops being
    // extractable, an answer engine stops being able to lift the definition.
    for (const term of ["Spec", "Run", "Session", "Trace", "Harness", "Provider Turn"]) {
      expect(names, `"${term}" is no longer extractable`).toContain(term)
    }

    expect(terms.length).toBeGreaterThanOrEqual(20)
  })

  test("every extracted definition is a usable description", () => {
    for (const page of allPages()) {
      for (const { term, definition } of glossaryTerms(page.text)) {
        expect(definition.length, `${page.slug}: "${term}" has a stub definition`).toBeGreaterThan(
          30,
        )
        // Markdown a schema description may not carry. A stray `*` means an
        // emphasis form the cleaner does not know about — the display style
        // bans italics, so bold is the only one that should reach here.
        expect(definition, `${page.slug}: "${term}"`).not.toMatch(/[`*\n]|\]\(/)
      }
    }
  })

  // A definition cut off at its first line break still reads as prose and still
  // passes a length check, so the shape of the ending is what catches it. Every
  // definition in this tree is written as whole sentences.
  test("a definition is not truncated at a line break", () => {
    for (const page of allPages()) {
      for (const { term, definition } of glossaryTerms(page.text)) {
        expect(definition, `${page.slug}: "${term}" stops mid-sentence`).toMatch(/[.:)]$/)
      }
    }
  })

  // A bold run used for emphasis is not a definition. The pattern has to tell
  // the difference, or the markup claims definitions the page never made.
  test("emphasis is not read as a definition", () => {
    const emphasis = glossaryTerms(read("use/cost"))
    expect(emphasis).toEqual([])
  })
})

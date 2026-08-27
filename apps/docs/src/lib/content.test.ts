import { docSlugs, entity, titleTemplate } from "@missingstudio/ui"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const root = fileURLToPath(new URL("../../content/docs", import.meta.url))

// The test reads the content tree rather than the compiled collection. The
// `fumadocs-mdx` macro only resolves under its bundler plugin, and a check on
// what a page says should not need a bundler to run.
const slugToFile = (slug: string) => `${root}/${slug === "" ? "index" : slug}.mdx`

const pages = () => {
  const found: { slug: string; file: string }[] = []

  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`)
      else if (entry.name.endsWith(".mdx")) {
        const base = entry.name.slice(0, -4)
        found.push({
          slug: base === "index" && prefix === "" ? "" : `${prefix}${base}`,
          file: `${dir}/${entry.name}`,
        })
      }
    }
  }

  walk(root, "")
  return found
}

const frontmatter = (file: string) => {
  const text = readFileSync(file, "utf8")
  const block = text.match(/^---\n([\s\S]*?)\n---/)
  if (!block) return {}

  const fields: Record<string, string> = {}
  for (const line of block[1]!.split("\n")) {
    const pair = line.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (pair) fields[pair[1]!] = pair[2]!.trim()
  }
  return fields
}

describe("the marketing site's links", () => {
  // A crawl cannot cross two domains, so the check lives where the pages are.
  // Deleting a page fails here, in the package that deleted it.
  test("every DocSlug resolves to a real page", () => {
    for (const slug of docSlugs) {
      expect(() => readFileSync(slugToFile(slug)), `no page for "${slug}"`).not.toThrow()
    }
  })

  /*
    The other direction. `docSlugs` is what the build reads to decide which
    markdown twins to write, so a page missing from it is a page with no twin —
    served as HTML, advertised nowhere, and invisible to an agent that only
    reads markdown.
  */
  test("every page is declared as a DocSlug", () => {
    const declared = new Set<string>(docSlugs)

    for (const page of pages()) {
      expect(declared, `${page.slug || "the home page"} is not in docSlugs`).toContain(page.slug)
    }
  })
})

describe("the metadata contract", () => {
  test("every page has a title of 15 to 60 characters", () => {
    for (const page of pages()) {
      const title = titleTemplate.docs(frontmatter(page.file)["title"] ?? "")
      expect(title.length, `${page.slug}: "${title}"`).toBeGreaterThanOrEqual(15)
      expect(title.length, `${page.slug}: "${title}"`).toBeLessThanOrEqual(60)
    }
  })

  test("every page has a written description of 70 to 160 characters", () => {
    for (const page of pages()) {
      const description = frontmatter(page.file)["description"]
      expect(description, `${page.slug} has no description`).toBeDefined()
      const length = description!.length
      expect(length, `${page.slug}: ${length} chars`).toBeGreaterThanOrEqual(70)
      expect(length, `${page.slug}: ${length} chars`).toBeLessThanOrEqual(160)
    }
  })

  test("every slug is unique", () => {
    const slugs = pages().map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe("the two names", () => {
  // An answer engine decides what a thing is from agreement between sources.
  // A company sentence that reads like a product sentence is what teaches it
  // that missing studio is a CLI.
  test("the product and the company do not describe each other", () => {
    const product = entity.product.description.toLowerCase()
    const company = entity.company.description.toLowerCase()

    expect(product).not.toBe(company)
    expect(product.includes(company)).toBe(false)
    expect(company.includes(product)).toBe(false)
  })

  test("the company sentence names the product it publishes", () => {
    expect(entity.company.description).toContain(entity.product.name)
  })
})

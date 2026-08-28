import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The stylesheet's names, each held to a reader. Nothing links a rule to the
 * markup that wears it — a renamed rule, a deleted rule and a typo in a
 * `className` all compile — so this reads both sides and holds them to each
 * other: every class `styles.css` defines is worn somewhere in what ships. A
 * rule with no reader is dead weight at best, and at worst it is one half of
 * a rename whose other half kept the old name.
 *
 * The readers are this page's own sources, the page the server ships, and
 * the components the ui package renders onto it — the ai-elements carry
 * their class hooks with them, so a hook like `is-user` is worn there.
 */

const SRC = new URL(".", import.meta.url).pathname

const sources = (root: string, keeps: (name: string) => boolean): readonly string[] =>
  readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && keeps(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))

const shipped = (name: string): boolean => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)

const corpus = [
  ...sources(SRC, shipped),
  join(SRC, "..", "index.html"),
  ...sources(join(SRC, "..", "..", "..", "packages", "ui", "src", "components"), (name) =>
    name.endsWith(".tsx"),
  ),
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n")

// The names the stylesheet defines: every class token in a selector, with
// the comments and the import lines off first — an `@source` path is not a
// selector, and neither is a word inside prose.
const defined = (): readonly string[] => {
  const css = readFileSync(join(SRC, "styles.css"), "utf8")
  const rules = css
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*@(?:import|source)\b/.test(line))
    .join("\n")
  return [...new Set([...rules.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(([, name]) => name ?? ""))]
    .filter((name) => name !== "")
    .sort()
}

describe("the stylesheet", () => {
  it.each(defined().map((name) => ({ name })))(
    "names $name onto something that ships",
    ({ name }) => {
      expect(corpus).toMatch(new RegExp(`(?<![-\\w])${name}(?![-\\w])`))
    },
  )
})

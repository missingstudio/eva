import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

/**
 * Deliberately crude: it greps. The number this stage owes W1 is a count of
 * Session API calls made outside `client-runtime`, and a grep is how a
 * reviewer checks that count by hand. A rule a person cannot repeat is a
 * rule nobody keeps.
 *
 * What ships, only. A test stands its own API up to test against, which is
 * what a fake is for and is not a call the product makes.
 */
const shipped = (directory: string): readonly string[] =>
  readdirSync(join(REPO, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.endsWith(".test.ts"))
    .map((path) => relative(REPO, path))
    .sort()

const naming = (word: string, directories: readonly string[]): readonly string[] =>
  directories
    .flatMap(shipped)
    .filter((path) => readFileSync(join(REPO, path), "utf8").includes(word))

describe("what reads the Session API", () => {
  it("the terminal surface names none of it: it is handed a client and nothing else", () => {
    expect(naming("SessionAPI", ["plugins/tui/src"])).toEqual([])
  })

  it("the command line builds one, at its three sites, and hands on the client", () => {
    expect(naming("makeSessionAPI", ["plugins/tui/src", "apps/cli/src"])).toEqual([
      "apps/cli/src/index.ts",
      "apps/cli/src/interactive.ts",
    ])
  })
})

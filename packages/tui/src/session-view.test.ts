import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

/**
 * Deliberately crude: it greps. The number this plan owes is a count of the
 * folds that decide what a Run did, and a grep is how a reviewer checks that
 * count by hand. A rule a person cannot repeat is a rule nobody keeps.
 *
 * What ships, only. A test builds the shapes it needs to test against, and
 * those are not a fold the terminal holds.
 */
const shipped = (): readonly string[] =>
  readdirSync(join(REPO, "packages/tui/src"), { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")),
    )
    .filter((entry) => !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx"))
    .map((entry) => relative(REPO, join(entry.parentPath, entry.name)))
    .sort()

const naming = (word: string): readonly string[] =>
  shipped().filter((path) => readFileSync(join(REPO, path), "utf8").includes(word))

describe("how many folds decide what a Run did", () => {
  // One, and it is not here. Two folds would disagree, and a person
  // comparing the screen with the page would find the disagreement.
  it("the terminal names the one in the session view, at one site", () => {
    expect(naming("@missingstudio/eva-session-view")).toEqual(["packages/tui/src/frame.ts"])
  })

  /**
   * And it holds none of its own. A private fold would have to read the
   * record's own shapes, so the count is a count of the words one would
   * need: the fold itself, the Message it answers with, the Blocks inside
   * one, and the package all three live in.
   */
  it.each(["transcriptFold", "TranscriptMessage", "TranscriptBlock", "eva-schema"])(
    "and no fold of its own: it names no %s",
    (word) => {
      expect(naming(word)).toEqual([])
    },
  )
})

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO = join(new URL(".", import.meta.url).pathname, "..", "..", "..")

/**
 * Deliberately crude: it greps. The number this stage owes is a count of the
 * folds that decide what a Run did, and a grep is how a reviewer checks that
 * count by hand. A rule a person cannot repeat is a rule nobody keeps.
 *
 * What ships, only. A test builds the shapes it needs to test against, and
 * those are not a fold the page holds.
 */
const shipped = (): readonly string[] =>
  readdirSync(join(REPO, "apps/web/src"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => relative(REPO, join(entry.parentPath, entry.name)))
    .sort()

const naming = (word: string): readonly string[] =>
  shipped().filter((path) => readFileSync(join(REPO, path), "utf8").includes(word))

describe("how many folds decide what a Run did", () => {
  // One, and it is not here. The terminal calls the same one, so a person
  // comparing the screen with the page finds no disagreement to explain.
  it("the page calls the one in the session view, at one site", () => {
    expect(naming("blocksOf")).toEqual(["apps/web/src/transcript.ts"])
  })

  /**
   * And it holds none of its own. A private fold would have to fold the
   * Trace again or read the record's own shapes, so the count is a count of
   * the words one would need to write one.
   */
  it.each([
    "blockFold",
    "foldTranscript",
    "transcriptFold",
    "TranscriptMessage",
    "TranscriptBlock",
  ])("and no fold of its own: it names no %s", (word) => {
    expect(naming(word)).toEqual([])
  })

  // A rate is not a fact about the Session, and this side of the wire holds
  // no Catalog. What a reader is shown is what a Provider reported.
  it.each(["PriceLookup", "priceOf"])("prices nothing itself: it names no %s", (word) => {
    expect(naming(word)).toEqual([])
  })
})

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The parity matrix, as a gate rather than a claim.
 *
 * `docs/reference/parity.md` says what each of the four doors can do, and
 * names the test that proves each cell. This suite is what makes the page a
 * document rather than a wish: it reads the page, holds its shape to the
 * interaction set, and resolves every citation on it against the tree.
 *
 * It is a sibling of `w2-exit.test.ts` and not a part of it, because the two
 * answer to different authorities. The exit test is compared against the
 * roadmap's own sentences. This page is compared against the interaction set
 * and against itself, and the exit test names this suite in the clause the
 * stage plan added — so the matrix cannot be dropped quietly either.
 */

const ROOT = join(new URL(".", import.meta.url).pathname, "..", "..", "..")
const PAGE = join("docs", "reference", "parity.md")

// The basic interaction set, in the words the surface stage named it with. A
// row the page loses or rewords fails here, so the matrix cannot shrink to the
// rows that happen to be green.
const INTERACTIONS: readonly string[] = [
  "Open a Session, and see the Sessions that exist",
  "Prompt, and watch the Run live",
  "Queue a line behind an open Run; steer into one deliberately",
  "Cancel",
  "Answer a permission request with any of the four options — and lose the race to another door gracefully",
  "Switch the model, choosing from what the Catalog knows",
  "See what the Session spent",
  "Survive a dropped pipe: say so, catch up by Cursor, never duplicate",
]

const DOORS: readonly string[] = ["Terminal", "Pipe", "Page", "Wire"]

const VERDICTS: readonly string[] = ["proven", "refused", "none"]

/**
 * The page counts its cells in words, the way it says everything else. The
 * list runs as far as the matrix can, which is every cell proven.
 */
const WORDS: readonly string[] = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "twenty-one",
  "twenty-two",
  "twenty-three",
  "twenty-four",
  "twenty-five",
  "twenty-six",
  "twenty-seven",
  "twenty-eight",
  "twenty-nine",
  "thirty",
  "thirty-one",
  "thirty-two",
]

const page = readFileSync(join(ROOT, PAGE), "utf8")

const cellsOf = (line: string): readonly string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((one) => one.trim())

// A table's body rows: the lines after its header and its rule, up to the
// first line that is not a row.
const rowsUnder = (heading: string, header: string): readonly (readonly string[])[] => {
  const lines = page.split("\n")
  const at = lines.findIndex((one) => one === heading)
  const start = lines.findIndex((one, index) => index > at && one.startsWith(`| ${header} `))
  if (at === -1 || start === -1) return []
  const body = lines.slice(start + 2)
  const end = body.findIndex((one) => !one.startsWith("|"))
  return body.slice(0, end === -1 ? undefined : end).map(cellsOf)
}

/**
 * One reference to a proof: the file it lives in, and the text that file has to
 * hold. A test is cited by its own name in quotes, and a refusal by the token
 * the source declares it with — `interactive: false` is the pattern.
 */
interface Citation {
  readonly file: string
  readonly needle: string
}

const CITED = /`([^`]+?\.tsx?)` › (?:"([^"]+)"|`([^`]+)`)/g

// The prose wraps, so a citation reads across a line break. What the file holds
// is one line, so the break becomes the space a reader reads there.
const oneLine = (text: string): string => text.replaceAll(/\s+/g, " ")

const citationsIn = (text: string): readonly Citation[] =>
  [...text.matchAll(CITED)].map(([, file, test, token]) => ({
    file: oneLine(file ?? "").trim(),
    needle: test === undefined ? oneLine(token ?? "") : `"${oneLine(test)}"`,
  }))

const matrix = rowsUnder("## 2. The matrix", "Interaction")

const sections = INTERACTIONS.map((says, index) => ({
  says,
  heading: `### ${index + 1}. ${says}`,
  rows: rowsUnder(`### ${index + 1}. ${says}`, "Door"),
}))

// Every citation the page makes, wherever it makes it: the ledger tables, and
// the prose that carries the caveats.
const cited = citationsIn(page)

describe("the parity matrix", () => {
  // The matrix against the interaction set. A row the page drops is a door
  // nobody is holding to that row any more.
  it("carries the eight interactions, in the set's own words", () => {
    expect(matrix.map((row) => row[0])).toEqual(
      INTERACTIONS.map((says, index) => `${index + 1}. ${says}`),
    )
  })

  it("carries the four doors, and no fifth", () => {
    const header = page.split("\n").find((one) => one.startsWith("| Interaction "))
    expect(cellsOf(header ?? "").slice(1)).toEqual(DOORS)
  })

  it.each(sections)("$heading covers the four doors", ({ rows }) => {
    expect(rows.map((row) => row[0])).toEqual(DOORS)
  })

  /**
   * The matrix and the ledger are two readings of one fact, so they are held to
   * each other. A cell quietly promoted in the matrix and left alone below it
   * would read as parity nothing proves.
   */
  it.each(sections)("$heading agrees with the matrix", ({ says, rows }) => {
    const row = matrix[INTERACTIONS.indexOf(says)] ?? []
    expect(rows.map((one) => one[1])).toEqual(row.slice(1))
  })

  it.each(sections)("$heading reads only the three verdicts", ({ rows }) => {
    for (const row of rows) expect(VERDICTS).toContain(row[1])
  })

  // The rule that makes the page worth reading: a cell is a proof, a refusal,
  // or a defect that says what is absent. Nothing is a dash.
  it.each(sections)("$heading names a proof, or what is missing", ({ rows }) => {
    for (const [door, verdict, where, gap] of rows) {
      if (verdict === "none") expect(`${door}: ${gap}`).not.toBe(`${door}: —`)
      else expect(citationsIn(where ?? "").length).toBeGreaterThan(0)
    }
  })

  /**
   * The count the page opens with, against the cells it then draws. The
   * number is what a reader takes away, so a cell fixed and a lede left alone
   * would understate the work — and one gone the other way would hide it.
   */
  it("opens with the count its own cells add up to", () => {
    const cells = matrix.flatMap((row) => row.slice(1))
    const said = (verdict: string) => cells.filter((one) => one === verdict).length
    expect(oneLine(page)).toContain(
      `The matrix holds ${WORDS[cells.length]} cells: ${WORDS[said("proven")]} are proven, ` +
        `${WORDS[said("refused")]} is a refusal that names itself, and ` +
        `${WORDS[said("none")]} are neither.`,
    )
  })

  // Each citation names something that exists. A proof renamed is a row to
  // update, here and on the page.
  it.each(cited)("$file holds $needle", ({ file, needle }) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toContain(needle)
  })
})

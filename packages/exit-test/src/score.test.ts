import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readTrace, writtenGolden } from "@missingstudio/eva-schema/goldens"
import { describe, expect, it } from "vitest"
import { WORKFLOWS } from "./fixture.js"
import { readingOf, said } from "./score.js"

const root = join(new URL(".", import.meta.url).pathname, "..")
const traceOf = (name: string) => join(root, "traces", `${name}.jsonl`)
const goldenOf = (name: string) => readFileSync(join(root, "goldens", `${name}.json`), "utf8")

describe("the vendored traces against the committed goldens", () => {
  const traced = readdirSync(join(root, "traces"))
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.replace(".jsonl", ""))

  it("has a trace for each of the five Workflows", () => {
    for (const name of WORKFLOWS) expect(traced).toContain(name)
  })

  it.each(traced)("%s folds to its golden, byte for byte", (name) => {
    expect(writtenGolden(readingOf(readTrace(traceOf(name))))).toBe(goldenOf(name))
  })

  it("aggregates the five Workflows to the golden aggregate", () => {
    const events = WORKFLOWS.flatMap((name) => [...readTrace(traceOf(name))])
    expect(writtenGolden(readingOf(events))).toBe(goldenOf("aggregate"))
  })
})

describe("the lines one reading prints", () => {
  // The rate branch, pinned line by line: every figure is a counter from the
  // one fold or a ratio of two of them.
  it("prints the ratios of the one summary, aligned", () => {
    const lines = said("classify", readingOf(readTrace(traceOf("classify"))), 0)
    expect(lines).toEqual([
      "classify",
      "  first-pass validity  = 2/4 (50.0%)",
      "  post-repair validity = 3/4 (75.0%)",
      "  repair yield         = 1/2 (50.0%)",
      "  coverage             = 4/4 (100.0%)",
      "  unchecked 0, held 0, produced no Candidate 0",
    ])
  })

  it("says there was nothing to repair rather than printing 0/0", () => {
    const lines = said("commit-msg", readingOf(readTrace(traceOf("commit-msg"))))
    expect(lines).toContain("  repair yield         = no first-pass failure to repair")
  })
})

describe("a trace with no first pass", () => {
  it("prints no rate, and the golden says so", () => {
    const reading = readingOf(readTrace(traceOf("no-validator")))
    expect(reading.validity).toEqual({ kind: "none" })
    expect(JSON.parse(goldenOf("no-validator"))).toMatchObject({ validity: { kind: "none" } })

    const lines = said("no-validator", reading)
    expect(lines.join("\n")).toContain("no rate")
    expect(lines.join("\n")).not.toContain("%")
  })
})

import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { WORKFLOWS } from "./fixture.js"
import { gate, refuses } from "./gate.js"

const root = join(new URL(".", import.meta.url).pathname, "..")
const traceOf = (name: string) => join(root, "traces", `${name}.jsonl`)

// One Run per Workflow, over the vendored traces — the same files the golden
// test folds, so the numbers below are the goldens' numbers.
const VENDORED = WORKFLOWS.map((workflow) => ({ workflow, path: traceOf(workflow) }))

describe("the gate over the vendored traces", () => {
  const report = gate(VENDORED)

  it("prints each Workflow's reading and then the aggregate", () => {
    for (const workflow of WORKFLOWS) expect(report.said).toContain(workflow)
    expect(report.said).toContain("aggregate")
    // The aggregate's ratios, from the goldens: 14/18 first pass, 3 of 4
    // failures repaired.
    expect(report.said).toContain("  first-pass validity  = 14/18 (77.8%)")
    expect(report.said).toContain("  repair yield         = 3/4 (75.0%)")
  })

  // The vendored traces hold deliberate failures, so the verdict the runner
  // exits on is exercised here — printed number and gated number are the
  // same value from the same fold.
  it("fails both thresholds, in the words the runner prints", () => {
    expect(report.failed).toEqual(["first-pass validity is below 95%", "repair yield is below 90%"])
  })

  it("reports no unproduced Run and no model, since the cassettes carry no usage", () => {
    expect(report.unproduced).toBe(0)
    expect(report.models).toEqual([])
  })
})

describe("the share a Run may produce no Candidate under", () => {
  it("reports a rate up to the stated share", () => {
    expect(refuses(10, 500)).toBe(false)
    expect(refuses(11, 500)).toBe(true)
    // Nothing produced is not a rate of nothing.
    expect(refuses(1, 5)).toBe(true)
  })
})

describe("a Run that produced no Candidate", () => {
  it("is counted and reported while under the share", () => {
    // 49 Runs with Candidates and one whose child left no file: 1 of 50 is
    // exactly the 2% share, so a rate is still reported.
    const runs = [
      ...Array.from({ length: 49 }, () => ({
        workflow: "commit-msg",
        path: traceOf("commit-msg"),
      })),
      { workflow: "commit-msg", path: join(root, "traces", "never-written.jsonl") },
    ]
    const report = gate(runs)

    expect(report.unproduced).toBe(1)
    expect(report.said.join("\n")).toContain("produced no Candidate 1")
    expect(report.failed).toEqual([])
  })

  it("refuses to report a rate at all past the share", () => {
    const runs = [
      ...VENDORED,
      { workflow: "commit-msg", path: join(root, "traces", "never-written.jsonl") },
    ]
    const report = gate(runs)

    expect(report.said).toEqual([])
    expect(report.failed).toEqual([
      "1 of 6 Runs produced no Candidate, which is past the 2% share — no rate is reported",
    ])
  })
})

describe("a measurement that judged nothing on a first pass", () => {
  it("fails rather than reporting a rate of nothing", () => {
    const report = gate([{ workflow: "no-validator", path: traceOf("no-validator") }])

    expect(report.said.join("\n")).toContain("no rate")
    expect(report.failed).toEqual([
      "nothing was judged on a first pass — no rate, and that is a failure",
    ])
  })
})

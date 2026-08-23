import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readTrace, writtenGolden } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { ENDPOINT, readingOf, refuses, said, wrongEndpoint, WORKFLOWS } from "./score.js"

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

describe("the rules the measurement refuses under", () => {
  it("reports a rate up to the stated share of Runs that produced no Candidate", () => {
    expect(refuses(10, 500)).toBe(false)
    expect(refuses(11, 500)).toBe(true)
    // Nothing produced is not a rate of nothing.
    expect(refuses(1, 5)).toBe(true)
  })

  it("refuses an endpoint the measurement is not pinned to", () => {
    expect(wrongEndpoint(undefined, ENDPOINT)).toBe(false)
    expect(wrongEndpoint(ENDPOINT, ENDPOINT)).toBe(false)
    // A proxy answers as the model and the rate would name the wrong one.
    expect(wrongEndpoint("https://gateway.example/v1", ENDPOINT)).toBe(true)
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

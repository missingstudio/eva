import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfiguration } from "@missingstudio/eva-kernel"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ENDPOINT, hermeticEnv, INPUTS, WORKFLOWS, wrongEndpoint } from "./fixture.js"

const scratch = () => mkdtempSync(join(tmpdir(), "eva-fixture-test-"))

describe("the endpoint the measurement is pinned to", () => {
  it("refuses an endpoint the measurement is not pinned to", () => {
    expect(wrongEndpoint(undefined, ENDPOINT)).toBe(false)
    expect(wrongEndpoint(ENDPOINT, ENDPOINT)).toBe(false)
    // A proxy answers as the model and the rate would name the wrong one.
    expect(wrongEndpoint("https://gateway.example/v1", ENDPOINT)).toBe(true)
  })

  it("writes the pinned endpoint in rather than inheriting the operator's", () => {
    const env = hermeticEnv(scratch(), "trace")
    expect(env["ANTHROPIC_BASE_URL"]).toBe(ENDPOINT)
    expect(env["EVA_CONFIG_DIR"]).toContain("fixture")
  })
})

describe("where a hermetic Run's Trace lands", () => {
  // The path both halves send. A resolution over it is what the in-process
  // Run does and what the child the fan-out spawns does, so a path a YAML
  // reader would give back changed fails here rather than in a measurement.
  const resolved = (traceDir: string) => {
    const directory = scratch()
    return Effect.runPromise(
      resolveConfiguration({ directory, env: hermeticEnv(directory, traceDir) }),
    )
  }

  it("reaches the trace plugin's options as one entry", async () => {
    const dir = join(scratch(), "commit-msg.1")
    const settled = await resolved(dir)
    const entry = settled.plugins.find((one) => one.id === "eva.trace.jsonl")

    expect(entry?.options).toEqual({ dir })
    // The fixture's own list still decides what loads: the layer names one
    // plugin and turns nothing on or off.
    expect(settled.plugins.map((one) => one.id)).toContain("eva.workflow")
  })

  it("keeps a path that holds a quote or a backslash", async () => {
    const dir = join(scratch(), 'a "quoted" \\ name')
    const settled = await resolved(dir)

    expect(settled.plugins.find((one) => one.id === "eva.trace.jsonl")?.options).toEqual({ dir })
  })

  // The child the fan-out spawns hands the resolution the CLI's built-in
  // table. The fixture's first entry turns every built-in off, and this is
  // the one whose default path is in the operator's home — so a hermetic
  // run leaves `~/.eva` untouched, and a fixture edit that lets it back in
  // fails here rather than in a measurement.
  it("turns the sqlite sink off, so a hermetic run never writes the operator's home", async () => {
    const directory = scratch()
    const settled = await Effect.runPromise(
      resolveConfiguration({
        builtIn: ["eva.trace.sqlite"],
        directory,
        env: hermeticEnv(directory, join(directory, "trace")),
      }),
    )

    expect(settled.plugins.map((one) => one.id)).not.toContain("eva.trace.sqlite")
  })
})

describe("the five canned Workflows", () => {
  it("names one vendored input for each", () => {
    expect(Object.keys(INPUTS).sort()).toEqual([...WORKFLOWS].sort())
  })
})

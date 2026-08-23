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
    const env = hermeticEnv(scratch(), "trace.jsonl")
    expect(env["ANTHROPIC_BASE_URL"]).toBe(ENDPOINT)
    expect(env["EVA_CONFIG_DIR"]).toContain("fixture")
  })
})

describe("where a hermetic Run's Trace lands", () => {
  // The path both halves send. A resolution over it is what the in-process
  // Run does and what the child the fan-out spawns does, so a path a YAML
  // reader would give back changed fails here rather than in a measurement.
  const resolved = (tracePath: string) => {
    const directory = scratch()
    return Effect.runPromise(
      resolveConfiguration({ directory, env: hermeticEnv(directory, tracePath) }),
    )
  }

  it("reaches the trace plugin's options as one entry", async () => {
    const path = join(scratch(), "commit-msg.1.jsonl")
    const settled = await resolved(path)
    const entry = settled.plugins.find((one) => one.id === "eva.trace.jsonl")

    expect(entry?.options).toEqual({ path })
    // The fixture's own list still decides what loads: the layer names one
    // plugin and turns nothing on or off.
    expect(settled.plugins.map((one) => one.id)).toContain("eva.workflow")
  })

  it("keeps a path that holds a quote or a backslash", async () => {
    const path = join(scratch(), 'a "quoted" \\ name.jsonl')
    const settled = await resolved(path)

    expect(settled.plugins.find((one) => one.id === "eva.trace.jsonl")?.options).toEqual({ path })
  })
})

describe("the five canned Workflows", () => {
  it("names one vendored input for each", () => {
    expect(Object.keys(INPUTS).sort()).toEqual([...WORKFLOWS].sort())
  })
})

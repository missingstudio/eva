import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writtenGolden } from "@missingstudio/eva-schema"
import { recorded } from "@missingstudio/eva-testkit"
import { describe, expect, it } from "vitest"
import { cassetteOf, runFixture } from "./run.js"
import { WORKFLOWS } from "./fixture.js"
import { readingOf } from "./score.js"

const root = join(new URL(".", import.meta.url).pathname, "..")
const goldenOf = (name: string) => readFileSync(join(root, "goldens", `${name}.json`), "utf8")

/**
 * The deterministic gate over the whole path: the vendored cassette replays
 * through the real fixture — config resolution, the Workflow harness, the
 * Validator, the Repair — and the resulting Trace folds to the same golden
 * the vendored trace does. The golden and the cassette are two projections
 * of one recording, and this is what holds them together: a change to the
 * machinery that would read differently on a re-record fails here, on every
 * push, with no model call.
 */
describe.each(WORKFLOWS)("the %s cassette through the fixture", (name) => {
  it("is committed beside the trace it was recorded with", () => {
    expect(existsSync(join(root, "cassettes", `${name}.json`))).toBe(true)
  })

  it("replays to the committed golden, byte for byte", async () => {
    const cassette = cassetteOf(name)
    const tracePath = join(mkdtempSync(join(tmpdir(), "eva-replay-")), `${name}.jsonl`)
    const events = await runFixture({
      workflow: name,
      passes: cassette.passes,
      tracePath,
      plugins: [recorded(cassette)],
    })

    expect(writtenGolden(readingOf(events))).toBe(goldenOf(name))
  })
})

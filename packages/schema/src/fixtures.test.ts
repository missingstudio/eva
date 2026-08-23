import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { decodeLine, encodeLine } from "./codec.js"
import { SCHEMA_VERSION } from "./event.js"
import { costFold, headerFold, mergeText, transcriptFold, verdictFold } from "./fold.js"

const dir = new URL("../fixtures", import.meta.url).pathname
const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"))

// Every committed fixture decodes with no record in unknown,
// migrates, re-encodes stably, and folds to its reviewed golden.
describe.each(files)("fixture %s", (file) => {
  const lines = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean)
  const events = lines.map(decodeLine)

  it("decodes every record with none in unknown", () => {
    for (const event of events) {
      expect(event.payload.kind).not.toBe("unknown")
    }
  })

  it("re-encodes stably, at the current schema version", () => {
    for (const line of lines) {
      const once = encodeLine(decodeLine(line))
      expect(encodeLine(decodeLine(once))).toBe(once)
      expect((JSON.parse(once) as { version: number }).version).toBe(SCHEMA_VERSION)
    }
  })

  it("folds to its reviewed golden", () => {
    const golden = JSON.parse(
      readFileSync(join(dir, "goldens", file.replace(".jsonl", ".json")), "utf8"),
    )
    const sessions = [...new Set(events.map((event) => event.session))]
    expect(mergeText(events).map(encodeLine)).toEqual(golden.merged)
    for (const session of sessions) {
      const own = events.filter((event) => event.session === session)
      expect(JSON.parse(JSON.stringify(transcriptFold(own)))).toEqual(golden.transcripts[session])
      expect(costFold(own)).toEqual(golden.costs[session])
      expect(headerFold(own)).toEqual(golden.headers[session])
      expect(verdictFold(own)).toEqual(golden.verdicts[session])
    }
  })
})

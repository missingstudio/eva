// Regenerates the goldens from the fixtures. Run deliberately, review the
// diff, and commit: `bun packages/schema/fixtures/generate.ts`
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  costFold,
  decodeLine,
  encodeLine,
  headerFold,
  mergeText,
  transcriptFold,
  verdictFold,
} from "../src/index.js"

const dir = new URL(".", import.meta.url).pathname

for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
  const lines = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean)
  const events = lines.map(decodeLine)
  const sessions = [...new Set(events.map((event) => event.session))]
  const golden = {
    merged: mergeText(events).map(encodeLine),
    transcripts: Object.fromEntries(
      sessions.map((s) => [s, transcriptFold(events.filter((e) => e.session === s))]),
    ),
    costs: Object.fromEntries(
      sessions.map((s) => [s, costFold(events.filter((e) => e.session === s))]),
    ),
    headers: Object.fromEntries(
      sessions.map((s) => [s, headerFold(events.filter((e) => e.session === s))]),
    ),
    verdicts: Object.fromEntries(
      sessions.map((s) => [s, verdictFold(events.filter((e) => e.session === s))]),
    ),
  }
  const out = join(dir, "goldens", file.replace(".jsonl", ".json"))
  writeFileSync(out, JSON.stringify(golden, null, 2) + "\n")
  console.log(`${file}: ${events.length} events, ${sessions.length} sessions`)
}

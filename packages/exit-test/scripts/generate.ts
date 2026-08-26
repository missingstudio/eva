// Regenerates the goldens from the vendored traces. Run deliberately, review
// the diff, and commit: `bun packages/exit-test/scripts/generate.ts`
//
// The traces committed with the build are synthetic pins of the fold
// arithmetic, in the shape of packages/schema/fixtures. They stand until a
// person runs scripts/record.ts against the pinned model, reviews the diff,
// and commits real provider streams in their place.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readTrace, writtenGolden } from "@missingstudio/eva-schema/goldens"
import { WORKFLOWS } from "../src/fixture.js"
import { readingOf, type Reading } from "../src/score.js"

const root = join(new URL(".", import.meta.url).pathname, "..")
const traces = join(root, "traces")
const goldens = join(root, "goldens")
mkdirSync(goldens, { recursive: true })

const write = (name: string, reading: Reading) => {
  writeFileSync(join(goldens, `${name}.json`), writtenGolden(reading))
  console.log(`${name}: firstPass ${reading.summary.firstPass}, validity ${reading.validity.kind}`)
}

for (const file of readdirSync(traces).filter((name) => name.endsWith(".jsonl"))) {
  write(file.replace(".jsonl", ""), readingOf(readTrace(join(traces, file))))
}

// The aggregate is one fold over the five Workflows' traces together, so it
// is the same arithmetic as each of them and never a sum of summaries.
write(
  "aggregate",
  readingOf(WORKFLOWS.flatMap((name) => [...readTrace(join(traces, `${name}.jsonl`))])),
)

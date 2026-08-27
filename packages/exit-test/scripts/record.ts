// Records one deliberate pass of the five canned Workflows against the
// pinned model: the Trace of each pass into traces/<workflow>.jsonl, and the
// raw provider streams into cassettes/<workflow>.json, one entry per
// Provider Turn, for `recorded` to replay. The two are projections of one
// recording: the golden is folded from the trace, and the deterministic gate
// replays the cassette back through the same fixture.
//
// It follows the two generators the tree already trusts: run deliberately,
// review the diff, and commit. A vendored trace carries whatever the
// response held, so read it before it lands.
//
//   ANTHROPIC_API_KEY=... bun packages/exit-test/scripts/record.ts [--each N]
//
// The endpoint is pinned the same way the runner pins it, so a recording
// carries the streams of the service the measurement names.
//
// Then regenerate the goldens: `bun packages/exit-test/scripts/generate.ts`
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encodeLine, type Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { WORKFLOWS } from "../src/fixture.js"
import { runFixture } from "../src/run.js"

const root = join(new URL(".", import.meta.url).pathname, "..")
const each = Number(process.argv[process.argv.indexOf("--each") + 1] || 1)

for (const name of WORKFLOWS) {
  // The natural seam: every provider response, as the chunks that arrived.
  const turns: { payloads: readonly Payload[] }[] = []
  const recorder = define({
    id: "exit.recorder",
    effect: Effect.fn("exit.recorder")(function* (ctx) {
      yield* ctx.providerHooks["provider.response.after"]((event) => {
        turns.push({ payloads: event.payloads.get() })
      })
    }),
  })

  const events = await runFixture({
    workflow: name,
    passes: each,
    traceDir: join(tmpdir(), `eva-record-${name}`),
    plugins: [recorder],
  })

  // The vendored trace stays one file: the run's per-Session files, in
  // creation order, flattened for the goldens and the gate tests to read.
  mkdirSync(join(root, "traces"), { recursive: true })
  writeFileSync(join(root, "traces", `${name}.jsonl`), events.map(encodeLine).join("\n") + "\n")

  mkdirSync(join(root, "cassettes"), { recursive: true })
  writeFileSync(
    join(root, "cassettes", `${name}.json`),
    JSON.stringify({ passes: each, turns }, null, 2) + "\n",
  )
  console.log(`${name}: ${turns.length} Provider Turns recorded over ${each} passes`)
}
console.log("Read the diff before committing, then regenerate the goldens.")

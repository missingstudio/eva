// Regenerates the vendored traces from the vendored cassettes: the same
// fixture Build, the same Workflow harness, the same Validator, with the
// recorded Provider streams standing in for the pinned model. Run
// deliberately after a change to the machinery the fixture runs on, review
// the diff, and commit — then regenerate the goldens:
// `bun packages/exit-test/scripts/generate.ts`
//
// The gate in src/replay.test.ts does this same replay in a scratch
// directory on every push, so a drift among cassette, trace and golden fails
// there rather than lingering.
import { join } from "node:path"
import { recorded } from "@missingstudio/eva-testkit"
import { WORKFLOWS } from "../src/fixture.js"
import { cassetteOf, runFixture } from "../src/run.js"

const root = join(new URL(".", import.meta.url).pathname, "..")

for (const name of WORKFLOWS) {
  const cassette = cassetteOf(name)
  const events = await runFixture({
    workflow: name,
    passes: cassette.passes,
    tracePath: join(root, "traces", `${name}.jsonl`),
    plugins: [recorded(cassette)],
  })
  console.log(`${name}: ${cassette.turns.length} turns replayed into ${events.length} events`)
}
console.log("Read the diff before committing, then regenerate the goldens.")

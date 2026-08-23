// Records one deliberate pass of the five canned Workflows against the
// pinned model: the Trace of each pass into traces/<workflow>.jsonl, and the
// raw provider streams into cassettes/<workflow>.json, one entry per
// Provider Turn, for `recorded` to replay.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { auth } from "@missingstudio/eva-auth"
import { boot, buildOf, harnessHost } from "@missingstudio/eva-boot"
import { catalogModels } from "@missingstudio/eva-catalog-models"
import { catalogPrices } from "@missingstudio/eva-catalog-prices"
import { config } from "@missingstudio/eva-config"
import { newSessionID } from "@missingstudio/eva-core"
import { resolveConfiguration } from "@missingstudio/eva-kernel"
import { prompt } from "@missingstudio/eva-prompt"
import { providerAnthropic } from "@missingstudio/eva-provider-anthropic"
import { providerRetry } from "@missingstudio/eva-provider-retry"
import type { Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { sessionJsonl } from "@missingstudio/eva-session-jsonl"
import { trace } from "@missingstudio/eva-trace"
import { traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { usage } from "@missingstudio/eva-usage"
import { validator } from "@missingstudio/eva-validator"
import { workflow } from "@missingstudio/eva-workflow"
import { Effect, Exit, Scope } from "effect"
import { hermeticEnv, inputOf } from "./fixture.js"
import { WORKFLOWS } from "../src/score.js"

const root = join(new URL(".", import.meta.url).pathname, "..")
const each = Number(process.argv[process.argv.indexOf("--each") + 1] || 1)

const scratch = mkdtempSync(join(tmpdir(), "eva-record-"))
const hermit = hermeticEnv(scratch)

const record = Effect.fn("exit.record")(function* (name: (typeof WORKFLOWS)[number]) {
  const tracePath = join(root, "traces", `${name}.jsonl`)
  rmSync(tracePath, { force: true })

  // The natural seam: every provider response, as the chunks that arrived.
  const turns: { payloads: readonly Payload[] }[] = []
  const recorder = define({
    id: "exit.recorder",
    effect: Effect.fn("exit.recorder")(function* (ctx) {
      yield* ctx.provider["provider.response.after"]((event) => {
        turns.push({ payloads: event.payloads.get() })
      })
    }),
  })

  const settled = yield* resolveConfiguration({ directory: scratch, env: hermit })
  const scope = yield* Scope.make()
  const kernel = yield* boot({
    scope,
    resolved: [
      ...settled.plugins.map((entry) =>
        entry.id === "eva.trace.jsonl" ? { ...entry, options: { path: tracePath } } : entry,
      ),
      { id: recorder.id },
    ],
    build: buildOf([
      trace,
      traceJsonl,
      sessionJsonl,
      auth,
      catalogModels,
      catalogPrices,
      providerAnthropic,
      providerRetry,
      usage,
      validator,
      prompt,
      workflow,
      config,
      recorder,
    ]),
    config: settled.config.raw,
  })
  if (kernel.missing.length > 0) {
    throw new Error(
      `the fixture names plugins this recorder does not carry: ${kernel.missing.join(", ")}`,
    )
  }

  const input = readFileSync(inputOf(name), "utf8")
  const rows = yield* kernel.domains.harness.get
  const row = rows.find((one) => one.id === name)
  if (row?.open === undefined) throw new Error(`no runnable harness row ${name}`)

  for (let pass = 1; pass <= each; pass += 1) {
    const session = newSessionID()
    const harness = yield* Effect.provideService(
      row.open(harnessHost(kernel, session, () => Effect.void)),
      Scope.Scope,
      scope,
    )
    const reason = yield* harness.prompt(session, { kind: "prompt", text: input })
    console.log(`${name} pass ${pass}: ${String(reason)}`)
  }

  // Closing the scope flushes the jsonl sink before the cassette lands.
  yield* Scope.close(scope, Exit.void)
  mkdirSync(join(root, "cassettes"), { recursive: true })
  writeFileSync(join(root, "cassettes", `${name}.json`), JSON.stringify({ turns }, null, 2) + "\n")
  console.log(`${name}: ${turns.length} Provider Turns recorded`)
})

await Effect.runPromise(
  Effect.gen(function* () {
    for (const name of WORKFLOWS) yield* record(name)
  }),
)
console.log("Read the diff before committing, then regenerate the goldens.")

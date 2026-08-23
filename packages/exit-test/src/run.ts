import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { auth } from "@missingstudio/eva-auth"
import { boot, buildOf } from "@missingstudio/eva-boot"
import { catalogModels } from "@missingstudio/eva-catalog-models"
import { catalogPrices } from "@missingstudio/eva-catalog-prices"
import { config } from "@missingstudio/eva-config"
import { newSessionID } from "@missingstudio/eva-core"
import { resolveConfiguration } from "@missingstudio/eva-kernel"
import { prompt } from "@missingstudio/eva-prompt"
import { providerAnthropic } from "@missingstudio/eva-provider-anthropic"
import { providerRetry } from "@missingstudio/eva-provider-retry"
import { readTrace, type Event } from "@missingstudio/eva-schema"
import type { Plugin } from "@missingstudio/eva-sdk"
import { sessionJsonl } from "@missingstudio/eva-session-jsonl"
import { openRow, type Cassette } from "@missingstudio/eva-testkit"
import { trace } from "@missingstudio/eva-trace"
import { traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { usage } from "@missingstudio/eva-usage"
import { validator } from "@missingstudio/eva-validator"
import { workflow } from "@missingstudio/eva-workflow"
import { Effect, Exit, Scope } from "effect"
import { hermeticEnv, inputOf, type WORKFLOWS } from "./fixture.js"

const ROOT = join(new URL(".", import.meta.url).pathname, "..")

/**
 * What an in-process run of the fixture can carry. The fixture's config.yaml
 * is the one source of what loads; this table is the universe it may pick
 * from, stated once — the recorder script used to mirror the config's ids by
 * hand and catch the drift with a throw.
 */
const CARRIES: readonly Plugin[] = [
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
]

export interface FixtureRun {
  readonly workflow: (typeof WORKFLOWS)[number]
  // Where the Trace lands. A file already there is removed first: the Trace
  // this answers is this run's, whole.
  readonly tracePath: string
  readonly passes?: number
  /**
   * Riders loaded after the fixture's own plugins — the response recorder,
   * or a recorded Provider standing in for the pinned one. A rider that
   * answers `model.resolve` wins it, because two claims on one namespace
   * resolve by load order and the rider loads last.
   */
  readonly plugins?: readonly Plugin[]
}

/**
 * One way to run the fixture: hand it a fixture Workflow, get back its
 * Trace. The measurement's recorder, the deterministic replay gate, and any
 * suite that wants the fixture in-process all go through here, over the same
 * hermetic environment the process fan-out uses.
 */
export const runFixture = async (run: FixtureRun): Promise<readonly Event[]> => {
  const scratch = mkdtempSync(join(tmpdir(), "eva-fixture-"))
  const hermit = hermeticEnv(scratch, run.tracePath)
  const input = readFileSync(inputOf(run.workflow), "utf8")
  const riders = run.plugins ?? []
  rmSync(run.tracePath, { force: true })

  return Effect.runPromise(
    Effect.gen(function* () {
      const settled = yield* resolveConfiguration({ directory: scratch, env: hermit })
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: [...settled.plugins, ...riders.map((one) => ({ id: one.id }))],
        build: buildOf([...CARRIES, ...riders]),
        config: settled.config.raw,
      })
      if (kernel.missing.length > 0) {
        throw new Error(
          `the fixture names plugins this Build does not carry: ${kernel.missing.join(", ")}`,
        )
      }

      for (let pass = 1; pass <= (run.passes ?? 1); pass += 1) {
        const session = newSessionID()
        const { harness } = yield* openRow(kernel, scope, run.workflow, session)
        yield* harness.prompt(session, { kind: "prompt", text: input })
      }

      // Closing the scope flushes the jsonl sink before the trace is read.
      yield* Scope.close(scope, Exit.void)
      return readTrace(run.tracePath)
    }),
  )
}

/**
 * A vendored recording of one Workflow's Provider streams, plus how many
 * passes produced them — what `recorded` replays and the deterministic gate
 * runs the fixture over.
 */
export interface FixtureCassette extends Cassette {
  readonly passes: number
}

export const cassetteOf = (workflow: (typeof WORKFLOWS)[number]): FixtureCassette =>
  JSON.parse(readFileSync(join(ROOT, "cassettes", `${workflow}.json`), "utf8")) as FixtureCassette

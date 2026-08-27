import { modelRef, type ModelRef } from "@missingstudio/eva-core"
import { boot, type Build, type Kernel } from "@missingstudio/eva-boot"
import type { Client } from "@missingstudio/eva-client-runtime"
import { DEFAULT_MODEL } from "@missingstudio/eva-catalog-models"
import { findings, KEYS, type Finding } from "@missingstudio/eva-config"
import {
  originOf,
  resolveConfiguration,
  type Config,
  type Overlays,
  type Resolution,
} from "@missingstudio/eva-kernel"
import type { Claim } from "@missingstudio/eva-schema"
import type { Domains } from "@missingstudio/eva-sdk"
import { Effect, Fiber, Scope, Stream } from "effect"
import { BUILD, BUILT_IN_IDS, entriesOf, readsOf, uncarriedOf } from "./plugins.js"
import { sayEvicted, sayMiss } from "./report.js"
import type { World } from "./world.js"

export { DEFAULT_MODEL } from "@missingstudio/eva-catalog-models"
export { newSessionID } from "@missingstudio/eva-core"

/**
 * The resolution, the model it names read as a reference, and what it
 * reached nothing with.
 */
export interface ResolvedConfig extends Resolution {
  readonly model: ModelRef
  // Which harness answers a Prompt that names none. Absent is a bare Run.
  readonly harness?: string
  readonly findings: readonly Finding[]
  /**
   * The environment this config was resolved under, carried rather than read
   * again. What a run reads from outside itself is the World's, and the one
   * write in the permission lifecycle — the rule an `allow_always` leaves in
   * the person's own config file — lands where this says and never where the
   * process does.
   */
  readonly env: NodeJS.ProcessEnv
}

export interface Started {
  readonly kernel: Kernel
  readonly config: Config
  readonly model: ModelRef
  readonly harness?: string
  // The environment the config was resolved under. Every door hands it to the
  // gate, so a grant is written where this run was told to write.
  readonly env: NodeJS.ProcessEnv
}

/**
 * The default harness this directory names, read through the same declaration
 * `model` is read through. An empty name is no name: a key written and left
 * blank is not a harness nobody can find.
 */
const harnessIn = (raw: Record<string, unknown>): { readonly harness?: string } => {
  const named = KEYS.read(raw, "harness", "")
  return named === "" ? {} : { harness: named }
}

/**
 * What a run would use, resolved but not started. The kernel owns the order;
 * this only hands it the flags and reads the settled model as a reference,
 * because the catalog owns the default and the kernel does not know it.
 *
 * The parser already answers in the kernel's own shape, so the flags pass
 * through rather than being mapped a second time here.
 */
export const resolveConfig = Effect.fn("cli.resolveConfig")(function* (
  overlays: Overlays,
  world: World,
) {
  const settled = yield* resolveConfiguration({
    builtIn: BUILT_IN_IDS,
    overlays,
    directory: world.cwd,
    env: world.env,
  })
  return {
    ...settled,
    env: world.env,
    // Read through the declaration that owns the key, so the app and the
    // plugin that projects it cannot disagree about what `model` is.
    model: modelRef(KEYS.read(settled.config.raw, "model", "")) ?? DEFAULT_MODEL,
    ...harnessIn(settled.config.raw),
    findings: findings({
      raw: settled.config.raw,
      origin: (key) => originOf(settled.config, key),
      directory: settled.location.directory,
      ignored: settled.location.ignored,
      reads: readsOf(settled.plugins),
      entries: entriesOf(settled.plugins),
      uncarried: uncarriedOf(settled.plugins),
    }),
  } satisfies ResolvedConfig
})

/**
 * Says what the kernel's broadcast reports, in `say`'s voice: each distinct
 * miss once — a persistent miss recurs on every rebuild by design, so the
 * lines deduplicate across rebuilds — and every slot eviction as it happens.
 * Subscribed through `observe`, before boot loads anything, because a
 * Broadcast has no replay.
 */
export const watchKernel = (scope: Scope.Scope, err: (text: string) => void) =>
  Effect.fn("cli.watchKernel")(function* (kernel: Kernel) {
    const said = new Set<string>()
    const topics = Object.keys(kernel.domains) as (keyof Domains)[]
    yield* Effect.forEach(topics, (name) =>
      Effect.forkIn(
        Stream.runForEach(kernel.broadcast.subscribe(`${name}.updated`), (payload) =>
          Effect.sync(() => {
            for (const miss of payload.missed) {
              const key = `${name} ${miss.id} ${miss.owner ?? ""}`
              if (said.has(key)) continue
              said.add(key)
              err(sayMiss(name, miss))
            }
          }),
        ),
        scope,
      ),
    )
    yield* Effect.forkIn(
      Stream.runForEach(kernel.broadcast.subscribe("slot.filled"), (payload) =>
        Effect.sync(() => {
          if (payload.evicted !== undefined)
            err(sayEvicted(payload.slot, payload.by, payload.evicted))
        }),
      ),
      scope,
    )
    // One yield, so the subscribers attach before the load batch publishes.
    yield* Effect.yieldNow
  })

/**
 * Every plugin the config resolves to, loaded from this build's table. It
 * takes a resolution the caller already has, so a run that reported on the
 * config does not resolve it a second time and risk two answers.
 *
 * The table is a parameter with the build as its default, so a test hands
 * over one whose provider is scripted and every branch of `main` runs
 * without a key.
 */
export const startFrom = Effect.fn("cli.startFrom")(function* (
  scope: Scope.Scope,
  settled: ResolvedConfig,
  build: Build = BUILD,
  // Where boot-time reports land. A caller that hands nothing watches nothing.
  say?: (text: string) => void,
) {
  const { config, model, harness, env, plugins: resolved } = settled

  const kernel = yield* boot({
    scope,
    resolved,
    build,
    config: config.raw,
    ...(say === undefined ? {} : { observe: watchKernel(scope, say) }),
  })

  return {
    kernel,
    config,
    model,
    env,
    ...(harness === undefined ? {} : { harness }),
  } satisfies Started
})

export const start = Effect.fn("cli.start")(function* (
  scope: Scope.Scope,
  overlays: Overlays,
  world: World,
) {
  return yield* startFrom(scope, yield* resolveConfig(overlays, world))
})

export interface HarnessResult {
  readonly claim: Claim
  // The text of the Run that closed last. Empty when no Run wrote any.
  readonly text: string
}

export interface HarnessInput {
  // The harness row id the verb named.
  readonly harness: string
  // The one input, as the Prompt text.
  readonly text: string
  // The directory the new Session belongs to.
  readonly location: string
}

/**
 * One Prompt through the Harness the verb named, and the answer the runtime
 * gives back. A Workflow is many Runs and each one reports its text, so the
 * Answer is the last one's and the Runs before it stay in the Trace, where
 * they belong.
 *
 * It runs the same protocol the Console and the print path run. A Workflow
 * says no live stream a reader wants, so nothing is done with the signals —
 * but the Session is reached through the Client here as everywhere else,
 * rather than by reading the kernel's own slots behind it.
 */
export const runHarness = Effect.fn("cli.runHarness")(function* (
  client: Client,
  input: HarnessInput,
) {
  const session = yield* client.api.create(input.location)
  const { answer } = yield* client.run(
    session,
    { kind: "prompt", text: input.text, harness: input.harness },
    () => {},
  )

  // A build with no Trace has no record to answer from, and says so.
  return {
    claim: answer.claim ?? { result: "failed", summary: "the Workflow left no record" },
    text: answer.text,
  } satisfies HarnessResult
})

/**
 * The first Ctrl-C cancels the Run. `submit` commits the partial
 * work and closes the Run `cancelled`, because an interrupted Run still
 * closes; a second signal exits immediately.
 */
export const withSignals = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    let interrupted = false
    const onSignal = () => {
      if (interrupted) process.exit(130)
      interrupted = true
      Effect.runFork(Fiber.interrupt(fiber))
    }
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)
    const exit = yield* Fiber.await(fiber)
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    return yield* exit
  })

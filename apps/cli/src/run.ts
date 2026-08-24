import { modelRef, type ModelRef, type SessionAPI } from "@missingstudio/eva-core"
import { boot, type Build, type Kernel } from "@missingstudio/eva-boot"
import { DEFAULT_MODEL } from "@missingstudio/eva-catalog-models"
import { findings, KEYS, type Finding } from "@missingstudio/eva-config"
import {
  originOf,
  resolveConfiguration,
  type Config,
  type Overlays,
  type Resolution,
} from "@missingstudio/eva-kernel"
import { costLine } from "@missingstudio/eva-print"
import { answerFold, type Claim, type SessionID } from "@missingstudio/eva-schema"
import type { Domains } from "@missingstudio/eva-sdk"
import { Effect, Fiber, Scope, Stream } from "effect"
import { BUILD, BUILT_IN_IDS, entriesOf, readsOf, uncarriedOf } from "./plugins.js"
import { sayMiss } from "./report.js"
import type { World } from "./world.js"

export { DEFAULT_MODEL } from "@missingstudio/eva-catalog-models"
export { newSessionID } from "@missingstudio/eva-core"

/**
 * The resolution, the model it names read as a reference, and what it
 * reached nothing with.
 */
export interface ResolvedConfig extends Resolution {
  readonly model: ModelRef
  readonly findings: readonly Finding[]
}

export interface Started {
  readonly kernel: Kernel
  readonly config: Config
  readonly model: ModelRef
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
    // Read through the declaration that owns the key, so the app and the
    // plugin that projects it cannot disagree about what `model` is.
    model: modelRef(KEYS.read(settled.config.raw, "model", "")) ?? DEFAULT_MODEL,
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
 * Says each distinct miss once, in `say`'s voice. Subscribed through
 * `observe`, before boot loads anything, because a Broadcast has no replay.
 * A persistent miss recurs on every rebuild by design, so the lines
 * deduplicate across rebuilds.
 */
export const watchMisses = (scope: Scope.Scope, err: (text: string) => void) =>
  Effect.fn("cli.watchMisses")(function* (kernel: Kernel) {
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
  const { config, model, plugins: resolved } = settled

  const kernel = yield* boot({
    scope,
    resolved,
    build,
    config: config.raw,
    ...(say === undefined ? {} : { observe: watchMisses(scope, say) }),
  })

  return { kernel, config, model } satisfies Started
})

export const start = Effect.fn("cli.start")(function* (
  scope: Scope.Scope,
  overlays: Overlays,
  world: World,
) {
  return yield* startFrom(scope, yield* resolveConfig(overlays, world))
})

export interface PrintResult {
  readonly claim: Claim
  readonly session: SessionID
  readonly costLine: string
}

/**
 * One Run, printed, over the Session API like every other surface. The
 * stream is only what the reader sees; the claim and the cost come from
 * the record.
 */
export interface PrintOptions {
  // Continue an existing Session rather than opening a new one. The prior
  // Runs are folded back in as history, so the conversation carries.
  readonly session?: SessionID
  // The directory the new Session belongs to.
  readonly location?: string
  readonly write?: (text: string) => void
}

export const runPrint = Effect.fn("cli.runPrint")(function* (
  api: SessionAPI,
  prompt: string,
  options: PrintOptions = {},
) {
  const write = options.write ?? ((text: string) => void process.stdout.write(text))
  const session = options.session ?? (yield* api.create(options.location ?? process.cwd()))

  let claim: Claim = { result: "failed", summary: "the Run closed without a claim" }
  const watching = yield* Effect.forkChild(
    Stream.runForEach(
      Stream.takeUntil(api.watch(session), (one) => one.kind === "finished"),
      (payload) =>
        Effect.sync(() => {
          if (payload.kind === "text" && payload.content.type === "text") {
            write(payload.content.text)
          }
          if (payload.kind === "finished") claim = payload.claim
        }),
    ),
  )

  // Being asked to stop is a cancel, so the Run still closes and the
  // partial work is kept.
  yield* Effect.onInterrupt(api.submit(session, { kind: "prompt", text: prompt }), () =>
    api.cancel(session, "user"),
  )
  yield* Fiber.await(watching)

  const transcript = yield* Effect.scoped(api.attach(session))
  return { claim, session, costLine: costLine(transcript.cost()) } satisfies PrintResult
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
 * One Prompt through the Harness the verb named, and the answer read back
 * from the record. A Workflow is many Runs and each one reports its text, so
 * the surface filters: the last Run's text is the answer, and the Runs
 * before it are in the Trace, where they belong.
 *
 * The record rather than the live stream, because the stream never says
 * which `finished` is the last one — `submit` returning is what says the
 * Workflow is over, and by then everything is committed.
 */
export const runHarness = Effect.fn("cli.runHarness")(function* (
  kernel: Kernel,
  api: SessionAPI,
  input: HarnessInput,
) {
  const session = yield* api.create(input.location)

  // Being asked to stop is a cancel, so the Run still closes and the
  // partial work is kept.
  yield* Effect.onInterrupt(
    api.submit(session, { kind: "prompt", text: input.text, harness: input.harness }),
    () => api.cancel(session, "user"),
  )

  const sink = yield* kernel.slot.traceSink.peek
  const events = sink === undefined ? [] : [...(yield* Stream.runCollect(sink.replay(session)))]
  const answered = answerFold(events)

  // A build with no Trace has no record to answer from, and says so.
  return {
    claim: answered.claim ?? { result: "failed", summary: "the Workflow left no record" },
    text: answered.text,
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

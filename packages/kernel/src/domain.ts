import type { Domain, Registration, TransformCallback } from "@missingstudio/eva-core"
import { Context, Effect, Scope, Semaphore } from "effect"

export interface DomainOptions<State, Draft> {
  readonly name: string
  // Builds the base value for the first build and every rebuild.
  readonly initial: () => State
  // Wraps mutable state in the editor a transform sees.
  readonly draft: (state: State) => Draft
  // Runs after every transform and before the new state is visible.
  readonly finalize?: (draft: Draft, state: State) => Effect.Effect<void> | void
  // Published after the new state commits.
  readonly onCommit?: (state: State) => Effect.Effect<void>
}

// Collects rebuilds during boot so each domain rebuilds once.
const CurrentBatch = Context.Reference<Set<Effect.Effect<void>> | undefined>(
  "eva/Domain/CurrentBatch",
  { defaultValue: () => undefined },
)

/**
 * Runs `effect` with rebuilds batched. Every domain a transform touches
 * rebuilds once at the end instead of once per transform.
 */
export const batch = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const current = yield* CurrentBatch
    if (current !== undefined) return yield* effect
    const reloads = new Set<Effect.Effect<void>>()
    const result = yield* effect.pipe(Effect.provideService(CurrentBatch, reloads))
    yield* Effect.forEach(reloads, (reload) => reload, { discard: true })
    return result
  })

export const makeDomain = <State, Draft>(
  options: DomainOptions<State, Draft>,
): Effect.Effect<Domain<State, Draft>> =>
  Effect.gen(function* () {
    const transforms: TransformCallback<Draft>[] = []
    const gate = yield* Semaphore.make(1)
    // Assigned by the first build below, which always runs before this returns.
    let committed!: State

    const build = Effect.fn(`kernel.domain.${options.name}.build`)(function* () {
      // The list is captured at rebuild start: a change during a replay
      // applies to the next rebuild, never to this one.
      const replaying = [...transforms]
      const fresh = options.initial()
      const draft = options.draft(fresh)
      for (const transform of replaying) {
        transform(draft)
      }
      if (options.finalize !== undefined) {
        const result = options.finalize(draft, fresh)
        if (result !== undefined) yield* result
      }
      committed = fresh
      if (options.onCommit !== undefined) yield* options.onCommit(fresh)
    })

    const rebuild = gate.withPermits(1)(build())

    // Inside a batch the rebuild is deferred; outside it runs now. Either
    // way the semaphore serializes it, so concurrent calls coalesce.
    const schedule = Effect.gen(function* () {
      const current = yield* CurrentBatch
      if (current === undefined) return yield* rebuild
      current.add(rebuild)
    })

    const transform = Effect.fn(`kernel.domain.${options.name}.transform`)(function* (
      callback: TransformCallback<Draft>,
    ) {
      transforms.push(callback)
      yield* schedule
      let disposed = false
      const dispose = Effect.gen(function* () {
        if (disposed) return
        disposed = true
        const at = transforms.indexOf(callback)
        if (at >= 0) transforms.splice(at, 1)
        yield* schedule
      })
      const scope = yield* Effect.scope
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose } satisfies Registration
    })

    yield* rebuild

    return {
      get: Effect.sync(() => committed),
      transform,
      reload: rebuild,
    }
  })

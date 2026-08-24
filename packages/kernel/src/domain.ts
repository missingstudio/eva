import type { Domain, DomainMiss, Registration, TransformCallback } from "@missingstudio/eva-core"
import { Context, Effect, Scope, Semaphore } from "effect"

export interface DomainOptions<State, Draft> {
  readonly name: string
  // Builds the base value for the first build and every rebuild.
  readonly initial: () => State
  // Wraps mutable state in the editor a transform sees. `miss` reports an
  // edit that reached no row; the kernel collects the misses per rebuild
  // and names the owner of the transform that was replaying.
  readonly draft: (state: State, miss: (id: string, owner?: string) => void) => Draft
  // Runs after every transform and before the new state is visible.
  readonly finalize?: (draft: Draft, state: State) => Effect.Effect<void> | void
  // Published after the new state commits, with the rebuild's misses.
  readonly onCommit?: (state: State, missed: readonly DomainMiss[]) => Effect.Effect<void>
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
    interface Registered {
      readonly callback: TransformCallback<Draft>
      readonly owner?: string
    }
    const transforms: Registered[] = []
    const gate = yield* Semaphore.make(1)
    // Assigned by the first build below, which always runs before this returns.
    let committed!: State

    const build = Effect.fn(`kernel.domain.${options.name}.build`)(function* () {
      // The list is captured at rebuild start: a change during a replay
      // applies to the next rebuild, never to this one.
      const replaying = [...transforms]
      const fresh = options.initial()
      // Collected per rebuild: a persistent miss reappears on every rebuild,
      // and one the replay no longer makes disappears on its own.
      const missed: DomainMiss[] = []
      // A transform is synchronous, so the owner of the one replaying is a
      // plain variable the draft's `miss` reads.
      let owner: string | undefined
      const draft = options.draft(fresh, (id, explicit) => {
        const named = explicit ?? owner
        missed.push(named === undefined ? { id } : { id, owner: named })
      })
      for (const registered of replaying) {
        owner = registered.owner
        registered.callback(draft)
      }
      owner = undefined
      if (options.finalize !== undefined) {
        const result = options.finalize(draft, fresh)
        if (result !== undefined) yield* result
      }
      committed = fresh
      if (options.onCommit !== undefined) yield* options.onCommit(fresh, missed)
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
      owner?: string,
    ) {
      const registered: Registered = owner === undefined ? { callback } : { callback, owner }
      transforms.push(registered)
      yield* schedule
      let disposed = false
      const dispose = Effect.gen(function* () {
        if (disposed) return
        disposed = true
        const at = transforms.indexOf(registered)
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

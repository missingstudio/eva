import { EmptySlotError, type Registration, type Slot } from "@missingstudio/eva-core"
import { Effect, Scope } from "effect"

export interface SlotEvents {
  // `evicted` names a live holder with a different id that this fill
  // displaced. A same-id re-provide is a hot swap and carries none.
  readonly filled: (slot: string, by: string, evicted?: string) => Effect.Effect<void>
  readonly emptied: (slot: string) => Effect.Effect<void>
}

const silent: SlotEvents = { filled: () => Effect.void, emptied: () => Effect.void }

/**
 * One capability, one plugin, read late. A consumer that reads `get` at the
 * point of use sees a replacement on its next read; one that captured the
 * value keeps the old implementation, which is the bug the slot exists to
 * make visible.
 */
export const makeSlot = <T>(name: string, events: SlotEvents = silent): Effect.Effect<Slot<T>> =>
  Effect.sync(() => {
    let held: { id: string; implementation: T } | undefined

    const provide = Effect.fn(`kernel.slot.${name}.provide`)(function* (
      id: string,
      implementation: T,
    ) {
      // Last-writer-wins stays — load order is precedence everywhere in Eva
      // — but a displaced holder's work is discarded, so it is named.
      const displaced = held !== undefined && held.id !== id ? held.id : undefined
      held = { id, implementation }
      yield* events.filled(name, id, displaced)

      let disposed = false
      const dispose = Effect.gen(function* () {
        if (disposed) return
        disposed = true
        // A later provider already replaced this one; leave it alone.
        if (held?.id !== id) return
        held = undefined
        yield* events.emptied(name)
      })
      const scope = yield* Effect.scope
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose } satisfies Registration
    })

    return {
      get: Effect.suspend(() =>
        held === undefined
          ? Effect.die(new EmptySlotError(name))
          : Effect.succeed(held.implementation),
      ),
      peek: Effect.sync(() => held?.implementation),
      provide,
    }
  })

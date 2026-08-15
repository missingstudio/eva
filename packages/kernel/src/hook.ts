import type { Registration } from "@missingstudio/eva-core"
import { Effect, Scope } from "effect"

export type HookCallback<Event> = (event: Event) => Effect.Effect<void> | void

/**
 * Hooks run sequentially in registration order, and a later hook sees what
 * an earlier one changed. Disposal affects the next invocation; a call
 * already in flight finishes with the list it started with.
 */
export interface HookRegistry<Spec> {
  readonly on: <Name extends keyof Spec>(
    name: Name,
    callback: HookCallback<Spec[Name]>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly run: <Name extends keyof Spec>(name: Name, event: Spec[Name]) => Effect.Effect<void>
}

export const makeHooks = <Spec>(): Effect.Effect<HookRegistry<Spec>> =>
  Effect.sync(() => {
    const callbacks = new Map<keyof Spec, HookCallback<never>[]>()

    const on = Effect.fn("kernel.hook.on")(function* <Name extends keyof Spec>(
      name: Name,
      callback: HookCallback<Spec[Name]>,
    ) {
      const list = callbacks.get(name) ?? []
      list.push(callback as HookCallback<never>)
      callbacks.set(name, list)

      let disposed = false
      const dispose = Effect.sync(() => {
        if (disposed) return
        disposed = true
        const at = list.indexOf(callback as HookCallback<never>)
        if (at >= 0) list.splice(at, 1)
      })
      const scope = yield* Effect.scope
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose } satisfies Registration
    })

    const run = Effect.fn("kernel.hook.run")(function* <Name extends keyof Spec>(
      name: Name,
      event: Spec[Name],
    ) {
      // Copied, so a dispose during the run does not change this pass.
      const running = (callbacks.get(name) ?? []).slice()
      for (const callback of running) {
        const result = (callback as HookCallback<Spec[Name]>)(event)
        if (result !== undefined) yield* result
      }
    })

    return { on, run }
  })

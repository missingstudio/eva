import type { HookBoundaries, HookFailure, Registration } from "@missingstudio/eva-core"
import { Cause, Effect, Exit, Scope } from "effect"

export type HookCallback<Event> = (event: Event) => Effect.Effect<void> | void

export interface HookEvents {
  // An observing hook that threw. The Run continues without it.
  readonly failed: (failure: HookFailure) => Effect.Effect<void>
}

const silent: HookEvents = { failed: () => Effect.void }

/**
 * Hooks run sequentially in registration order, and a later hook sees what
 * an earlier one changed. Disposal affects the next invocation; a call
 * already in flight finishes with the list it started with.
 *
 * A hook that throws fails toward its boundary's safe side. At an observing
 * boundary the failure is reported and the next hook runs, because a broken
 * observer must never end a Run. At a deciding boundary the failure is the
 * boundary's answer: `run` hands it back, no later hook runs, and the caller
 * denies the call — a gate that fails open because a plugin threw is not a
 * gate.
 */
export interface HookRegistry<Spec> {
  // `owner` names the plugin registering the hook, so a failure can say
  // whose hook threw.
  readonly on: <Name extends keyof Spec>(
    name: Name,
    callback: HookCallback<Spec[Name]>,
    owner: string,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  /**
   * The denial this pass produced, or nothing. Only a deciding boundary ever
   * answers a denial; an observing one always answers nothing, because its
   * failures went to `failed` instead.
   */
  readonly run: <Name extends keyof Spec>(
    name: Name,
    event: Spec[Name],
  ) => Effect.Effect<HookFailure | undefined>
}

interface Registered<Event> {
  readonly callback: HookCallback<Event>
  readonly owner: string
}

// The boundary map is the caller's, not a hook's: only the caller of the
// hooks knows what they decide, so a plugin cannot register an observer at a
// deciding boundary and weaken it.
export const makeHooks = <Spec>(
  boundary: HookBoundaries<Spec>,
  events: HookEvents = silent,
): Effect.Effect<HookRegistry<Spec>> =>
  Effect.sync(() => {
    const callbacks = new Map<keyof Spec, Registered<never>[]>()

    const on = Effect.fn("kernel.hook.on")(function* <Name extends keyof Spec>(
      name: Name,
      callback: HookCallback<Spec[Name]>,
      owner: string,
    ) {
      const list = callbacks.get(name) ?? []
      const entry = { callback, owner } as Registered<never>
      list.push(entry)
      callbacks.set(name, list)

      let disposed = false
      const dispose = Effect.sync(() => {
        if (disposed) return
        disposed = true
        const at = list.indexOf(entry)
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
      for (const entry of running) {
        // `suspend` catches a hook that throws where it stands, which an
        // Effect the hook returns would not.
        const exit = yield* Effect.exit(
          Effect.suspend(() => {
            const result = (entry.callback as HookCallback<Spec[Name]>)(event)
            return result === undefined ? Effect.void : result
          }),
        )
        if (Exit.isSuccess(exit)) continue

        const failure: HookFailure = {
          hook: String(name),
          owner: entry.owner,
          cause: Cause.squash(exit.cause),
        }
        if (boundary[name] === "deciding") return failure
        yield* events.failed(failure)
      }
      return undefined
    })

    return { on, run }
  })

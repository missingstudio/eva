import { PluginCycleError } from "@missingstudio/eva-core"
import { Cause, Deferred, Effect, Exit, Scope } from "effect"

export type PluginEffect<Context> = (context: Context) => Effect.Effect<void, never, Scope.Scope>

export interface PluginEntry<Context> {
  readonly id: string
  readonly effect: PluginEffect<Context>
}

export interface PluginEvents {
  readonly added: (id: string) => Effect.Effect<void>
  readonly removed: (id: string) => Effect.Effect<void>
  readonly failed: (id: string, cause: unknown) => Effect.Effect<void>
}

const silent: PluginEvents = {
  added: () => Effect.void,
  removed: () => Effect.void,
  failed: () => Effect.void,
}

export interface PluginRuntime<Context> {
  // Loads a plugin. Re-adding a known id replaces it and keeps its order.
  readonly add: (plugin: PluginEntry<Context>) => Effect.Effect<void>
  // Unloads a plugin. Closes its scope and removes every registration.
  readonly remove: (id: string) => Effect.Effect<void>
  // Waits until a plugin has finished loading.
  readonly wait: (id: string) => Effect.Effect<void>
  // Lists loaded plugins in load order.
  readonly list: Effect.Effect<readonly string[]>
}

interface Loaded {
  readonly scope: Scope.Closeable
  readonly done: Deferred.Deferred<void>
}

export const makePluginRuntime = <Context>(
  parent: Scope.Scope,
  // Built per plugin, because a context carries the plugin's own id and
  // the options config resolved for it.
  context: (id: string) => Context,
  events: PluginEvents = silent,
): Effect.Effect<PluginRuntime<Context>> =>
  Effect.sync(() => {
    const order: string[] = []
    const loaded = new Map<string, Loaded>()
    // The chain of plugins currently loading, so a cycle can name itself.
    const loading: string[] = []

    const close = Effect.fn("kernel.plugin.close")(function* (id: string) {
      const found = loaded.get(id)
      if (found === undefined) return
      loaded.delete(id)
      yield* Scope.close(found.scope, Exit.void)
    })

    const add = Effect.fn("kernel.plugin.add")(function* (plugin: PluginEntry<Context>) {
      if (loading.includes(plugin.id)) {
        return yield* Effect.die(new PluginCycleError([...loading, plugin.id]))
      }

      // A replace keeps the position: OpenCode re-appends, which silently
      // changes which transform wins.
      if (!order.includes(plugin.id)) order.push(plugin.id)
      yield* close(plugin.id)

      const scope = yield* Scope.fork(parent)
      const done = yield* Deferred.make<void>()
      loaded.set(plugin.id, { scope, done })

      loading.push(plugin.id)
      const exit = yield* plugin
        .effect(context(plugin.id))
        .pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.exit,
          Effect.ensuring(Effect.sync(() => void loading.pop())),
        )

      if (Exit.isFailure(exit)) {
        const squashed = Cause.squash(exit.cause)
        if (squashed instanceof PluginCycleError) return yield* Effect.die(squashed)
        // A failed load rolls back. Closing the scope runs every finalizer
        // the effect registered, so no partial registration survives. The
        // Deferred still succeeds: `wait` means the load attempt finished,
        // and `list` says how it went.
        yield* close(plugin.id)
        const at = order.indexOf(plugin.id)
        if (at >= 0) order.splice(at, 1)
        yield* Deferred.succeed(done, undefined)
        yield* events.failed(plugin.id, squashed)
        return
      }

      yield* Deferred.succeed(done, undefined)
      yield* events.added(plugin.id)
    })

    const remove = Effect.fn("kernel.plugin.remove")(function* (id: string) {
      if (!loaded.has(id)) return
      yield* close(id)
      const at = order.indexOf(id)
      if (at >= 0) order.splice(at, 1)
      yield* events.removed(id)
    })

    return {
      add,
      remove,
      wait: (id) => {
        const found = loaded.get(id)
        return found === undefined ? Effect.void : Deferred.await(found.done)
      },
      list: Effect.sync(() => [...order].filter((id) => loaded.has(id))),
    }
  })

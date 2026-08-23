import { boot, buildOf, type Kernel } from "@missingstudio/eva-boot"
import type { Event } from "@missingstudio/eva-schema"
import type { Plugin } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope, Stream } from "effect"

/**
 * One plugin in a load, and the entry options it reads through `ctx.options`.
 * A bare plugin is the same entry with no options, so a caller that needs
 * none writes the plugin.
 */
export interface Loaded {
  readonly plugin: Plugin
  readonly options?: Record<string, unknown>
}

export interface KernelOptions {
  // The config every loaded plugin reads through `ctx.config`.
  readonly config?: Record<string, unknown>
}

const loadedOf = (one: Plugin | Loaded): Loaded => ("plugin" in one ? one : { plugin: one })

/**
 * Boots a live kernel over the named plugins, in load order, and hands the
 * body the kernel and the scope it lives in. The scope closes when the body
 * returns, so a finalizer a plugin registered runs before the assertions.
 *
 * Load order is the caller's, because a plugin often writes onto rows
 * another one made — the prices onto the models, the config projection over
 * the defaults beneath it.
 *
 * This is the one spelling of the dance. Every suite that needs several
 * plugins as peers wrote its own — two of them under this very name, with
 * different signatures — and each one owned a `Scope.close` that a new early
 * return could forget.
 */
export const withKernel = <A>(
  loaded: readonly (Plugin | Loaded)[],
  body: (kernel: Kernel, scope: Scope.Scope) => Effect.Effect<A>,
  options: KernelOptions = {},
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const entries = loaded.map(loadedOf)
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: entries.map((one) => ({
          id: one.plugin.id,
          ...(one.options === undefined ? {} : { options: one.options }),
        })),
        build: buildOf(entries.map((one) => one.plugin)),
        ...(options.config === undefined ? {} : { config: options.config }),
      })
      const result = yield* body(kernel, scope)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

/**
 * Every Event the sink behind the Recorder holds, session by session in
 * trace order. It reads the Slot through the contract every sink honors, so
 * a test that wants the record back needs no cast to one sink's own type.
 */
export const committed = (kernel: Kernel): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    const sink = yield* kernel.slot.traceSink.get
    const found: Event[] = []
    for (const session of yield* sink.sessions) {
      found.push(...(yield* Stream.runCollect(sink.replay(session))))
    }
    return found
  })

/**
 * What a plugin is loaded with. `before` names the plugins that load first,
 * because a plugin often writes onto rows another one made — the prices onto
 * the models, the config projection over the defaults beneath it.
 */
export interface LoadOptions {
  // The entry options the plugin reads through `ctx.options`.
  readonly options?: Record<string, unknown>
  // The config the plugin reads through `ctx.config`.
  readonly config?: Record<string, unknown>
  // Loaded ahead of it, in order. Transforms replay in load order.
  readonly before?: readonly Plugin[]
}

/**
 * Runs a plugin's `effect` against a real kernel and hands the body what it
 * registered into.
 *
 * A plugin may not import the kernel, so for a long time nothing tested the
 * half of a plugin that matters: every plugin test asserted on the exported
 * pure helpers, and the `effect` body — the part that touches domains, slots,
 * and hooks — was reachable only from the composition root's own tests. Some
 * plugins grew a hand-written slice of `PluginContext` to escape that, which
 * tests the plugin against a shape nothing else in the tree has.
 *
 * One plugin under test is `withKernel` with the plugin last, so what a test
 * exercises is what production does: the same replay order, the same batch,
 * the same late-bound slots.
 */
export const withPlugin = <A>(
  plugin: Plugin,
  body: (kernel: Kernel) => Effect.Effect<A>,
  options: LoadOptions = {},
): Promise<A> =>
  withKernel(
    [
      ...(options.before ?? []),
      options.options === undefined ? plugin : { plugin, options: options.options },
    ],
    body,
    options.config === undefined ? {} : { config: options.config },
  )

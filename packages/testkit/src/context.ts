import { boot, buildOf, type Kernel } from "@missingstudio/eva-boot"
import type { Plugin } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope } from "effect"

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
 * This boots through the same `boot` a run uses, so what a test exercises is
 * what production does: the same replay order, the same batch, the same
 * late-bound slots.
 */
export const withPlugin = <A>(
  plugin: Plugin,
  body: (kernel: Kernel) => Effect.Effect<A>,
  options: LoadOptions = {},
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const before = options.before ?? []
      const scope = yield* Scope.make()
      const kernel = yield* boot({
        scope,
        resolved: [
          ...before.map((one) => ({ id: one.id })),
          {
            id: plugin.id,
            ...(options.options === undefined ? {} : { options: options.options }),
          },
        ],
        build: buildOf([...before, plugin]),
        ...(options.config === undefined ? {} : { config: options.config }),
      })
      const result = yield* body(kernel)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

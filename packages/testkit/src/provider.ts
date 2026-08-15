import type { Provider } from "@missingstudio/eva-core"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

export const FAKE_PROVIDER = "test.provider.fake"

/**
 * A plugin that answers `model.resolve` with one Provider, the way a provider
 * plugin does.
 *
 * A test that reaches for the hook registry instead needs a cast to call
 * `resolve` — and the cast defeats the map `ProviderHookSpec` exists to
 * check, so a renamed field on the event compiles and the test still passes.
 * It also has to hand the registration a Scope, which inside a plugin the
 * runtime supplies.
 *
 * The reference is answered as it arrives, so the Run resolves whatever model
 * it asked for rather than a model this fake decided on.
 */
export const providing = (provider: Provider, id: string = FAKE_PROVIDER): Plugin =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      yield* ctx.provider["model.resolve"]((event) => {
        event.resolve({ model: event.reference, provider })
      })
    }),
  })

import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { NAMESPACE, makeAnthropicProvider } from "./provider.js"

/**
 * The constructor and the plugin, and not the dialect.
 *
 * `classify`, `toStopReason`, `offering`, `proposedIn` and the rest are how
 * this wire's events become Eva's payloads. They are internal seams with their
 * own suite, and publishing them made this package's interface as wide as its
 * implementation — a reader could not tell the contract from the vocabulary.
 * Every rule this Provider shares with the others is held to one contract in
 * `packages/conformance`, driven through `turn`.
 */
export { makeAnthropicProvider, NAMESPACE, type AnthropicOptions } from "./provider.js"

// Zero leaves the provider's own ceiling in place.
const OPTIONS = declare({ maxTokens: "number" })

export const providerAnthropic = define({
  id: "eva.provider.anthropic",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.provider.anthropic")(function* (ctx) {
    const maxTokens = OPTIONS.read(ctx.options, "maxTokens", 0)

    yield* ctx.providerHooks["model.resolve"](
      Effect.fn("eva.provider.anthropic.resolve")(function* (event) {
        if (event.reference.provider !== NAMESPACE) return
        const store = yield* ctx.slot.credentialStore.peek
        const credential = store === undefined ? undefined : yield* store.get(NAMESPACE)
        // Resolve either way: `available()` carries whether a credential was
        // found, so the Run reports auth_failed rather than no_such_model.
        event.resolve({
          model: event.reference,
          provider: makeAnthropicProvider({
            ...(credential === undefined ? {} : { credential }),
            ...(maxTokens > 0 ? { maxTokens } : {}),
          }),
        })
      }),
    )

    /**
     * The Catalog row's display name. It was guarded by `if (!REPORTS_COST)`,
     * where `REPORTS_COST` was `const false` — a condition that could not be
     * anything else, standing in front of a line that sets a name. `ProviderInfo`
     * has no field for whether a provider reports cost, so the fact had nowhere
     * to land and the guard said nothing.
     */
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(NAMESPACE, (provider) => {
        provider.name = "Anthropic"
      })
    })
  }),
})

import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { NAMESPACE, makeOpenAIProvider } from "./provider.js"

export * from "./provider.js"

// Zero leaves the provider's own ceiling in place.
const OPTIONS = declare({ maxTokens: "number" })

// No catalog transform: `eva.catalog.models` seeds the `openai` provider row
// and its models, and `ProviderInfo` has no field for whether a provider
// reports cost, so there is nothing truthful for one to write.
export const providerOpenAI = define({
  id: "eva.provider.openai",
  takes: OPTIONS.shapes,
  effect: Effect.fn("eva.provider.openai")(function* (ctx) {
    const maxTokens = OPTIONS.read(ctx.options, "maxTokens", 0)

    yield* ctx.providerHooks["model.resolve"](
      Effect.fn("eva.provider.openai.resolve")(function* (event) {
        if (event.reference.provider !== NAMESPACE) return
        const store = yield* ctx.slot.credentialStore.peek
        const credential = store === undefined ? undefined : yield* store.get(NAMESPACE)
        // Resolve either way: `available()` carries whether a credential was
        // found, so the Run reports auth_failed rather than no_such_model.
        event.resolve({
          model: event.reference,
          provider: makeOpenAIProvider({
            ...(credential === undefined ? {} : { credential }),
            ...(maxTokens > 0 ? { maxTokens } : {}),
          }),
        })
      }),
    )
  }),
})

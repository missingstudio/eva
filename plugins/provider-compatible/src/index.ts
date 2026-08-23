import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { endpointOf, readEntries } from "./entry.js"
import { PLUGIN_ID, makeCompatibleProvider } from "./provider.js"

export * from "./entry.js"
export * from "./provider.js"

// One declared key. The endpoint names inside it are the person's own, so
// they are read one level down and never swept.
const OPTIONS = declare({ providers: "mapping" })

/**
 * Any OpenAI-compatible endpoint answers, named in config. This plugin owns
 * the Chat Completions dialect — Ollama, llama.cpp, vLLM, LM Studio and the
 * hosted compatibles all speak it — where `eva.provider.openai` owns the
 * Responses API. The two dialects share nothing on purpose; the wire-agnostic
 * Provider body — the stream drain, the error table, the credential
 * resolution — is the sdk's `streamingProvider`, shared by every provider
 * plugin.
 */
export const providerCompatible = define({
  id: PLUGIN_ID,
  takes: OPTIONS.shapes,
  effect: Effect.fn(PLUGIN_ID)(function* (ctx) {
    const entries = readEntries(OPTIONS.read(ctx.options, "providers", {}))

    yield* ctx.provider["model.resolve"](
      Effect.fn(`${PLUGIN_ID}.resolve`)(function* (event) {
        const entry = entries.find((one) => one.namespace === event.reference.provider)
        if (entry === undefined) return
        const store = yield* ctx.slot.credentialStore.peek
        const found = store === undefined ? undefined : yield* store.get(entry.namespace)
        // Resolve either way: `endpointOf` decides the Credential tri-state,
        // and `available()` carries whether the Credential the entry asked
        // for was found, so the Run reports auth_failed rather than
        // no_such_model.
        event.resolve({
          model: event.reference,
          provider: makeCompatibleProvider(endpointOf(entry, found)),
        })
      }),
    )

    // One provider row per entry and one model row per model the entry
    // names. It writes new rows and never onto another plugin's, so its
    // position among the providers is free. The Catalog never learns an
    // endpoint's models from the endpoint: boot does no network, and a
    // transform replays on every rebuild.
    yield* ctx.catalog.transform((catalog) => {
      for (const entry of entries) {
        catalog.provider.update(entry.namespace, (provider) => {
          provider.name = entry.name
          provider.api = entry.api
        })
        for (const id of entry.models) {
          // The draft fills id and name from the key; a row is the listing
          // `/model` reads, never a gate on what runs.
          catalog.model.update(entry.namespace, id, () => {})
        }
      }
    })
  }),
})

import type { ModelRef } from "@missingstudio/eva-core"
import { define, type ModelInfo } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// Base model data, as the Catalog holds it. The rates are
// `eva.catalog.prices`, which reads a snapshot of what vendors publish and
// writes onto these rows.
export const ANTHROPIC_MODELS: readonly ModelInfo[] = [
  { id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 1_000_000, reasoning: true },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1_000_000, reasoning: true },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", contextWindow: 1_000_000, reasoning: true },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200_000, reasoning: true },
]

// The catalog owns the model data, so it owns the fallback too. The CLI
// reads this one rather than keeping a second copy that can drift.
export const DEFAULT_MODEL: ModelRef = { provider: "anthropic", model: "claude-opus-5" }

export const catalogModels = define({
  id: "eva.catalog.models",
  effect: Effect.fn("eva.catalog.models")(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update("anthropic", (provider) => {
        provider.name = "Anthropic"
        provider.api = "https://api.anthropic.com"
      })
      // The seed is the row, so a field added to `ModelInfo` arrives without
      // a copier here having to learn about it.
      for (const seed of ANTHROPIC_MODELS) {
        catalog.model.update("anthropic", seed.id, (model) => void Object.assign(model, seed))
      }
      if (catalog.model.default.get() === undefined) {
        catalog.model.default.set(DEFAULT_MODEL)
      }
    })
  }),
})

import type { ModelResolution } from "@missingstudio/eva-core"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { providerCompatible } from "./index.js"

const OPTIONS = {
  providers: {
    ollama: {
      api: "http://localhost:11434/v1",
      name: "Ollama",
      models: ["qwen3-coder", "llama4"],
    },
    together: { api: "https://api.together.xyz/v1", credential: true },
  },
}

const resolveThrough = (provider: string, model = "qwen3-coder") =>
  withPlugin(
    providerCompatible,
    (kernel) =>
      Effect.gen(function* () {
        let found: ModelResolution | undefined
        yield* kernel.hooks.run("model.resolve", {
          reference: { provider, model },
          resolve: (resolution) => {
            found = resolution
          },
        })
        return found
      }),
    { options: OPTIONS },
  )

describe("eva.provider.compatible", () => {
  it("writes one provider row per entry, carrying its name and api", async () => {
    const state = await withPlugin(providerCompatible, (kernel) => kernel.domains.catalog.get, {
      options: OPTIONS,
    })

    expect(state.providers.get("ollama")).toEqual({
      id: "ollama",
      name: "Ollama",
      api: "http://localhost:11434/v1",
    })
    expect(state.providers.get("together")).toEqual({
      id: "together",
      name: "together",
      api: "https://api.together.xyz/v1",
    })
  })

  it("writes one model row per model the entry names", async () => {
    const state = await withPlugin(providerCompatible, (kernel) => kernel.domains.catalog.get, {
      options: OPTIONS,
    })

    expect([...(state.models.get("ollama")?.keys() ?? [])]).toEqual(["qwen3-coder", "llama4"])
    expect(state.models.get("together")).toBeUndefined()
  })

  // A transform replays on every rebuild, so one that appended rather than
  // updating would double the rows the second time round.
  it("replays without doubling its rows", async () => {
    const state = await withPlugin(
      providerCompatible,
      (kernel) =>
        Effect.gen(function* () {
          yield* kernel.domains.catalog.reload
          return yield* kernel.domains.catalog.get
        }),
      { options: OPTIONS },
    )

    expect(state.models.get("ollama")?.size).toBe(2)
    expect([...state.providers.keys()]).toEqual(["ollama", "together"])
  })

  // The credentialStore slot is empty here and the entry names no credential:
  // the endpoint needs none, so the provider answers available.
  it("resolves for a configured namespace, available without a credential", async () => {
    const found = await resolveThrough("ollama")

    expect(found?.model).toEqual({ provider: "ollama", model: "qwen3-coder" })
    expect(found?.provider.id).toBe("eva.provider.compatible:ollama")
    expect(found?.provider.available()).toBe(true)
  })

  // The entry asks for a Credential and the slot is empty: resolving anyway
  // is what makes the Run report auth_failed rather than no_such_model.
  it("resolves unavailable when the entry needs a credential nobody has", async () => {
    const found = await resolveThrough("together")

    expect(found?.provider.id).toBe("eva.provider.compatible:together")
    expect(found?.provider.available()).toBe(false)
  })

  it("returns early for a namespace it does not serve", async () => {
    expect(await resolveThrough("anthropic")).toBeUndefined()
  })

  // The model-list degradation stated as a test: the Catalog is a listing,
  // not a gate.
  it("resolves a model reference the Catalog holds no row for", async () => {
    const found = await resolveThrough("ollama", "unlisted-model")

    expect(found?.model).toEqual({ provider: "ollama", model: "unlisted-model" })
  })

  // An entry without api is not an endpoint: it claims no namespace and
  // writes no rows.
  it("claims nothing for an entry with no api", async () => {
    const options = { providers: { broken: { name: "Broken" } } }
    const state = await withPlugin(providerCompatible, (kernel) => kernel.domains.catalog.get, {
      options,
    })
    expect(state.providers.get("broken")).toBeUndefined()

    const found = await withPlugin(
      providerCompatible,
      (kernel) =>
        Effect.gen(function* () {
          let resolved: ModelResolution | undefined
          yield* kernel.hooks.run("model.resolve", {
            reference: { provider: "broken", model: "any" },
            resolve: (resolution) => {
              resolved = resolution
            },
          })
          return resolved
        }),
      { options },
    )
    expect(found).toBeUndefined()
  })
})

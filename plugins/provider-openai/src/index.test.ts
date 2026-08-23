import type { ModelResolution } from "@missingstudio/eva-core"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { providerOpenAI } from "./index.js"

const resolveThrough = (provider: string) =>
  withPlugin(providerOpenAI, (kernel) =>
    Effect.gen(function* () {
      let found: ModelResolution | undefined
      yield* kernel.hooks.run("model.resolve", {
        reference: { provider, model: "gpt-5.6" },
        resolve: (resolution) => {
          found = resolution
        },
      })
      return found
    }),
  )

describe("eva.provider.openai", () => {
  // The credentialStore slot is empty here: resolving anyway is what makes
  // the Run report auth_failed rather than no_such_model.
  it("resolves for openai even with no credential store", async () => {
    const found = await resolveThrough("openai")

    expect(found?.model).toEqual({ provider: "openai", model: "gpt-5.6" })
    expect(found?.provider.id).toBe("eva.provider.openai")
    expect(found?.provider.available()).toBe(false)
  })

  it("returns early for a namespace it does not claim", async () => {
    expect(await resolveThrough("anthropic")).toBeUndefined()
  })
})

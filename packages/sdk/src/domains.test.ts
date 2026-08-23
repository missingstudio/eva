import type { ModelPrice } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import { priceLookup, type CatalogState, type ModelInfo } from "./domains.js"

const price: ModelPrice = { inputTicks: 100, outputTicks: 500 }

const state = (provider: string, id: string): CatalogState => {
  const model: ModelInfo = { id, name: id, price }
  return {
    providers: new Map([[provider, { id: provider, name: provider }]]),
    models: new Map([[provider, new Map([[id, model]])]]),
  }
}

describe("priceLookup", () => {
  // A response names the model it really ran, and that id carries a release
  // date the Catalog's does not. Two vendors write the date two ways.
  it("prices Anthropic's dated id from the undated row", () => {
    const prices = priceLookup(state("anthropic", "claude-opus-5"))

    expect(prices("anthropic/claude-opus-5-20260101")).toEqual(price)
  })

  it("prices OpenAI's dated id from the undated row", () => {
    const prices = priceLookup(state("openai", "gpt-4o-mini"))

    expect(prices("openai/gpt-4o-mini-2024-07-18")).toEqual(price)
  })

  // The fallback strips a date and nothing else: `-mini` is a model, not a
  // release, and stripping it would price one model at another's rate.
  it("does not strip a suffix that is not a date", () => {
    const prices = priceLookup(state("openai", "gpt-4o"))

    expect(prices("openai/gpt-4o-mini")).toBeUndefined()
    expect(prices("openai/gpt-4o-123")).toBeUndefined()
  })

  it("prices the undated id as itself", () => {
    const prices = priceLookup(state("openai", "gpt-4o-mini"))

    expect(prices("openai/gpt-4o-mini")).toEqual(price)
  })

  it("prices nothing for a provider the catalog does not hold", () => {
    const prices = priceLookup(state("openai", "gpt-4o-mini"))

    expect(prices("mistral/gpt-4o-mini")).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"
import { PROVIDER_BOUNDARIES } from "./hooks.js"

/**
 * The four stage-0 hooks decorate a Run; none of them decides whether it
 * proceeds. This holds them there: promoting one to deciding changes what a
 * throw means for every plugin that registered it.
 */
describe("the provider boundaries", () => {
  it("are all observing", () => {
    expect(PROVIDER_BOUNDARIES).toEqual({
      "model.resolve": "observing",
      "provider.request.before": "observing",
      "provider.response.after": "observing",
      "provider.retry": "observing",
    })
  })
})

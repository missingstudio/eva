import { describe, expect, it } from "vitest"
import { PROVIDER_BOUNDARIES, TOOL_BOUNDARIES } from "./hooks.js"

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

/**
 * The gate is the one boundary that decides, and a hook there that throws
 * denies its call. This holds it there: weakening it to observing would make
 * a broken policy plugin fail open, which is not a gate.
 */
describe("the tool boundaries", () => {
  it("decide before a call and observe around it", () => {
    expect(TOOL_BOUNDARIES).toEqual({
      "tool.resolve": "observing",
      "tool.execute.before": "deciding",
      "tool.execute.after": "observing",
    })
  })
})

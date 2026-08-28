import { spendOf, spendText, type CostSummary } from "@missingstudio/eva-schema"
import { describe, expect, it } from "vitest"
import type { PickRow } from "./eva.js"
import { priced } from "./pricing.js"

/**
 * The rate is the Catalog's, and the Catalog reaches this page through the
 * same rows the picker draws. One wire, one table of rates, one answer to what
 * a model costs.
 */

const EMPTY: CostSummary = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
  serverToolTokens: null,
  costTicks: null,
  estimatedCostTicks: null,
}

// $5.00 per million in, $25.00 per million out, in Ticks of 1e-10 USD.
const ROWS: readonly PickRow[] = [
  {
    id: "anthropic/claude-opus-5",
    label: "anthropic/claude-opus-5",
    price: { inputTicks: 50_000_000_000, outputTicks: 250_000_000_000 },
  },
  { id: "openai/gpt-4", label: "openai/gpt-4" },
]

const said = (cost: CostSummary): string => spendText(spendOf(cost, true))

describe("what a Session cost, when nobody reported it", () => {
  it("prices the counters at the Catalog's rate for the model the Session is kept at", () => {
    const counted = { ...EMPTY, inputTokens: 1_000_000, outputTokens: 1_000_000 }

    expect(priced(counted, ROWS, "anthropic/claude-opus-5").estimatedCostTicks).toBe(
      300_000_000_000,
    )
    expect(said(priced(counted, ROWS, "anthropic/claude-opus-5"))).toBe("~$30.00 est")
  })

  /**
   * And says it is an estimate. A figure Eva worked out from a published rate
   * is never shown as one a Provider gave, because reading an estimate as a
   * bill is the mistake the pair exists to prevent.
   */
  it("never writes what it worked out into the figure a Provider reports", () => {
    const priced_ = priced({ ...EMPTY, inputTokens: 1_000_000 }, ROWS, "anthropic/claude-opus-5")

    expect(priced_.costTicks).toBeNull()
    expect(said(priced_)).toContain("est")
  })

  // A Provider that reported is the answer. Pricing over the top of one would
  // be a second answer to a question already settled.
  it("leaves a reported figure alone", () => {
    const reported = { ...EMPTY, costTicks: 13_000_000, inputTokens: 1_000_000 }

    expect(priced(reported, ROWS, "anthropic/claude-opus-5")).toEqual(reported)
    expect(said(priced(reported, ROWS, "anthropic/claude-opus-5"))).toBe("$0.0013")
  })

  // A model the Catalog does not price gets no estimate. Nothing here invents
  // a rate, and a Session may well be kept at a model this build never listed.
  it("prices nothing for a model the Catalog holds no rate for", () => {
    const counted = { ...EMPTY, inputTokens: 1_000_000 }

    expect(priced(counted, ROWS, "openai/gpt-4").estimatedCostTicks).toBeNull()
    expect(said(priced(counted, ROWS, "openai/gpt-4"))).toBe("cost unreported")
  })

  it("prices nothing while the Session has not said which model it is kept at", () => {
    expect(
      priced({ ...EMPTY, inputTokens: 1_000_000 }, ROWS, undefined).estimatedCostTicks,
    ).toBeNull()
  })

  /**
   * Counters nobody reported price to nothing, and nothing is not an estimate
   * of zero — it is the silence the page started with. `~$0.0000 est` would be
   * a figure this page invented out of two absences.
   */
  it("says nothing rather than estimating zero from counters nobody reported", () => {
    expect(priced(EMPTY, ROWS, "anthropic/claude-opus-5")).toEqual(EMPTY)
    expect(said(priced(EMPTY, ROWS, "anthropic/claude-opus-5"))).toBe("cost unreported")
  })

  // Every counter the rate names is priced, so a cached read is not billed at
  // the input rate and reasoning is not billed twice.
  it("prices each counter at its own rate, and a counter with no rate at nothing", () => {
    const rows: readonly PickRow[] = [
      {
        id: "one",
        label: "one",
        price: {
          inputTicks: 10_000_000_000,
          outputTicks: 10_000_000_000,
          cacheReadTicks: 1_000_000_000,
        },
      },
    ]
    const counted = {
      ...EMPTY,
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      // No reasoning rate on this row, so these tokens price at nothing rather
      // than falling back to the output rate.
      reasoningTokens: 1_000_000,
    }

    expect(priced(counted, rows, "one").estimatedCostTicks).toBe(11_000_000_000)
  })
})

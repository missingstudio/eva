import { spendOf, toUsd, type CostSummary, type Spend } from "@missingstudio/eva-schema"

// Counts abbreviate with one decimal at 1k and above, and print exact below.
export const formatCount = (value: number): string =>
  value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`

// Money prints 2 decimals at 1 USD and above, and 4 below.
export const formatCost = (ticks: number): string => {
  const usd = toUsd(ticks)
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(4)}`
}

/**
 * An estimate wears `~` and the word, because a figure Eva worked out is
 * never shown as one a Provider gave: reading an estimate as a bill is the
 * mistake this line exists to prevent. Which of the four to show is the
 * summary's answer, not this one's.
 */
const money = (spend: Spend): string => {
  switch (spend.kind) {
    case "none":
      return "nothing spent yet"
    case "reported":
      return formatCost(spend.ticks)
    case "estimated":
      return `~${formatCost(spend.ticks)} est`
    case "unreported":
      return "cost unreported"
  }
}

/**
 * The cost line. One silent usage record suppresses the whole total, because
 * a partial sum is never shown — silence is not zero, and an unreported cost
 * says so in words rather than printing a number nobody reported.
 *
 * `ran` says whether the Session has done anything. A Session that has not
 * spent is not a Session whose spend nobody reported, and one line for both
 * tells a person their provider is silent when it has simply not been asked.
 */
export const costLine = (summary: CostSummary, ran = true): string => {
  const spend = spendOf(summary, ran)
  // Nothing ran, so there are no counts to stand beside the answer either.
  if (spend.kind === "none") return money(spend)

  const segments: string[] = []
  if (summary.inputTokens !== null) segments.push(`${formatCount(summary.inputTokens)} in`)

  if (summary.outputTokens !== null) segments.push(`${formatCount(summary.outputTokens)} out`)

  const counts = segments.length === 0 ? [] : [segments.join(" / ")]

  return [...counts, money(spend)].join(" · ")
}

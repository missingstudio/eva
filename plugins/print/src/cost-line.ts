import { spendOf, spendText, type CostSummary } from "@missingstudio/eva-schema"

// Counts abbreviate with one decimal at 1k and above, and print exact below.
export const formatCount = (value: number): string =>
  value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`

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
  if (spend.kind === "none") return spendText(spend)

  const segments: string[] = []
  if (summary.inputTokens !== null) segments.push(`${formatCount(summary.inputTokens)} in`)

  if (summary.outputTokens !== null) segments.push(`${formatCount(summary.outputTokens)} out`)

  const counts = segments.length === 0 ? [] : [segments.join(" / ")]

  return [...counts, spendText(spend)].join(" · ")
}

import {
  validityOf,
  verdictFold,
  type Event,
  type Validity,
  type VerdictSummary,
} from "@missingstudio/eva-schema"

// What one vendored trace came to. Both members come from packages/schema's
// one fold, so five callers cannot compute five rates.
export interface Reading {
  readonly summary: VerdictSummary
  readonly validity: Validity
}

export const readingOf = (events: readonly Event[]): Reading => {
  const summary = verdictFold(events)
  return { summary, validity: validityOf(summary) }
}

/**
 * The Repair arithmetic on the one summary: how many first passes failed,
 * and how many of those reached valid. Computed here once, so the number the
 * report prints and the number the gate acts on cannot drift apart.
 */
export const repairsOf = (
  summary: VerdictSummary,
): { readonly failed: number; readonly repaired: number } => ({
  failed: summary.firstPass - summary.firstPassValid,
  repaired: summary.settledValid - summary.firstPassValid,
})

const percent = (valid: number, of: number): string => `${((valid / of) * 100).toFixed(1)}%`

const ratio = (name: string, valid: number, of: number): string =>
  `  ${name} = ${valid}/${of} (${percent(valid, of)})`

/**
 * The lines the measurement prints for one reading. Every figure is a
 * counter from `verdictFold` or a ratio of two of them; nothing is computed
 * anywhere else.
 */
export const said = (name: string, reading: Reading, unproduced = 0): readonly string[] => {
  const { summary, validity } = reading
  const lines: string[] = [`${name}`]
  if (validity.kind === "none") {
    lines.push("  no rate: nothing was judged on a first pass")
  } else {
    lines.push(ratio("first-pass validity ", validity.valid, validity.of))
    lines.push(ratio("post-repair validity", summary.settledValid, summary.firstPass))
    const repairs = repairsOf(summary)
    lines.push(
      repairs.failed === 0
        ? "  repair yield         = no first-pass failure to repair"
        : ratio("repair yield        ", repairs.repaired, repairs.failed),
    )
    lines.push(
      ratio(
        "coverage            ",
        summary.firstPass,
        summary.firstPass + summary.unchecked + summary.held,
      ),
    )
  }
  lines.push(
    `  unchecked ${summary.unchecked}, held ${summary.held}, produced no Candidate ${unproduced}`,
  )
  return lines
}

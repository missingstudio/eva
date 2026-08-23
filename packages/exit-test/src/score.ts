import { readFileSync } from "node:fs"
import {
  decodeLine,
  validityOf,
  verdictFold,
  type Event,
  type Validity,
  type VerdictSummary,
} from "@missingstudio/eva-schema"

// The five canned Workflows, in fixture order. The measurement, the golden
// and its test all read this list, so a sixth Workflow is added in one place.
export const WORKFLOWS = ["commit-msg", "review", "release-notes", "classify", "extract"] as const

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

export const eventsOf = (path: string): readonly Event[] =>
  readFileSync(path, "utf8").split("\n").filter(Boolean).map(decodeLine)

// The exact bytes a golden file holds, so the generator and the test cannot
// drift apart on formatting.
export const writtenOf = (reading: Reading): string => JSON.stringify(reading, null, 2) + "\n"

// The share of Runs that may produce no Candidate before no rate is
// reported at all.
export const NO_CANDIDATE_SHARE = 0.02

/**
 * A Run that produced no Candidate is counted, never dropped: it left both
 * the numerator and the denominator, so past the stated share of the Runs
 * the measurement refuses to report a rate at all.
 */
export const refuses = (unproduced: number, runs: number): boolean =>
  unproduced > runs * NO_CANDIDATE_SHARE

/**
 * The endpoint the measurement is pinned to. The model is pinned in the
 * fixture's config.yaml, but the endpoint cannot be: the provider SDK reads
 * it from the environment, so a shell with `ANTHROPIC_BASE_URL` set sends
 * the Runs somewhere else and the same fixture then scores differently on
 * two machines.
 */
export const ENDPOINT = "https://api.anthropic.com"

/**
 * Whether the environment points the Runs somewhere other than the pinned
 * endpoint. A rate measured against another endpoint is a rate about that
 * endpoint, so the runner says which one it used and refuses an accidental
 * one rather than recording it silently.
 */
export const wrongEndpoint = (ambient: string | undefined, pinned: string): boolean =>
  ambient !== undefined && ambient !== pinned

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
    const failed = summary.firstPass - summary.firstPassValid
    lines.push(
      failed === 0
        ? "  repair yield         = no first-pass failure to repair"
        : ratio("repair yield        ", summary.settledValid - summary.firstPassValid, failed),
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

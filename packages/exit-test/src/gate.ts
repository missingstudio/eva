import { readArchive } from "@missingstudio/eva-core/archive"
import type { Event } from "@missingstudio/eva-schema"
import { readingOf, repairsOf, said } from "./score.js"

// The line, as plan 001 writes it into the roadmap: first-pass validity at
// or above 95% aggregate, repair yield at or above 90%.
export const FIRST_PASS_LINE = 0.95
export const REPAIR_YIELD_LINE = 0.9

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

// One Run of one Workflow, and the trace its process left — a directory
// of per-Session files from a live child, or one vendored file.
export interface TracedRun {
  readonly workflow: string
  readonly path: string
}

// Whichever shape the child left it in — a directory of per-Session files
// from a live run, or one vendored file. The archive read owns the
// difference, so the measurement never asks what it is holding.
const eventsAt = (path: string): readonly Event[] => readArchive(path)

export interface GateReport {
  // The models the Runs actually reported, not the ones config asked for —
  // so a per-Step override shows up in what the commit records.
  readonly models: readonly string[]
  readonly unproduced: number
  // Everything to print: each Workflow's reading, then the aggregate.
  // Empty when the measurement refuses to report a rate at all.
  readonly said: readonly string[]
  // Why the measurement fails. Empty means it passed.
  readonly failed: readonly string[]
}

/**
 * The measurement's deciding half, as one interface a test can assert: the
 * trace read-back, the no-Candidate rule, the refusal share, and the
 * threshold verdict. The runner in scripts/ keeps only the process fan-out —
 * what it prints and what it exits on both come from this one report, so the
 * printed number and the gated number are one value.
 */
export const gate = (runs: readonly TracedRun[]): GateReport => {
  // One trace per process, read back whole. A trace a killed child left
  // unreadable is a Run that produced nothing to judge.
  const byWorkflow = new Map<string, Event[]>()
  const unproduced = new Map<string, number>()
  for (const run of runs) {
    if (!byWorkflow.has(run.workflow)) {
      byWorkflow.set(run.workflow, [])
      unproduced.set(run.workflow, 0)
    }
  }
  for (const run of runs) {
    let events: readonly Event[] = []
    try {
      events = eventsAt(run.path)
    } catch {
      events = []
    }
    if (!events.some((event) => event.payload.kind === "verdict")) {
      unproduced.set(run.workflow, (unproduced.get(run.workflow) ?? 0) + 1)
    }
    byWorkflow.get(run.workflow)?.push(...events)
  }

  const models = new Set<string>()
  for (const events of byWorkflow.values()) {
    for (const event of events) {
      if (event.payload.kind === "usage" && event.payload.model !== undefined) {
        models.add(event.payload.model)
      }
    }
  }

  // A Run that produced no Candidate is counted and reported, never dropped,
  // and past the stated share of the Runs no rate is reported at all.
  const unproducedTotal = [...unproduced.values()].reduce((sum, one) => sum + one, 0)
  if (refuses(unproducedTotal, runs.length)) {
    return {
      models: [...models].sort(),
      unproduced: unproducedTotal,
      said: [],
      failed: [
        `${unproducedTotal} of ${runs.length} Runs produced no Candidate, which is past the ${NO_CANDIDATE_SHARE * 100}% share — no rate is reported`,
      ],
    }
  }

  const lines: string[] = []
  for (const [workflow, events] of byWorkflow) {
    lines.push(...said(workflow, readingOf(events), unproduced.get(workflow)))
  }
  // The aggregate is one fold over every trace together, so it is the same
  // arithmetic as each Workflow's and never a sum of summaries.
  const aggregate = readingOf([...byWorkflow.values()].flat())
  lines.push(...said("aggregate", aggregate, unproducedTotal))

  const failed: string[] = []
  if (aggregate.validity.kind === "none") {
    failed.push("nothing was judged on a first pass — no rate, and that is a failure")
  } else {
    if (aggregate.validity.valid < aggregate.validity.of * FIRST_PASS_LINE) {
      failed.push(`first-pass validity is below ${FIRST_PASS_LINE * 100}%`)
    }
    const repairs = repairsOf(aggregate.summary)
    if (repairs.failed > 0 && repairs.repaired < repairs.failed * REPAIR_YIELD_LINE) {
      failed.push(`repair yield is below ${REPAIR_YIELD_LINE * 100}%`)
    }
  }

  return { models: [...models].sort(), unproduced: unproducedTotal, said: lines, failed }
}

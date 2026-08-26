import { harnessHost, type Kernel } from "@missingstudio/eva-boot"
import type { Approving, Harness, HarnessHost, RunInput, RunResult } from "@missingstudio/eva-core"
import type { Payload, SessionID } from "@missingstudio/eva-schema"
import { Effect, Scope } from "effect"

export interface OpenedRow {
  readonly harness: Harness
  // Every payload the harness emitted to the surface, in order.
  readonly said: () => readonly Payload[]
}

export interface RowOptions {
  /**
   * How a tool call's `ask` is answered. A suite that names none is a build
   * with nobody to answer, which is a denial — the same thing a build with no
   * interactive surface is.
   */
  readonly approving?: Approving
}

/**
 * The named harness row, opened over boot's own `harnessHost` — the same
 * host `SessionAPI.submit` hands one. This is the one spelling of the
 * row-opening dance; a test that opened the row by hand had ten lines to get
 * wrong, and three of them did it three ways.
 */
export const openRow = (
  kernel: Kernel,
  scope: Scope.Scope,
  id: string,
  session: SessionID,
  options: RowOptions = {},
): Effect.Effect<OpenedRow> =>
  Effect.gen(function* () {
    const rows = yield* kernel.domains.harness.get
    const row = rows.find((one) => one.id === id)
    if (row?.open === undefined) throw new Error(`no runnable harness row ${id}`)
    const said: Payload[] = []
    const emit = (payload: Payload) => Effect.sync(() => void said.push(payload))
    const harness = yield* Effect.provideService(
      row.open(harnessHost(kernel, session, emit, options.approving)),
      Scope.Scope,
      scope,
    )
    return { harness, said: () => said }
  })

export interface ScriptedHost {
  readonly host: HarnessHost
  // The interleave log the ordering assertions read.
  readonly calls: readonly string[]
  readonly runs: readonly RunInput[]
  readonly reports: readonly (readonly Payload[])[]
}

/**
 * A `HarnessHost` that answers a written script, one entry per Run. Every
 * call is logged, so a test can assert what ran, what was reported, and in
 * which order. A Run past the script fails rather than repeating the final
 * entry — the same rule as `scripted`, because a silent repeat makes a
 * Repair test pass for the wrong reason.
 */
export const scriptedHost = (script: readonly Partial<RunResult>[] = []): ScriptedHost => {
  const calls: string[] = []
  const runs: RunInput[] = []
  const reports: Payload[][] = []
  let served = 0

  return {
    host: {
      run: (input) =>
        Effect.sync(() => {
          calls.push("run")
          runs.push(input)
          const entry = script[served]
          served += 1
          if (entry === undefined) {
            throw new Error(`the script holds ${script.length} results and this Run is ${served}`)
          }
          return {
            claim: { result: "done", summary: "answered" },
            stopReason: "end_turn",
            degraded: [],
            attempts: 1,
            text: "",
            calls: [],
            ...entry,
          } satisfies RunResult
        }),
      report: (payloads) =>
        Effect.sync(() => {
          calls.push(`report:${payloads.map((one) => one.kind).join("+")}`)
          reports.push([...payloads])
        }),
    },
    calls,
    runs,
    reports,
  }
}

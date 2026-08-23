import type { HarnessHost, ModelRef } from "@missingstudio/eva-core"
import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { scripted, scriptedHost } from "@missingstudio/eva-testkit"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory, type MemorySink } from "@missingstudio/eva-trace-memory"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, harnessHost } from "@missingstudio/eva-boot"

const SESSION = sessionID("sess_host_contract")
const MODEL: ModelRef = { provider: "fake", model: "model" }

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const INVALID: Payload = {
  kind: "verdict",
  step: "draft",
  verdict: "invalid",
  attempt: 1,
  faults: [{ at: "", wanted: "an object" }],
}
const VALID: Payload = { kind: "verdict", step: "draft", verdict: "valid", attempt: 2, faults: [] }

/**
 * One adapter's answer to the seam: the host itself, the committed record
 * reduced to what a Workflow reports through it, and whether the first
 * Verdict stood on the record when the second Run opened — the property that
 * keeps an interrupt from shrinking a measured denominator.
 */
interface Seam {
  readonly host: HarnessHost
  readonly reported: () => readonly Payload[]
  readonly verdictBeforeSecondRun: () => boolean
  readonly close: () => Promise<void>
}

// The fake: testkit's scriptedHost, answering the same script the live
// kernel's Provider streams.
const fakeSeam = (): Promise<Seam> => {
  const watched = scriptedHost([{ text: "not json" }, { text: '{"entries":[]}' }])
  return Promise.resolve({
    host: watched.host,
    reported: () => watched.reports.flat(),
    verdictBeforeSecondRun: () =>
      watched.calls.indexOf("report:verdict") < watched.calls.lastIndexOf("run"),
    close: () => Promise.resolve(),
  })
}

// The real one: boot's harnessHost over a live kernel, with the record
// behind it and a hook counting what stood on it as each request left.
const liveSeam = async (): Promise<Seam> => {
  const fake = scripted([{ payloads: [text("not json")] }, { payloads: [text('{"entries":[]}')] }])
  const scope = await Effect.runPromise(Scope.make())
  const atRequest: number[] = []

  const kernel = await Effect.runPromise(
    boot({
      scope,
      resolved: [{ id: "eva.trace" }, { id: "eva.trace.memory" }, { id: fake.plugin.id }],
      build: buildOf([trace, traceMemory, fake.plugin]),
    }),
  )
  const events = () =>
    Effect.runSync(Effect.map(kernel.slot.traceSink.get, (sink) => (sink as MemorySink).all()))
  let record: readonly Payload[] = []
  const payloads = () => record

  const counting = define({
    id: "test.counting",
    effect: Effect.fn("test.counting")(function* (ctx) {
      yield* ctx.provider["provider.request.before"](() => {
        atRequest.push(events().filter((event) => event.payload.kind === "verdict").length)
      })
    }),
  })
  await Effect.runPromise(kernel.runtime.add(counting))

  return {
    host: harnessHost(kernel, SESSION, () => Effect.void),
    // The record carries the whole Run — started, text, finished — and the
    // contract reads the payloads a Workflow reports through the seam.
    reported: () =>
      payloads().filter(
        (one) => one.kind === "verdict" || one.kind === "started" || one.kind === "finished",
      ),
    verdictBeforeSecondRun: () => atRequest.length === 2 && atRequest[1] === 1,
    close: () => {
      record = events().map((event) => event.payload)
      return Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

const verdicts = (payloads: readonly Payload[]) => payloads.filter((one) => one.kind === "verdict")

/**
 * The contract both HarnessHost adapters answer. The five Repair properties
 * are proved once, against the fake, in plugins/workflow — this is what
 * makes that fake trustworthy: driven through the same seam scenario, boot's
 * real host and the testkit's scripted one answer the same observations.
 */
describe.each([
  ["testkit scriptedHost", fakeSeam],
  ["boot harnessHost", liveSeam],
])("the HarnessHost seam, answered by %s", (_name, make) => {
  it("runs, reports, and holds the Verdict on the record before the next Run", async () => {
    const seam = await make()
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const one = yield* seam.host.run({
          session: SESSION,
          spec: { intent: "draft" },
          model: MODEL,
          history: [],
        })
        yield* seam.host.report([INVALID])
        const two = yield* seam.host.run({
          session: SESSION,
          spec: { intent: "repair" },
          model: MODEL,
          history: [],
        })
        yield* seam.host.report([VALID])
        return { one, two }
      }),
    )
    await seam.close()

    // `run` answers the Run's own result, text included — the Candidate a
    // Workflow's Step judges comes from here.
    expect(found.one.claim.result).toBe("done")
    expect(found.one.text).toBe("not json")
    expect(found.two.text).toBe('{"entries":[]}')

    // `report` commits the group in order, and the first-pass Verdict is on
    // the record before the Repair's Run is paid for.
    expect(verdicts(seam.reported())).toEqual([INVALID, VALID])
    expect(seam.verdictBeforeSecondRun()).toBe(true)
  })

  // The one group that is a Run of its own: the refusal a Harness reports
  // before its first Run, opening with `started` and closing with the
  // failed Claim.
  it("records a started-opening group as a whole Run", async () => {
    const seam = await make()
    const refusal: readonly Payload[] = [
      { kind: "started", intent: "draft" },
      { kind: "finished", claim: { result: "failed", summary: "cannot run" } },
    ]
    await Effect.runPromise(seam.host.report(refusal))
    await seam.close()

    const record = seam.reported()
    expect(record.filter((one) => one.kind === "started")).toHaveLength(1)
    expect(record.at(-1)).toMatchObject({
      kind: "finished",
      claim: { result: "failed", summary: "cannot run" },
    })
  })
})

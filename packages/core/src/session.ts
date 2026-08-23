import type {
  Claim,
  Payload,
  SessionID,
  StopReason,
  TranscriptMessage,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import type { Budget, Recorder } from "./contracts.js"
import type { ModelResolution, ProviderError, ProviderRequest, Retry } from "./provider.js"
import type { ModelRef, Spec } from "./spec.js"

/**
 * Every dependency is an Effect that resolves the current implementation, so
 * `submit` reads a slot at the point of use and never captures it.
 * Replacing the plugin behind one takes effect on the next read.
 */
export interface RunDeps {
  readonly recorder: Effect.Effect<Recorder | undefined>
  readonly resolve: (model: ModelRef) => Effect.Effect<ModelResolution | undefined>
  // The live stream a surface watches. It is never the record.
  readonly emit: (payload: Payload) => Effect.Effect<void>
  // Lets a hook change the request before it goes out.
  readonly beforeRequest?: (request: ProviderRequest) => Effect.Effect<ProviderRequest>
  // Lets a hook change a group of payloads before it commits.
  readonly afterResponse?: (payloads: readonly Payload[]) => Effect.Effect<readonly Payload[]>
  // Decides whether a refused attempt is worth another, and how long to wait.
  readonly retry?: (error: ProviderError, attempt: number) => Effect.Effect<Retry>
  readonly budget?: Effect.Effect<Budget | undefined>
  readonly sleep?: (milliseconds: number) => Effect.Effect<void>
}

export interface RunInput {
  readonly session: SessionID
  readonly spec: Spec
  readonly model: ModelRef
  readonly history: readonly TranscriptMessage[]
  readonly system?: string
}

export interface RunResult {
  readonly claim: Claim
  readonly stopReason?: StopReason
  // The slots that were empty when the Run needed them.
  readonly degraded: readonly string[]
  readonly attempts: number
  /**
   * The `text` payloads this Run produced, joined. A caller that must read the
   * answer takes it from here: it may not read it back from a Trace it is
   * still writing, and a build whose Recorder slot is empty records nothing at
   * all and still answers.
   *
   * A Workflow's Step is one Run, so this is where its Candidate comes from.
   *
   * A retried Run joins every attempt, because every attempt is on the record
   * and a fold of that record joins them the same way.
   */
  readonly text: string
}

const blockOf = (payload: Payload): number | undefined =>
  payload.kind === "text" || payload.kind === "thought" ? payload.block : undefined

/**
 * One Run: open through the Recorder, resolve the model, read one Provider
 * Turn, commit its payloads in block groups, and close with a Claim. A
 * refused attempt becomes a `retry` record inside the same open Run, so the
 * Trace shows every attempt rather than only the one that answered.
 *
 * An empty Recorder slot is a legal state. The Run then records nothing,
 * reports `degraded` naming the slot, and still answers.
 */
export const submit = Effect.fn("core.submit")(function* (deps: RunDeps, input: RunInput) {
  const degraded: string[] = []
  const buffer: Payload[] = []
  const spoken: string[] = []
  let block: number | undefined
  let attempts = 0

  // Buffer before emitting. An interrupt between the two would otherwise
  // show a payload on the stream that the Trace never received.
  const report = Effect.fn("core.report")(function* (payload: Payload) {
    buffer.push(payload)
    if (payload.kind === "text" && payload.content.type === "text")
      spoken.push(payload.content.text)
    yield* deps.emit(payload)
  })

  // A group is the unit a hook may rewrite and the unit that commits, so
  // what a reader sees committed is exactly what the hooks agreed on.
  const flush = Effect.fn("core.flush")(function* () {
    if (buffer.length === 0) return
    const group = buffer.splice(0, buffer.length)
    const settled =
      deps.afterResponse === undefined ? group : [...(yield* deps.afterResponse(group))]

    for (const payload of settled) {
      if (payload.kind !== "usage") continue
      const budget = deps.budget === undefined ? undefined : yield* deps.budget
      if (budget === undefined) continue
      yield* budget.charge({
        model: payload.model ?? `${input.model.provider}/${input.model.model}`,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        cacheReadTokens: payload.cacheReadTokens,
        cacheWriteTokens: payload.cacheWriteTokens,
        ...(payload.costTicks === undefined ? {} : { costTicks: payload.costTicks }),
      })
    }

    const recorder = yield* deps.recorder
    if (recorder === undefined) return
    yield* recorder.commit(settled)
  })

  // The Recorder writes the closing record, so this only streams it and
  // hands the claim over. Two `finished` records would be one too many.
  const close = Effect.fn("core.close")(function* (claim: Claim, stopReason?: StopReason) {
    yield* flush()
    yield* deps.emit(
      stopReason === undefined
        ? { kind: "finished", claim }
        : { kind: "finished", claim, stopReason },
    )
    const recorder = yield* deps.recorder
    if (recorder !== undefined) yield* recorder.close(claim, stopReason)
    return {
      claim,
      ...(stopReason === undefined ? {} : { stopReason }),
      degraded,
      attempts,
      text: spoken.join(""),
    } satisfies RunResult
  })

  const opener = yield* deps.recorder
  if (opener === undefined) {
    degraded.push("Recorder")
  } else {
    yield* opener.open(input.session)
  }

  yield* report({ kind: "started", intent: input.spec.intent })
  if (degraded.length > 0) yield* report({ kind: "degraded", missing: [...degraded] })
  yield* flush()

  const resolution = yield* deps.resolve(input.model)
  if (resolution === undefined) {
    return yield* close({
      result: "failed",
      summary: `no provider answers ${input.model.provider}/${input.model.model}`,
      errorClass: "no_such_model",
    })
  }
  if (!resolution.provider.available()) {
    return yield* close({
      result: "failed",
      summary: `provider ${resolution.provider.id} has no usable credential`,
      errorClass: "auth_failed",
    })
  }

  const requested: ProviderRequest = {
    model: resolution.model,
    messages: input.history,
    ...(input.system === undefined ? {} : { system: input.system }),
  }
  const request =
    deps.beforeRequest === undefined ? requested : yield* deps.beforeRequest(requested)

  const arrival = Effect.fn("core.arrival")(function* (payload: Payload) {
    const next = blockOf(payload)
    if (next === undefined || next !== block) yield* flush()
    block = next
    yield* report(payload)
    if (next === undefined) yield* flush()
  })

  // One attempt, and the decision about whether to make another. A retry is
  // a payload inside the open Run, so the wait is on the record too.
  const attempt = Effect.fn("core.attempt")(function* (): Effect.fn.Return<RunResult | undefined> {
    attempts += 1
    const turn = resolution.provider.turn(request)
    const failure = yield* Stream.runForEach(turn.payloads, arrival).pipe(
      Effect.as(undefined as ProviderError | undefined),
      Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
    )
    // The Run takes the Stop Reason of the turn that closed it. A provider
    // that reported none closes with a Claim and no reason, rather than with
    // an `end_turn` nobody said.
    if (failure === undefined) {
      return yield* close({ result: "done", summary: "answered" }, yield* turn.stopReason)
    }

    const decision =
      deps.retry === undefined
        ? { retry: false, max: attempts, delayMs: 0 }
        : yield* deps.retry(failure, attempts)

    if (!decision.retry) {
      return yield* close({
        result: "failed",
        summary: failure.message,
        errorClass: failure.errorClass,
      })
    }

    yield* report({
      kind: "retry",
      attempt: attempts,
      max: decision.max,
      delayMs: decision.delayMs,
      errorClass: failure.errorClass,
    })
    yield* flush()
    if (deps.sleep !== undefined && decision.delayMs > 0) yield* deps.sleep(decision.delayMs)
    block = undefined
    return undefined
  })

  const attempted = Effect.fn("core.attempted")(function* () {
    for (;;) {
      const finished = yield* attempt()
      if (finished !== undefined) return finished
    }
  })

  // An interrupted Run still closes: the partial work commits and the Run
  // ends `cancelled`, because a Run that never closed cannot be folded.
  return yield* attempted().pipe(
    Effect.onInterrupt(() =>
      close({ result: "failed", summary: "cancelled", errorClass: "other" }, "cancelled").pipe(
        Effect.orDie,
      ),
    ),
  )
})

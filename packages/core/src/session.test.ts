import {
  runID,
  sessionID,
  type Claim,
  type Payload,
  type SessionID,
  type StopReason,
} from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"
import type { Recorder } from "./contracts.js"
import { ProviderError, providerTurn, type ModelResolution, type Provider } from "./provider.js"
import { submit, type RunDeps, type RunInput } from "./session.js"

const input: RunInput = {
  session: sessionID("sess_1"),
  spec: { intent: "say hello" },
  model: { provider: "anthropic", model: "claude-sonnet-4-5" },
  history: [],
}

interface FakeRecorder extends Recorder {
  readonly groups: Payload[][]
  readonly closed: Claim[]
}

const fakeRecorder = (): FakeRecorder => {
  const groups: Payload[][] = []
  const closed: Claim[] = []
  return {
    groups,
    closed,
    open: (session: SessionID) => Effect.sync(() => runID(`run_of_${session}`)),
    commit: (payloads) => Effect.sync(() => void groups.push([...payloads])),
    // Mirrors the real Recorder: closing writes the `finished` record.
    close: (claim, stopReason) =>
      Effect.sync(() => {
        closed.push(claim)
        groups.push([
          stopReason === undefined
            ? { kind: "finished", claim }
            : { kind: "finished", claim, stopReason },
        ])
      }),
  }
}

const text = (value: string, block = 0): Payload => ({
  kind: "text",
  block,
  content: { type: "text", text: value },
})

const usage: Payload = {
  kind: "usage",
  model: "anthropic/claude-sonnet-4-5",
  inputTokens: 10,
  outputTokens: 4,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
}

const fakeProvider = (
  stream: Stream.Stream<Payload, ProviderError>,
  available = true,
  stopReason?: StopReason,
): Provider => ({
  id: "eva.provider.fake",
  available: () => available,
  turn: () => providerTurn(stream, stopReason),
})

const deps = (
  recorder: Recorder | undefined,
  provider: Provider | undefined,
  seen: Payload[] = [],
): RunDeps & { readonly seen: Payload[] } => ({
  seen,
  recorder: Effect.sync(() => recorder),
  resolve: (model) =>
    Effect.sync(() =>
      provider === undefined ? undefined : ({ model, provider } satisfies ModelResolution),
    ),
  emit: (payload) => Effect.sync(() => void seen.push(payload)),
})

const kinds = (payloads: readonly Payload[]) => payloads.map((payload) => payload.kind)

// What the Run said, read off the record the same way `RunResult.text` reads
// it off the stream — so the two cannot drift apart unnoticed.
const spoken = (payloads: readonly Payload[]) =>
  payloads
    .map((payload) =>
      payload.kind === "text" && payload.content.type === "text" ? payload.content.text : "",
    )
    .join("")

describe("submit", () => {
  it("opens, commits the turn, and closes with a Claim", async () => {
    const recorder = fakeRecorder()
    const wiring = deps(recorder, fakeProvider(Stream.fromIterable([text("Hi"), usage])))
    const result = await Effect.runPromise(submit(wiring, input))

    expect(result.claim).toEqual({ result: "done", summary: "answered" })
    expect(recorder.closed).toEqual([result.claim])
    expect(kinds(wiring.seen)).toEqual(["started", "text", "usage", "finished"])
  })

  // The Run has one Stop Reason and the turn that closed it says what it is.
  it("closes with the Stop Reason the Provider Turn reported", async () => {
    const stream = Stream.fromIterable([text("Hi")])
    const wiring = deps(fakeRecorder(), fakeProvider(stream, true, "max_tokens"))
    const result = await Effect.runPromise(submit(wiring, input))

    expect(result.stopReason).toBe("max_tokens")
    expect(wiring.seen.at(-1)).toMatchObject({ kind: "finished", stopReason: "max_tokens" })
  })

  // A reason nobody reported is absent, not `end_turn`. A truncated Run that
  // claimed a clean stop would put a reason in the Trace nobody gave.
  it("closes with no Stop Reason when the Provider Turn reported none", async () => {
    const wiring = deps(fakeRecorder(), fakeProvider(Stream.fromIterable([text("Hi")])))
    const result = await Effect.runPromise(submit(wiring, input))

    expect(result.stopReason).toBeUndefined()
    expect(wiring.seen.at(-1)).toEqual({
      kind: "finished",
      claim: { result: "done", summary: "answered" },
    })
  })

  it("commits one group per content block, and a payload with no block alone", async () => {
    const recorder = fakeRecorder()
    const stream = Stream.fromIterable([
      text("Hel"),
      text("lo."),
      text("Reasoning", 1),
      usage,
      text("More", 2),
    ])
    await Effect.runPromise(submit(deps(recorder, fakeProvider(stream)), input))

    expect(recorder.groups.map(kinds)).toEqual([
      ["started"],
      ["text", "text"],
      ["text"],
      ["usage"],
      ["text"],
      ["finished"],
    ])
  })

  it("runs, reports degraded, and answers when the Recorder slot is empty", async () => {
    const wiring = deps(undefined, fakeProvider(Stream.fromIterable([text("Hi")])))
    const result = await Effect.runPromise(submit(wiring, input))

    expect(result.degraded).toEqual(["Recorder"])
    expect(result.claim.result).toBe("done")
    expect(wiring.seen).toContainEqual({ kind: "degraded", missing: ["Recorder"] })
  })

  it("fails with no_such_model when nothing answers the model reference", async () => {
    const recorder = fakeRecorder()
    const result = await Effect.runPromise(submit(deps(recorder, undefined), input))

    expect(result.claim).toMatchObject({ result: "failed", errorClass: "no_such_model" })
    expect(recorder.closed).toHaveLength(1)
  })

  it("fails with auth_failed when the provider has no usable credential", async () => {
    const provider = fakeProvider(Stream.fromIterable([]), false)
    const result = await Effect.runPromise(submit(deps(fakeRecorder(), provider), input))

    expect(result.claim).toMatchObject({ result: "failed", errorClass: "auth_failed" })
  })

  it("keeps the partial work and the error class when the turn fails midway", async () => {
    const recorder = fakeRecorder()
    const failure = new ProviderError({
      provider: "eva.provider.fake",
      errorClass: "overloaded",
      message: "servers are overloaded",
    })
    const stream = Stream.fromIterable([text("Par")]).pipe(Stream.concat(Stream.fail(failure)))
    const result = await Effect.runPromise(submit(deps(recorder, fakeProvider(stream)), input))

    expect(result.claim).toMatchObject({ result: "failed", errorClass: "overloaded" })
    expect(result.stopReason).toBeUndefined()
    expect(recorder.groups.flatMap(kinds)).toContain("text")
    expect(recorder.groups.flatMap(kinds)).toContain("finished")
  })

  it("answers with every text payload the turn produced, joined in arrival order", async () => {
    const stream = Stream.fromIterable([text("One "), text("two "), text("three"), usage])
    const result = await Effect.runPromise(
      submit(deps(fakeRecorder(), fakeProvider(stream)), input),
    )

    expect(result.text).toBe("One two three")
  })

  // A caller that has to judge the answer reads one field, so a Run that said
  // nothing answers the empty string rather than nothing at all.
  it("answers the empty string when the turn produced no text", async () => {
    const result = await Effect.runPromise(
      submit(deps(fakeRecorder(), fakeProvider(Stream.fromIterable([usage]))), input),
    )

    expect(result.text).toBe("")
  })

  it("answers the empty string when nothing answers the model reference", async () => {
    const result = await Effect.runPromise(submit(deps(fakeRecorder(), undefined), input))

    expect(result.text).toBe("")
    expect(result.claim).toMatchObject({ result: "failed", errorClass: "no_such_model" })
  })

  it("answers the empty string when the provider has no usable credential", async () => {
    const provider = fakeProvider(Stream.fromIterable([text("never sent")]), false)
    const result = await Effect.runPromise(submit(deps(fakeRecorder(), provider), input))

    expect(result.text).toBe("")
    expect(result.claim).toMatchObject({ result: "failed", errorClass: "auth_failed" })
  })

  it("closes cancelled and keeps the partial work when interrupted mid-stream", async () => {
    const recorder = fakeRecorder()
    const program = Effect.gen(function* () {
      const streaming = yield* Deferred.make<void>()
      const stream = Stream.fromIterable([text("Par"), text("tial")]).pipe(
        Stream.concat(Stream.fromEffect(Effect.never)),
      )
      const wiring = deps(recorder, fakeProvider(stream))
      const watched: RunDeps = {
        ...wiring,
        emit: (payload) =>
          wiring
            .emit(payload)
            .pipe(
              Effect.andThen(() =>
                payload.kind === "text" && payload.content.type === "text"
                  ? Deferred.succeed(streaming, undefined)
                  : Effect.void,
              ),
            ),
      }
      const fiber = yield* Effect.forkChild(submit(watched, input))
      yield* Deferred.await(streaming)
      yield* Fiber.interrupt(fiber)
    })
    await Effect.runPromise(program)

    expect(recorder.closed).toEqual([
      { result: "failed", summary: "cancelled", errorClass: "other" },
    ])
    const committed = recorder.groups.flat()
    expect(kinds(committed)).toContain("text")
    expect(committed.at(-1)).toMatchObject({ kind: "finished", stopReason: "cancelled" })

    // The text that arrived is on the record, and it is a prefix of what the
    // provider would have said. `RunResult.text` joins exactly these payloads;
    // an interrupted Run's result reaches no caller, because interruption
    // propagates, so the record is where the partial answer can be read.
    const partial = spoken(committed)
    expect(partial).not.toBe("")
    expect("Partial".startsWith(partial)).toBe(true)
  })
})

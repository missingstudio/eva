import { memorySessionAPI } from "@missingstudio/eva-client-runtime"
import {
  ResumeTooFarBehind,
  WATCH_REPLAY_BOUND,
  type ModelRef,
  type SessionAPI,
} from "@missingstudio/eva-core"
import type { Payload } from "@missingstudio/eva-schema"
import { scripted, withKernel } from "@missingstudio/eva-testkit"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { makeSessionAPI } from "@missingstudio/eva-boot"
import { Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"

/**
 * One suite, both fillers of the Session API seam: the kernel's, which a
 * person really runs against, and the in-memory one every suite that needs a
 * session drives instead.
 *
 * The rule this is here for is the cursor watch — subscribe, then read the
 * record, then drop the overlap on a strict inequality. It was written out
 * three times, twice inside test files, so a change to the kernel's copy left
 * the other two passing against a contract that had moved. A filler that
 * drifts now fails here.
 */

const FAKE_MODEL: ModelRef = { provider: "fake", model: "model" }
const OTHER_MODEL: ModelRef = { provider: "other", model: "other" }

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

/**
 * What each Run says, one entry per Run, in the order they are submitted. The
 * kernel's filler adds a `started` and a `finished` of its own, so no
 * assertion here counts events — it asserts the rules, which are the same on
 * both.
 */
type Script = readonly (readonly Payload[])[]

const CLOSE: Payload = { kind: "finished", claim: { result: "done", summary: "ok" } }

interface Filler {
  readonly name: string
  readonly with: <A>(script: Script, body: (api: SessionAPI) => Effect.Effect<A>) => Promise<A>
}

const kernelFiller: Filler = {
  name: "the kernel's",
  with: (script, body) =>
    withKernel(
      [
        trace,
        traceMemory,
        scripted(script.map((payloads) => ({ payloads: [...payloads] }))).plugin,
      ],
      (kernel, scope) =>
        Effect.flatMap(makeSessionAPI(kernel, FAKE_MODEL, scope), (api) => body(api.session)),
    ),
}

const memoryFiller: Filler = {
  name: "the in-memory one",
  with: (script, body) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // One entry per Run, as the scripted Provider serves one per
          // Provider Turn. A Run past the script says nothing and closes.
          let served = 0
          const memory = yield* memorySessionAPI(
            (_input, say) =>
              Effect.gen(function* () {
                const says = script[served] ?? []
                served += 1
                // One turn of the event loop before the first word, as the
                // kernel's filler takes when it forks the Run.
                yield* Effect.yieldNow
                for (const payload of says) yield* say(payload)
                yield* say(CLOSE)
              }),
            { model: FAKE_MODEL },
          )
          return yield* body(memory.api)
        }),
      ),
    ),
}

const wordsIn = (payloads: readonly Payload[]): string =>
  payloads
    .map((one) => (one.kind === "text" && one.content.type === "text" ? one.content.text : ""))
    .join("")

describe.each([kernelFiller, memoryFiller])("the Session API, filled by $name", (filler) => {
  it("opens a session that folds to nothing, at position zero", async () => {
    const found = await filler.with([], (api) =>
      Effect.gen(function* () {
        const session = yield* api.create("/here")
        const record = yield* Effect.scoped(api.attach(session))
        return { messages: record.messages(), at: record.at, answered: record.answer() }
      }),
    )

    expect(found.messages).toEqual([])
    expect(found.at.seq).toBe(0)
    expect(found.answered).toEqual({ text: "" })
  })

  it("returns from `submit` only once the Run has closed, and the record holds it", async () => {
    const found = await filler.with([[text("an "), text("answer")]], (api) =>
      Effect.gen(function* () {
        const session = yield* api.create("/here")
        yield* api.submit(session, { kind: "prompt", text: "ask" })
        // Nothing waits here: `submit` returning is what says it is over.
        const record = yield* Effect.scoped(api.attach(session))
        return { answered: record.answer(), at: record.at }
      }),
    )

    expect(found.answered.claim?.result).toBe("done")
    expect(found.answered.text).toBe("an answer")
    expect(found.at.seq).toBeGreaterThan(0)
  })

  it("streams the Run live to a watch that carries no cursor", async () => {
    const heard = await filler.with([[text("par"), text("tial")]], (api) =>
      Effect.gen(function* () {
        const session = yield* api.create("/here")
        const seen: Payload[] = []
        const watching = yield* Effect.forkChild(
          Stream.runForEach(
            Stream.takeUntil(api.watch(session), (one) => one.kind === "finished"),
            (one) => Effect.sync(() => void seen.push(one)),
          ),
        )
        yield* api.submit(session, { kind: "prompt", text: "ask" })
        yield* Fiber.await(watching)
        return seen
      }),
    )

    expect(wordsIn(heard)).toBe("partial")
    expect(heard.at(-1)?.kind).toBe("finished")
  })

  /**
   * The rule the copies disagreed about. A watch that resumes from a fold's
   * own position says everything committed after it, once, and then goes on
   * with the record as it grows — so a surface that folded and then subscribed
   * has neither a gap nor a repeat.
   */
  it("replays from a cursor exactly once, then follows the record", async () => {
    const found = await filler.with([[text("first")], [text("second")]], (api) =>
      Effect.gen(function* () {
        const session = yield* api.create("/here")
        yield* api.submit(session, { kind: "prompt", text: "ask" })

        // Fold, then resume from the fold's own position.
        const record = yield* Effect.scoped(api.attach(session))
        const seen: Payload[] = []
        const watching = yield* Effect.forkChild(
          Stream.runForEach(
            Stream.takeUntil(api.watch(session, record.at), (one) => one.kind === "finished"),
            (one) => Effect.sync(() => void seen.push(one)),
          ),
        )
        yield* api.submit(session, { kind: "prompt", text: "again" })
        yield* Fiber.await(watching)

        const after = yield* Effect.scoped(api.attach(session))
        return { seen, whole: after.answer().text }
      }),
    )

    // Only the second Run's words. The first was already folded, and a
    // resumed watch never hands back what the fold already returned.
    expect(wordsIn(found.seen)).toBe("second")
    // The Answer is the Run that closed last, so the first Run is behind it
    // in the record rather than lost from it.
    expect(found.whole).toBe("second")
    // Exactly one close: the second Run's, and not the first's again.
    expect(found.seen.filter((one) => one.kind === "finished")).toHaveLength(1)
  })

  it("replays nothing from a cursor that is already at the head", async () => {
    const seen = await filler.with([[text("said")]], (api) =>
      Effect.gen(function* () {
        const session = yield* api.create("/here")
        yield* api.submit(session, { kind: "prompt", text: "ask" })
        const record = yield* Effect.scoped(api.attach(session))

        const heard: Payload[] = []
        const watching = yield* Effect.forkChild(
          Stream.runForEach(api.watch(session, record.at), (one) =>
            Effect.sync(() => void heard.push(one)),
          ),
        )
        // Long enough for a replay to have arrived if one were coming.
        for (let turn = 0; turn < 50; turn += 1) yield* Effect.yieldNow
        yield* Fiber.interrupt(watching)
        return heard
      }),
    )

    expect(seen).toEqual([])
  })

  it("refuses a cursor further behind than the replay bound, rather than replaying it", async () => {
    const failed = await filler.with([[text("said")]], (api) =>
      Effect.gen(function* () {
        const session = yield* api.create("/here")
        yield* api.submit(session, { kind: "prompt", text: "ask" })
        // A position the head cannot have reached, so the gap is wider than
        // the bound however many events the filler wrote.
        const far = { session, seq: -WATCH_REPLAY_BOUND - 1 }
        return yield* Effect.exit(Stream.runDrain(api.watch(session, far)))
      }),
    )

    expect(failed._tag).toBe("Failure")
    expect(String(failed)).toContain(ResumeTooFarBehind.name)
  })

  it("keeps a model per session, and hands back the one it was set to", async () => {
    const found = await filler.with([], (api) =>
      Effect.gen(function* () {
        const one = yield* api.create("/here")
        const other = yield* api.create("/there")
        yield* api.model.set(one, OTHER_MODEL)
        return { one: yield* api.model.get(one), other: yield* api.model.get(other) }
      }),
    )

    expect(found.one).toEqual(OTHER_MODEL)
    expect(found.other).toEqual(FAKE_MODEL)
  })

  it("folds only the session it was asked for", async () => {
    const found = await filler.with([[text("mine")]], (api) =>
      Effect.gen(function* () {
        const one = yield* api.create("/here")
        const other = yield* api.create("/there")
        yield* api.submit(one, { kind: "prompt", text: "ask" })
        return {
          one: (yield* Effect.scoped(api.attach(one))).answer().text,
          other: (yield* Effect.scoped(api.attach(other))).answer().text,
        }
      }),
    )

    expect(found.one).toBe("mine")
    expect(found.other).toBe("")
  })

  it("drops an answer to a request nobody opened, rather than stopping", async () => {
    const outcome = await filler.with([], (api) =>
      Effect.exit(api.answer("req_nobody_asked", { kind: "cancelled" })),
    )

    expect(outcome._tag).toBe("Success")
  })

  it("lists the sessions it opened", async () => {
    const listed = await filler.with([], (api) =>
      Effect.gen(function* () {
        const one = yield* api.create("/here")
        const other = yield* api.create("/there")
        const rows = yield* api.list
        return { ids: rows.map((row) => row.id), one, other }
      }),
    )

    expect(listed.ids).toContain(listed.one)
    expect(listed.ids).toContain(listed.other)
  })
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { providerTurn, type ModelRef, type Provider } from "@missingstudio/eva-core"
import {
  FAKE_PROVIDER,
  providing,
  scripted,
  withKernel,
  type Scripted,
  type ScriptedTurn,
} from "@missingstudio/eva-testkit"
import type { Payload, TranscriptMessage } from "@missingstudio/eva-schema"
import type { Plugin } from "@missingstudio/eva-sdk"
import { sessionJsonl } from "@missingstudio/eva-session-jsonl"
import { trace } from "@missingstudio/eva-trace"
import { traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { makeSessionAPI, type Api } from "@missingstudio/eva-boot"

// A block change is what makes a Run commit what came before it, so a
// payload's block is what decides where one Run's record is cut.
const inBlock = (index: number, value: string): Payload => ({
  kind: "text",
  block: index,
  content: { type: "text", text: value },
})

const text = (value: string): Payload => inBlock(0, value)

const FAKE_MODEL: ModelRef = { provider: "fake", model: "model" }

// Each turn's answer, in order. The testkit fails a turn past the script,
// so a test that runs more Runs than it wrote answers for fails loudly.
const turns = (...answers: readonly (readonly Payload[])[]): readonly ScriptedTurn[] =>
  answers.map((payloads) => ({ payloads }))

// A kernel with a real trace and session store behind it, so the API is
// exercised against the same slots the CLI fills.
const withProvider = <A>(plugin: Plugin, body: (api: Api) => Effect.Effect<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "eva-api-"))
  return withKernel(
    [trace, { plugin: traceJsonl, options: { dir } }, sessionJsonl, plugin],
    (kernel, scope) => Effect.flatMap(makeSessionAPI(kernel, FAKE_MODEL, scope), body),
  )
}

const withApi = <A>(fake: Scripted, body: (api: Api) => Effect.Effect<A>): Promise<A> =>
  withProvider(fake.plugin, body)

describe("create and list", () => {
  it("opens a Session the store then lists", async () => {
    const found = await withApi(scripted([]), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        return { session, listed: yield* api.session.list }
      }),
    )
    expect(found.listed.map((one) => one.id)).toContain(found.session)
  })
})

describe("submit", () => {
  it("runs a Run and attaches the record it committed", async () => {
    const messages = await withApi(scripted(turns([text("hello")])), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.submit(session, { kind: "prompt", text: "hi" })
        const transcript = yield* api.session.attach(session)
        return transcript.messages()
      }).pipe(Effect.scoped),
    )

    expect(messages.at(-1)?.blocks).toContainEqual({
      type: "content",
      block: 0,
      content: { type: "text", text: "hello" },
    })
  })

  // The second Run must see the first. The history comes from the record,
  // never from what the stream happened to show.
  it("carries the conversation into the next Run", async () => {
    const fake = scripted(turns([text("one")], [text("two")]))
    await withApi(fake, (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.submit(session, { kind: "prompt", text: "first" })
        yield* api.session.submit(session, { kind: "prompt", text: "second" })
      }),
    )

    const seen = fake.seen()
    expect(seen).toHaveLength(2)
    const second = seen[1]?.messages ?? []
    expect(second.length).toBeGreaterThan(seen[0]?.messages.length ?? 0)
  })

  it("prepends steering that arrived between Runs", async () => {
    const fake = scripted(turns([text("ok")]))
    await withApi(fake, (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.submit(session, {
          kind: "steer",
          text: "be brief",
          target: "next-run",
        })
        yield* api.session.submit(session, { kind: "prompt", text: "explain" })
      }),
    )

    const sent = fake.seen()[0]?.messages.at(-1)
    const block = sent?.blocks[0]
    expect(block?.type === "content" && block.content.type === "text" && block.content.text).toBe(
      "be brief\nexplain",
    )
  })

  it("does not carry the same steering into a second Run", async () => {
    const fake = scripted(turns([text("a")], [text("b")]))
    await withApi(fake, (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.submit(session, { kind: "steer", text: "once", target: "next-run" })
        yield* api.session.submit(session, { kind: "prompt", text: "first" })
        yield* api.session.submit(session, { kind: "prompt", text: "second" })
      }),
    )

    const last = fake.seen()[1]?.messages.at(-1)
    const block = last?.blocks[0]
    expect(block?.type === "content" && block.content.type === "text" && block.content.text).toBe(
      "second",
    )
  })
})

describe("watch", () => {
  it("shows the live stream while a Run is open", async () => {
    const streamed = await withApi(scripted(turns([text("streamed")])), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        const collecting = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.takeUntil(api.session.watch(session), (p) => p.kind === "finished"),
          ),
        )
        yield* api.session.submit(session, { kind: "prompt", text: "go" })
        return [...(yield* Fiber.join(collecting))]
      }),
    )

    expect(streamed.some((one) => one.kind === "text")).toBe(true)
    expect(streamed.at(-1)?.kind).toBe("finished")
  })

  // A surface that reconnects with a cursor sees what it missed, then tails.
  it("replays what committed after the cursor", async () => {
    const replayed = await withApi(scripted(turns([text("first run")])), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.submit(session, { kind: "prompt", text: "go" })
        return [
          ...(yield* Stream.runCollect(
            Stream.take(api.session.watch(session, { session, seq: 0 }), 3),
          )),
        ]
        // A cursor of 0 on a fresh session is not behind anything, so the
        // refusal cannot arrive; a defect is the right answer if it does.
      }).pipe(Effect.orDie),
    )

    expect(replayed[0]?.kind).toBe("started")
    expect(replayed.some((one) => one.kind === "text")).toBe(true)
  })

  it("shows nothing already committed when given no cursor", async () => {
    const seen = await withApi(scripted(turns([text("done")], [text("again")])), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.submit(session, { kind: "prompt", text: "go" })
        const collecting = yield* Effect.forkChild(
          Stream.runCollect(Stream.take(api.session.watch(session), 1)),
        )
        yield* api.session.submit(session, { kind: "prompt", text: "again" })
        return [...(yield* Fiber.join(collecting))]
      }),
    )

    expect(seen[0]?.kind).toBe("started")
  })
})

/**
 * A Provider that stops in the middle of one turn. `reached` fires once the
 * turn is parked, and nothing more streams until `release`. Each payload is
 * in its own block, so what came before the park is already committed while
 * the Run is still open — which is what leaves a fold holding part of a Run.
 */
const parked = (reached: Deferred.Deferred<void>, release: Deferred.Deferred<void>): Provider => ({
  id: FAKE_PROVIDER,
  available: () => true,
  turn: () =>
    providerTurn(
      Stream.concat(
        Stream.fromIterable([inBlock(0, "alpha"), inBlock(1, "beta")]),
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(release)
            return Stream.fromIterable([inBlock(2, "gamma")])
          }),
        ),
      ),
      "end_turn",
    ),
})

// What the agent said, as the record holds it.
const recorded = (messages: readonly TranscriptMessage[]): readonly string[] =>
  messages
    .filter((one) => one.author === "agent")
    .flatMap((one) => one.blocks)
    .flatMap((one) =>
      one.type === "content" && one.content.type === "text" ? [one.content.text] : [],
    )

// The same, as a watch delivered it.
const heard = (payloads: readonly Payload[]): readonly string[] =>
  payloads.flatMap((one) =>
    one.kind === "text" && one.content.type === "text" ? [one.content.text] : [],
  )

describe("a fold and the watch that follows it", () => {
  /**
   * The reason `Transcript.at` exists. The Run is parked mid-turn with part
   * of its record already committed, so the fold takes what is there and the
   * watch from the fold's own position takes the rest. Every payload lands on
   * exactly one of the two sides: none missed between them, none repeated
   * across them.
   */
  it("splits one Run between the record and the watch that resumes it", async () => {
    const reached = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())

    const found = await withProvider(providing(parked(reached, release)), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        const running = yield* Effect.forkChild(
          api.session.submit(session, { kind: "prompt", text: "go" }),
        )
        yield* Deferred.await(reached)

        const transcript = yield* api.session.attach(session)
        const watching = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.takeUntil(
              api.session.watch(session, transcript.at),
              (one) => one.kind === "finished",
            ),
          ),
        )

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(running)
        return {
          folded: recorded(transcript.messages()),
          watched: [...(yield* Fiber.join(watching))],
        }
      }).pipe(Effect.scoped, Effect.orDie),
    )

    expect(found.folded).toEqual(["alpha"])
    expect(heard(found.watched)).toEqual(["beta", "gamma"])
    expect(found.watched.at(-1)?.kind).toBe("finished")
  })
})

describe("the session model", () => {
  it("starts at the model the kernel booted with", async () => {
    const model = await withApi(scripted([]), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        return yield* api.session.model.get(session)
      }),
    )
    expect(model).toEqual({ provider: "fake", model: "model" })
  })

  it("sends the Run whatever model was set on the Session", async () => {
    const model = await withApi(scripted(turns([text("x")])), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.model.set(session, { provider: "fake", model: "other" })
        yield* api.session.submit(session, { kind: "prompt", text: "go" })
        return yield* api.session.model.get(session)
      }),
    )

    expect(model).toEqual({ provider: "fake", model: "other" })
  })

  it("keeps one Session's model off another", async () => {
    const models = await withApi(scripted([]), (api) =>
      Effect.gen(function* () {
        const first = yield* api.session.create(process.cwd())
        const second = yield* api.session.create(process.cwd())
        yield* api.session.model.set(first, { provider: "fake", model: "changed" })
        return {
          first: yield* api.session.model.get(first),
          second: yield* api.session.model.get(second),
        }
      }),
    )

    expect(models.first.model).toBe("changed")
    expect(models.second.model).toBe("model")
  })
})

describe("cancel", () => {
  it("passes over a Session with no Run open", async () => {
    await withApi(scripted([]), (api) =>
      Effect.gen(function* () {
        const session = yield* api.session.create(process.cwd())
        yield* api.session.cancel(session, "user")
      }),
    )
  })
})

describe("answer", () => {
  // The request is open from the call, not from when its fiber runs, so an
  // answer that arrives immediately still lands.
  it("closes the request the surface was asked", async () => {
    const given = await withApi(scripted([]), (api) =>
      Effect.gen(function* () {
        const asking = yield* Effect.forkChild(api.request("req_1"))
        yield* api.session.answer("req_1", { kind: "permission", optionId: "allow" })
        return yield* Fiber.join(asking)
      }),
    )
    expect(given).toEqual({ kind: "permission", optionId: "allow" })
  })

  it("leaves a second answer to the same request with nothing to close", async () => {
    const given = await withApi(scripted([]), (api) =>
      Effect.gen(function* () {
        const asking = yield* Effect.forkChild(api.request("req_2"))
        yield* api.session.answer("req_2", { kind: "text", text: "first" })
        yield* api.session.answer("req_2", { kind: "text", text: "second" })
        return yield* Fiber.join(asking)
      }),
    )
    expect(given).toEqual({ kind: "text", text: "first" })
  })

  // A reconnecting surface may replay an answer nobody is waiting for.
  it("drops an answer to a request that was never opened", async () => {
    await withApi(scripted([]), (api) => api.session.answer("req_absent", { kind: "cancelled" }))
  })
})

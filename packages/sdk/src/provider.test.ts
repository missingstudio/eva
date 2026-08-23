import { CredentialError, type Credential, type ProviderRequest } from "@missingstudio/eva-core"
import type { Payload, TranscriptMessage } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  chatMessages,
  classifyWire,
  missingCredential,
  reported,
  secretOf,
  streamingProvider,
  type TurnEmitter,
} from "./provider.js"

const human = (text: string): TranscriptMessage => ({
  author: "human",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

const agent = (text: string): TranscriptMessage => ({
  author: "agent",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

describe("chatMessages", () => {
  it("names the human user and everything else assistant", () => {
    expect(chatMessages([human("ask"), agent("answer")])).toEqual([
      { role: "user", content: "ask" },
      { role: "assistant", content: "answer" },
    ])
  })

  it("joins the blocks of one message into one content string", () => {
    const split: TranscriptMessage = {
      author: "agent",
      blocks: [
        { type: "content", block: 0, content: { type: "text", text: "one " } },
        { type: "content", block: 1, content: { type: "text", text: "two" } },
      ],
    }
    expect(chatMessages([split])[0]?.content).toBe("one two")
  })

  it("keeps a thought block, because it is what the model said", () => {
    const thought: TranscriptMessage = {
      author: "agent",
      blocks: [{ type: "thought", block: 0, content: { type: "text", text: "thinking" } }],
    }
    expect(chatMessages([thought])[0]?.content).toBe("thinking")
  })

  // Every chat wire refuses an empty content string, so a message with
  // nothing to say must not be sent at all.
  it("drops a message with no text", () => {
    const empty: TranscriptMessage = { author: "agent", blocks: [] }
    expect(chatMessages([human("ask"), empty])).toHaveLength(1)
  })
})

describe("classifyWire", () => {
  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [404, "no_such_model"],
    [429, "rate_limit"],
    [529, "overloaded"],
    [500, "server_error"],
    [503, "server_error"],
  ])("reads status %i as %s", (status, expected) => {
    expect(classifyWire({ status })).toBe(expected)
  })

  it("reads a connection failure as unreachable", () => {
    expect(classifyWire({ connection: true })).toBe("unreachable")
  })

  // The vendor's own marker outranks the status: a dead account arrives as
  // HTTP 429, and the status alone would classify it rate_limit — which the
  // retry policy retries three times.
  it("reads the vendor's billing marker as billing whatever the status", () => {
    expect(classifyWire({ status: 429, billing: true })).toBe("billing")
    expect(classifyWire({ status: 400, billing: true })).toBe("billing")
  })

  // Every failure carries a class. An unclassified one would be a gap.
  it("reads anything else as other", () => {
    expect(classifyWire(undefined)).toBe("other")
    expect(classifyWire({ status: 400 })).toBe("other")
    expect(classifyWire({})).toBe("other")
  })
})

describe("reported", () => {
  it("keeps a counter and reports silence as null, never zero", () => {
    expect(reported(7)).toBe(7)
    expect(reported(0)).toBe(0)
    expect(reported(null)).toBeNull()
    expect(reported(undefined)).toBeNull()
  })
})

describe("the credential helpers", () => {
  it("says a missing credential as this provider's auth_failed", () => {
    const error = missingCredential("eva.provider.example", "example")
    expect(error).toMatchObject({
      provider: "eva.provider.example",
      errorClass: "auth_failed",
      message: "no credential for example",
    })
  })

  it("passes the secret through and classifies its failure auth_failed", async () => {
    const key: Credential = { mode: "api_key", secret: () => Effect.succeed("sk-test") }
    expect(await Effect.runPromise(secretOf(key, "eva.provider.example"))).toBe("sk-test")

    const expired: Credential = {
      mode: "oauth",
      secret: () =>
        Effect.fail(new CredentialError({ id: "example", reason: "expired", message: "expired" })),
    }
    const failed = await Effect.runPromise(Effect.flip(secretOf(expired, "eva.provider.example")))
    expect(failed).toMatchObject({ provider: "eva.provider.example", errorClass: "auth_failed" })
  })
})

const textPayload = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const request: ProviderRequest = {
  model: { provider: "fake", model: "model" },
  messages: [human("hi")],
}

interface Scripted {
  readonly emit: (emit: TurnEmitter) => void
}

const provider = (
  script: Scripted,
  aborts?: () => void,
  clientFor?: () => Effect.Effect<string, never>,
) =>
  streamingProvider<string>({
    id: "eva.provider.example",
    available: () => true,
    clientFor: clientFor ?? (() => Effect.succeed("client")),
    classify: () => "rate_limit",
    start: (_client, _request, emit) => {
      // Settled on the microtask queue, the way a vendor SDK settles.
      queueMicrotask(() => script.emit(emit))
      return { abort: aborts ?? (() => {}) }
    },
  })

describe("streamingProvider", () => {
  it("relays the payloads and answers the reason once the stream drains", async () => {
    const turn = provider({
      emit: (emit) => {
        emit.payload(textPayload("hel"))
        emit.payload(textPayload("lo"))
        emit.end("max_tokens")
      },
    }).turn(request)

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const payloads = [...(yield* Stream.runCollect(turn.payloads))]
        return { payloads, reason: yield* turn.stopReason }
      }),
    )

    expect(found.payloads).toEqual([textPayload("hel"), textPayload("lo")])
    expect(found.reason).toBe("max_tokens")
  })

  it("fails with a ProviderError carrying the dialect's class", async () => {
    const turn = provider({ emit: (emit) => emit.fail(new Error("slow down")) }).turn(request)
    const found = await Effect.runPromise(
      Stream.runCollect(turn.payloads).pipe(
        Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
      ),
    )

    expect(found).toMatchObject({
      _tag: "ProviderError",
      provider: "eva.provider.example",
      errorClass: "rate_limit",
      message: "slow down",
    })
  })

  // A wire can end two ways — an in-band failure event and a terminal
  // promise — so the first to settle wins and the other returns.
  it("ignores an end after a fail has settled the stream", async () => {
    const turn = provider({
      emit: (emit) => {
        emit.fail(new Error("boom"))
        emit.end("end_turn")
      },
    }).turn(request)

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const outcome = yield* Effect.exit(Stream.runCollect(turn.payloads))
        return { outcome, reason: yield* turn.stopReason }
      }),
    )

    expect(found.outcome._tag).toBe("Failure")
    expect(found.reason).toBeUndefined()
  })

  it("aborts the vendor stream when the turn's scope closes", async () => {
    let aborted = 0
    const turn = provider({ emit: (emit) => emit.end(undefined) }, () => {
      aborted += 1
    }).turn(request)

    await Effect.runPromise(Stream.runDrain(turn.payloads))
    expect(aborted).toBe(1)
  })

  it("fails before the wire when the client cannot be built", async () => {
    const turn = streamingProvider<string>({
      id: "eva.provider.example",
      available: () => false,
      clientFor: () => Effect.fail(missingCredential("eva.provider.example", "example")),
      classify: () => "other",
      start: () => {
        throw new Error("the wire was reached")
      },
    }).turn(request)

    const found = await Effect.runPromise(
      Stream.runCollect(turn.payloads).pipe(
        Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
      ),
    )

    expect(found).toMatchObject({ errorClass: "auth_failed" })
  })
})

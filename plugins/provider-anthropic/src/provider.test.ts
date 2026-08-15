import Anthropic from "@anthropic-ai/sdk"
import type { Credential, ProviderRequest } from "@missingstudio/eva-core"
import type { Payload, TranscriptMessage } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { classify, makeAnthropicProvider, toMessages, toStopReason } from "./provider.js"

const key: Credential = { mode: "api_key", secret: () => Effect.succeed("sk-test") }

const human = (text: string): TranscriptMessage => ({
  author: "human",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

const agent = (text: string): TranscriptMessage => ({
  author: "agent",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

describe("toMessages", () => {
  it("names the human user and everything else assistant", () => {
    expect(toMessages([human("ask"), agent("answer")])).toEqual([
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
    expect(toMessages([split])[0]?.content).toBe("one two")
  })

  it("keeps a thought block, because it is what the model said", () => {
    const thought: TranscriptMessage = {
      author: "agent",
      blocks: [{ type: "thought", block: 0, content: { type: "text", text: "thinking" } }],
    }
    expect(toMessages([thought])[0]?.content).toBe("thinking")
  })

  // The API refuses an empty content string, so a message with nothing to
  // say must not be sent at all.
  it("drops a message with no text", () => {
    const empty: TranscriptMessage = { author: "agent", blocks: [] }
    expect(toMessages([human("ask"), empty])).toHaveLength(1)
  })
})

describe("classify", () => {
  const api = (status: number, type?: string) => {
    const error = Object.create(Anthropic.APIError.prototype) as {
      status: number
      type?: string
    }
    error.status = status
    if (type !== undefined) error.type = type
    return error
  }

  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [404, "no_such_model"],
    [429, "rate_limit"],
    [529, "overloaded"],
    [500, "server_error"],
    [503, "server_error"],
  ])("reads status %i as %s", (status, expected) => {
    expect(classify(api(status))).toBe(expected)
  })

  it("reads a billing error as billing whatever the status", () => {
    expect(classify(api(400, "billing_error"))).toBe("billing")
  })

  it("reads a connection failure as unreachable", () => {
    expect(classify(new Anthropic.APIConnectionError({ message: "no route" }))).toBe("unreachable")
  })

  // Every failure carries a class. An unclassified one would be a gap.
  it("reads anything else as other", () => {
    expect(classify(new Error("who knows"))).toBe("other")
    expect(classify(api(400))).toBe("other")
    expect(classify(undefined)).toBe("other")
  })
})

describe("toStopReason", () => {
  it.each([
    ["max_tokens", "max_tokens"],
    ["refusal", "refusal"],
    ["end_turn", "end_turn"],
    ["stop_sequence", "end_turn"],
    ["tool_use", "end_turn"],
  ])("reads %s as %s", (reason, expected) => {
    expect(toStopReason(reason)).toBe(expected)
  })

  // Silence is not `end_turn`. A Run that reports one nobody gave puts a
  // clean stop in the Trace for a turn that may have been cut short.
  it("reports no reason when the message named none", () => {
    expect(toStopReason(null)).toBeUndefined()
    expect(toStopReason(undefined)).toBeUndefined()
  })
})

describe("availability", () => {
  // Without this the Run reports no_such_model, which sends a reader looking
  // for a model that is there.
  it("is false when no credential resolved, and the provider still answers", () => {
    const provider = makeAnthropicProvider({})
    expect(provider.available()).toBe(false)
    expect(provider.id).toBe("eva.provider.anthropic")
  })

  it("is true once a credential is given", () => {
    expect(makeAnthropicProvider({ credential: key }).available()).toBe(true)
  })

  it("is true for an injected client, whatever the credential", () => {
    const client = new Anthropic({ apiKey: "sk-injected" })
    expect(makeAnthropicProvider({ client }).available()).toBe(true)
  })
})

// A fake stream standing for the SDK's: it emits deltas, then settles.
const fakeClient = (deltas: readonly unknown[], settle: (ok: boolean) => unknown): Anthropic => {
  const handlers: ((event: unknown) => void)[] = []
  const stream = {
    on: (_name: string, handler: (event: unknown) => void) => {
      handlers.push(handler)
      return stream
    },
    finalMessage: () =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          for (const event of deltas) for (const handler of handlers) handler(event)
          const settled = settle(true)
          if (settled instanceof Error) reject(settled)
          else resolve(settled)
        }, 0)
      }),
    abort: () => {},
  }
  return { messages: { stream: () => stream } } as unknown as Anthropic
}

const message = (over: Record<string, unknown> = {}) => ({
  model: "claude-opus-5",
  usage: {
    input_tokens: 10,
    output_tokens: 4,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: 0,
  },
  ...over,
})

const request: ProviderRequest = {
  model: { provider: "anthropic", model: "claude-opus-5" },
  messages: [human("hi")],
}

const collect = (client: Anthropic) =>
  Effect.runPromise(
    Stream.runCollect(
      makeAnthropicProvider({ credential: key, client }).turn(request).payloads,
    ).pipe(
      Effect.map((chunk) => [...chunk] as readonly Payload[]),
      Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
    ),
  )

// The stop reason, read the way a Run reads it: once the stream has drained.
const reasonAfterDraining = (client: Anthropic) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const turn = makeAnthropicProvider({ credential: key, client }).turn(request)
      yield* Stream.runDrain(turn.payloads)
      return yield* turn.stopReason
    }),
  )

describe("a turn", () => {
  it("reports a text delta as a text payload on its own block", async () => {
    const found = await collect(
      fakeClient(
        [
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hel" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
        ],
        () => message(),
      ),
    )

    expect(found).toContainEqual({
      kind: "text",
      block: 0,
      content: { type: "text", text: "hel" },
    })
  })

  it("reports a thinking delta as a thought, not as text", async () => {
    const found = await collect(
      fakeClient(
        [
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "thinking_delta", thinking: "hmm" },
          },
        ],
        () => message(),
      ),
    )

    expect(found).toContainEqual({
      kind: "thought",
      block: 1,
      content: { type: "text", text: "hmm" },
    })
  })

  it("passes over an event that is not a content delta", async () => {
    const found = await collect(
      fakeClient([{ type: "message_start" }, { type: "content_block_stop", index: 0 }], () =>
        message(),
      ),
    )

    expect((found as readonly Payload[]).every((one) => one.kind === "usage")).toBe(true)
  })

  // A delta is content. The union has no kind for a signature or for
  // streamed tool arguments yet, and a Trace that dropped them would answer
  // a later question with a gap it never recorded.
  it("preserves a content delta it has no kind for rather than dropping it", async () => {
    const signature = {
      type: "content_block_delta",
      index: 1,
      delta: { type: "signature_delta", signature: "abc" },
    }
    const found = (await collect(fakeClient([signature], () => message()))) as readonly Payload[]

    expect(found).toContainEqual({
      kind: "unknown",
      originalKind: "signature_delta",
      raw: signature,
    })
  })

  // Silence is not zero: a counter the provider did not report stays null,
  // and no cost is invented from the token counts.
  it("reports the counters it was given and null for the rest", async () => {
    const found = (await collect(fakeClient([], () => message()))) as readonly Payload[]
    const usage = found.find((one) => one.kind === "usage")

    expect(usage).toEqual({
      kind: "usage",
      model: "anthropic/claude-opus-5",
      inputTokens: 10,
      outputTokens: 4,
      cacheWriteTokens: null,
      cacheReadTokens: 0,
    })
  })

  it("reports a missing counter as null rather than zero", async () => {
    const found = (await collect(
      fakeClient([], () =>
        message({
          usage: {
            input_tokens: null,
            output_tokens: 7,
            cache_creation_input_tokens: undefined,
            cache_read_input_tokens: null,
          },
        }),
      ),
    )) as readonly Payload[]

    expect(found.find((one) => one.kind === "usage")).toMatchObject({
      inputTokens: null,
      outputTokens: 7,
      cacheWriteTokens: null,
      cacheReadTokens: null,
    })
  })

  it("names the model the response reported, not the one that was asked for", async () => {
    const found = (await collect(
      fakeClient([], () => message({ model: "claude-opus-5-20260101" })),
    )) as readonly Payload[]

    expect(found.find((one) => one.kind === "usage")).toMatchObject({
      model: "anthropic/claude-opus-5-20260101",
    })
  })

  it("reports the stop reason the message carried", async () => {
    const reason = await reasonAfterDraining(
      fakeClient([], () => message({ stop_reason: "max_tokens" })),
    )
    expect(reason).toBe("max_tokens")
  })

  it("reports no stop reason when the message named none", async () => {
    const reason = await reasonAfterDraining(fakeClient([], () => message({ stop_reason: null })))
    expect(reason).toBeUndefined()
  })

  it("fails with a classified ProviderError when the request is refused", async () => {
    const refused = Object.create(Anthropic.APIError.prototype) as {
      status: number
      message: string
    }
    refused.status = 429
    refused.message = "slow down"

    const found = await collect(fakeClient([], () => refused))

    expect(found).toMatchObject({
      _tag: "ProviderError",
      provider: "eva.provider.anthropic",
      errorClass: "rate_limit",
      message: "slow down",
    })
  })
})

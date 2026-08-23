import type { Credential, ProviderRequest } from "@missingstudio/eva-core"
import {
  costFold,
  eventID,
  runID,
  sessionID,
  type Event,
  type Payload,
  type TranscriptMessage,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import OpenAI from "openai"
import { describe, expect, it } from "vitest"
import {
  classify,
  makeCompatibleProvider,
  makeBlocks,
  toMessages,
  toStopReason,
  toUsage,
} from "./provider.js"

const key: Credential = { mode: "api_key", secret: () => Effect.succeed("sk-test") }

const options = {
  id: "eva.provider.compatible:ollama",
  namespace: "ollama",
  api: "http://localhost:11434/v1",
}

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

  it("drops a message with no text", () => {
    const empty: TranscriptMessage = { author: "agent", blocks: [] }
    expect(toMessages([human("ask"), empty])).toHaveLength(1)
  })
})

describe("classify", () => {
  const api = (status: number, code?: string) => {
    const error = Object.create(OpenAI.APIError.prototype) as {
      status: number
      code?: string
    }
    error.status = status
    if (code !== undefined) error.code = code
    return error
  }

  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [404, "no_such_model"],
    [429, "rate_limit"],
    [500, "server_error"],
    [503, "server_error"],
  ])("reads status %i as %s", (status, expected) => {
    expect(classify(api(status))).toBe(expected)
  })

  // A dead account arrives as HTTP 429, and reading the status alone would
  // classify it as rate_limit — which the retry policy retries three times.
  it("reads a 429 carrying insufficient_quota as billing, not rate_limit", () => {
    expect(classify(api(429, "insufficient_quota"))).toBe("billing")
  })

  it("reads a connection failure as unreachable", () => {
    expect(classify(new OpenAI.APIConnectionError({ message: "no route" }))).toBe("unreachable")
  })

  // A prompt that does not fit a small local model's context returns 400,
  // and no Error Class fits. It lands in other with the server's own message.
  it("reads a 400 as other, context overflow included", () => {
    expect(classify(api(400, "context_length_exceeded"))).toBe("other")
  })

  it("reads anything else as other", () => {
    expect(classify(new Error("who knows"))).toBe("other")
  })
})

describe("toStopReason", () => {
  it("answers end_turn for stop", () => {
    expect(toStopReason("stop")).toBe("end_turn")
  })

  it("answers max_tokens for length", () => {
    expect(toStopReason("length")).toBe("max_tokens")
  })

  // Chat Completions puts the filter in finish_reason, the provider's own
  // statement about why it stopped — unlike the Responses API, where the
  // word would be Eva's guess.
  it("answers refusal for content_filter", () => {
    expect(toStopReason("content_filter")).toBe("refusal")
  })

  // Silence is not end_turn.
  it("answers nothing when nobody reported one", () => {
    expect(toStopReason(undefined)).toBeUndefined()
    expect(toStopReason(null)).toBeUndefined()
  })

  it("answers nothing for a reason it has no member for", () => {
    expect(toStopReason("tool_calls")).toBeUndefined()
  })
})

describe("toUsage", () => {
  // The cached count is a subset of prompt_tokens. Reporting it beside the
  // whole input count charges cached tokens twice at two rates.
  it("subtracts the cached count from the input count, as arithmetic", () => {
    const found = toUsage("ollama", "qwen3-coder", {
      prompt_tokens: 2006,
      completion_tokens: 450,
      prompt_tokens_details: { cached_tokens: 1920 },
    })

    expect(found).toEqual({
      kind: "usage",
      model: "ollama/qwen3-coder",
      inputTokens: 86,
      outputTokens: 450,
      cacheWriteTokens: null,
      cacheReadTokens: 1920,
      reasoningTokens: null,
    })
  })

  it("reports reasoning tokens the details name", () => {
    const found = toUsage("ollama", "qwen3-coder", {
      prompt_tokens: 10,
      completion_tokens: 500,
      completion_tokens_details: { reasoning_tokens: 400 },
    })

    expect(found.outputTokens).toBe(500)
    expect(found.reasoningTokens).toBe(400)
  })

  // Silence is not zero: a counter the provider did not report stays null.
  it("reports every counter null when nothing was reported", () => {
    expect(toUsage("ollama", "qwen3-coder", undefined)).toEqual({
      kind: "usage",
      model: "ollama/qwen3-coder",
      inputTokens: null,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
  })

  it("never sets costTicks", () => {
    expect(
      "costTicks" in toUsage("ollama", "qwen3-coder", { prompt_tokens: 1, completion_tokens: 1 }),
    ).toBe(false)
  })
})

describe("makeBlocks", () => {
  // The block number counts runs of one delta kind, starting at 0 and rising
  // whenever the kind changes: one number for both would put a thought and an
  // answer in one commit group.
  it("keeps one run of one kind on one block", () => {
    const runs = makeBlocks()
    expect(runs("content")).toBe(0)
    expect(runs("content")).toBe(0)
  })

  it("moves to the next block when the kind changes", () => {
    const runs = makeBlocks()
    expect(runs("reasoning_content")).toBe(0)
    expect(runs("reasoning_content")).toBe(0)
    expect(runs("content")).toBe(1)
  })

  it("counts a return to an earlier kind as a new run", () => {
    const runs = makeBlocks()
    expect(runs("content")).toBe(0)
    expect(runs("reasoning_content")).toBe(1)
    expect(runs("content")).toBe(2)
  })

  it("starts again per Provider Turn", () => {
    makeBlocks()("content")
    expect(makeBlocks()("reasoning_content")).toBe(0)
  })
})

describe("availability", () => {
  // The entry has no credential field: the endpoint needs none, and the
  // resolve happens.
  it("is true for an entry that needs no credential", () => {
    const provider = makeCompatibleProvider(options)
    expect(provider.available()).toBe(true)
    expect(provider.id).toBe("eva.provider.compatible:ollama")
  })

  it("is true when a named Credential resolved", () => {
    expect(makeCompatibleProvider({ ...options, credential: key }).available()).toBe(true)
  })

  // The false case is what makes the Run close auth_failed rather than
  // reaching the wire.
  it("is false when the entry needs one and the store answered nothing", () => {
    expect(makeCompatibleProvider({ ...options, credential: false }).available()).toBe(false)
  })
})

// A fake standing for the SDK's raw chunk stream: `create` answers an async
// iterable of canned chunks, and remembers the request body it was given.
const fakeClient = (chunks: readonly unknown[], taken?: (params: unknown) => void): OpenAI =>
  ({
    chat: {
      completions: {
        create: (params: unknown) => {
          taken?.(params)
          return Promise.resolve({
            // eslint-disable-next-line @typescript-eslint/require-await
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) yield chunk
            },
          })
        },
      },
    },
  }) as unknown as OpenAI

const failingClient = (cause: unknown): OpenAI =>
  ({
    chat: { completions: { create: () => Promise.reject(cause) } },
  }) as unknown as OpenAI

const delta = (fields: Record<string, unknown>) => ({
  id: "chatcmpl-1",
  model: "qwen3-coder",
  choices: [{ index: 0, delta: fields, finish_reason: null }],
})

const finish = (reason: string | null, usage?: Record<string, unknown>) => ({
  id: "chatcmpl-1",
  model: "qwen3-coder",
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
  ...(usage === undefined ? {} : { usage }),
})

const request: ProviderRequest = {
  model: { provider: "ollama", model: "qwen3-coder" },
  messages: [human("hi")],
}

const collect = (client: OpenAI) =>
  Effect.runPromise(
    Stream.runCollect(makeCompatibleProvider({ ...options, client }).turn(request).payloads).pipe(
      Effect.map((chunk) => [...chunk] as readonly Payload[]),
      Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
    ),
  )

// The stop reason, read the way a Run reads it: once the stream has drained.
const reasonAfterDraining = (client: OpenAI) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const turn = makeCompatibleProvider({ ...options, client }).turn(request)
      yield* Stream.runDrain(turn.payloads)
      return yield* turn.stopReason
    }),
  )

describe("a turn", () => {
  it("reports a content delta as text on block 0", async () => {
    const found = await collect(
      fakeClient([delta({ content: "hel" }), delta({ content: "lo" }), finish("stop")]),
    )

    expect(found).toContainEqual({ kind: "text", block: 0, content: { type: "text", text: "hel" } })
    expect(found).toContainEqual({ kind: "text", block: 0, content: { type: "text", text: "lo" } })
  })

  // This pins the block-run rule: a reasoning run then a content run is
  // block 0 then block 1, the flush core wants between a thought and an
  // answer.
  it("reports a reasoning run then a content run as block 0 then block 1", async () => {
    const found = await collect(
      fakeClient([
        delta({ reasoning_content: "hmm" }),
        delta({ reasoning_content: " more" }),
        delta({ content: "hi" }),
        finish("stop"),
      ]),
    )

    expect(found).toContainEqual({
      kind: "thought",
      block: 0,
      content: { type: "text", text: "hmm" },
    })
    expect(found).toContainEqual({
      kind: "thought",
      block: 0,
      content: { type: "text", text: " more" },
    })
    expect(found).toContainEqual({ kind: "text", block: 1, content: { type: "text", text: "hi" } })
  })

  // A delta is content the model produced. One the union has no kind for is
  // preserved rather than dropped, so framing is dropped and content is not.
  it("preserves a delta it has no kind for rather than dropping it", async () => {
    const args = delta({ tool_calls: [{ index: 0, function: { arguments: "{" } }] })
    const found = (await collect(fakeClient([args, finish("stop")]))) as readonly Payload[]

    expect(found).toContainEqual({ kind: "unknown", originalKind: "tool_calls", raw: args })
  })

  it("passes over the role framing and an empty content string", async () => {
    const found = (await collect(
      fakeClient([delta({ role: "assistant", content: "" }), finish("stop")]),
    )) as readonly Payload[]

    expect(found.every((one) => one.kind === "usage")).toBe(true)
  })

  it("closes the stream with the usage payload, subtraction included", async () => {
    const found = (await collect(
      fakeClient([
        delta({ content: "hi" }),
        finish("stop", {
          prompt_tokens: 2006,
          completion_tokens: 450,
          prompt_tokens_details: { cached_tokens: 1920 },
        }),
      ]),
    )) as readonly Payload[]

    expect(found.at(-1)).toEqual({
      kind: "usage",
      model: "ollama/qwen3-coder",
      inputTokens: 86,
      outputTokens: 450,
      cacheWriteTokens: null,
      cacheReadTokens: 1920,
      reasoningTokens: null,
    })
  })

  // Usage silence: an endpoint that sends no usage object still produces one
  // usage payload naming the model, and costFold answers null rather than a
  // partial figure.
  it("reports one null-counter usage payload when the endpoint sent none", async () => {
    const found = (await collect(
      fakeClient([delta({ content: "hi" }), finish("stop")]),
    )) as readonly Payload[]

    const usage = found.at(-1)
    expect(usage).toEqual({
      kind: "usage",
      model: "ollama/qwen3-coder",
      inputTokens: null,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })

    const event: Event = {
      id: eventID("evt_1"),
      seq: 1,
      at: { wall: "2026-08-23T09:00:00Z" },
      run: runID("run_1"),
      session: sessionID("sess_1"),
      parent: null,
      payload: usage as Extract<Payload, { kind: "usage" }>,
    }
    const summary = costFold([event], () => undefined)
    expect(summary.costTicks).toBeNull()
    expect(summary.estimatedCostTicks).toBeNull()
  })

  it("asks for usage counters by default", async () => {
    let taken: Record<string, unknown> | undefined
    await collect(
      fakeClient([finish("stop")], (params) => {
        taken = params as Record<string, unknown>
      }),
    )

    expect(taken?.["stream_options"]).toEqual({ include_usage: true })
  })

  // `usage: false` is for a server that refuses the field. The request omits
  // it, and the one null-counter payload still arrives.
  it("omits stream_options under usage false, and still reports the payload", async () => {
    let taken: Record<string, unknown> | undefined
    const client = fakeClient([delta({ content: "hi" }), finish("stop")], (params) => {
      taken = params as Record<string, unknown>
    })
    const found = await Effect.runPromise(
      Stream.runCollect(
        makeCompatibleProvider({ ...options, usage: false, client }).turn(request).payloads,
      ).pipe(Effect.map((chunk) => [...chunk] as readonly Payload[])),
    )

    expect(taken !== undefined && "stream_options" in taken).toBe(false)
    expect(found.at(-1)).toMatchObject({ kind: "usage", inputTokens: null })
  })

  it("sends the system prompt as a system message and omits an unset max_tokens", async () => {
    let taken: Record<string, unknown> | undefined
    const client = fakeClient([finish("stop")], (params) => {
      taken = params as Record<string, unknown>
    })
    await Effect.runPromise(
      Stream.runDrain(
        makeCompatibleProvider({ ...options, client }).turn({ ...request, system: "be brief" })
          .payloads,
      ),
    )

    expect(taken?.["messages"]).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ])
    expect(taken !== undefined && "max_tokens" in taken).toBe(false)
  })

  it("sends a set maxTokens as max_tokens", async () => {
    let taken: Record<string, unknown> | undefined
    const client = fakeClient([finish("stop")], (params) => {
      taken = params as Record<string, unknown>
    })
    await Effect.runPromise(
      Stream.runDrain(
        makeCompatibleProvider({ ...options, maxTokens: 4096, client }).turn(request).payloads,
      ),
    )

    expect(taken?.["max_tokens"]).toBe(4096)
  })

  it("names the model the response reported, not the one that was asked for", async () => {
    const found = (await collect(
      fakeClient([{ ...finish("stop"), model: "qwen3-coder-30b-a3b" }]),
    )) as readonly Payload[]

    expect(found.at(-1)).toMatchObject({ model: "ollama/qwen3-coder-30b-a3b" })
  })

  it("reports end_turn once the stream drains", async () => {
    expect(await reasonAfterDraining(fakeClient([finish("stop")]))).toBe("end_turn")
  })

  it("reports no reason when nobody reported one", async () => {
    expect(await reasonAfterDraining(fakeClient([delta({ content: "hi" })]))).toBeUndefined()
  })

  // A refusal delta commits as text, so a --print run reads what the model
  // said.
  it("shows a refusal delta as text", async () => {
    const found = (await collect(
      fakeClient([delta({ refusal: "no" }), finish("content_filter")]),
    )) as readonly Payload[]

    expect(found).toContainEqual({ kind: "text", block: 0, content: { type: "text", text: "no" } })
  })

  it("fails with a classified ProviderError when the request is refused", async () => {
    const refused = Object.create(OpenAI.APIError.prototype) as {
      status: number
      message: string
    }
    refused.status = 429
    refused.message = "slow down"

    const found = await collect(failingClient(refused))

    expect(found).toMatchObject({
      _tag: "ProviderError",
      provider: "eva.provider.compatible:ollama",
      errorClass: "rate_limit",
      message: "slow down",
    })
  })

  // The turn never reaches the wire: the entry needs a Credential and the
  // store answered nothing, so the Run closes auth_failed.
  it("fails auth_failed when the entry needs a credential nobody has", async () => {
    const provider = makeCompatibleProvider({ ...options, credential: false })
    const found = await Effect.runPromise(
      Stream.runCollect(provider.turn(request).payloads).pipe(
        Effect.map((chunk) => [...chunk]),
        Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
      ),
    )

    expect(found).toMatchObject({
      _tag: "ProviderError",
      provider: "eva.provider.compatible:ollama",
      errorClass: "auth_failed",
      message: "no credential for ollama",
    })
  })
})

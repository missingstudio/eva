import type { Credential, ProviderRequest } from "@missingstudio/eva-core"
import type { Payload, TranscriptMessage } from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import OpenAI from "openai"
import { describe, expect, it } from "vitest"
import {
  classify,
  makeBlocks,
  makeOpenAIProvider,
  toInput,
  toStopReason,
  toUsage,
} from "./provider.js"

const key: Credential = { mode: "api_key", secret: () => Effect.succeed("sk-test") }

const human = (text: string): TranscriptMessage => ({
  author: "human",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

const agent = (text: string): TranscriptMessage => ({
  author: "agent",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

describe("toInput", () => {
  it("names the human user and everything else assistant", () => {
    expect(toInput([human("ask"), agent("answer")])).toEqual([
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
    expect(toInput([split])[0]?.content).toBe("one two")
  })

  it("keeps a thought block, because it is what the model said", () => {
    const thought: TranscriptMessage = {
      author: "agent",
      blocks: [{ type: "thought", block: 0, content: { type: "text", text: "thinking" } }],
    }
    expect(toInput([thought])[0]?.content).toBe("thinking")
  })

  it("drops a message with no text", () => {
    const empty: TranscriptMessage = { author: "agent", blocks: [] }
    expect(toInput([human("ask"), empty])).toHaveLength(1)
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

  it("reads insufficient_quota from the type field too", () => {
    const error = Object.create(OpenAI.APIError.prototype) as {
      status: number
      type?: string
    }
    error.status = 429
    error.type = "insufficient_quota"
    expect(classify(error)).toBe("billing")
  })

  it("reads a connection failure as unreachable", () => {
    expect(classify(new OpenAI.APIConnectionError({ message: "no route" }))).toBe("unreachable")
  })

  // A context overflow is `other`: it is not retried, and asking again with
  // the same context does not help.
  it("reads a 400 as other, context_length_exceeded included", () => {
    expect(classify(api(400, "context_length_exceeded"))).toBe("other")
  })

  it("reads anything else as other", () => {
    expect(classify(new Error("who knows"))).toBe("other")
    expect(classify(undefined)).toBe("other")
  })
})

describe("toStopReason", () => {
  it("answers end_turn for a completed response", () => {
    expect(toStopReason({ status: "completed" }, false)).toBe("end_turn")
  })

  // The published docs spell it two ways, so both are truncation.
  it.each(["max_output_tokens", "max_tokens"])("answers max_tokens for reason %s", (reason) => {
    expect(toStopReason({ status: "incomplete", incomplete_details: { reason } }, false)).toBe(
      "max_tokens",
    )
  })

  // A refusal is a content part and never a status, so it is the provider's
  // statement — carried by the delta, not read from a field.
  it("answers refusal when a refusal delta arrived", () => {
    expect(toStopReason({ status: "completed" }, true)).toBe("refusal")
  })

  // Silence understates and never misleads: a content filter has no member,
  // and `refusal` would be a small lie.
  it("answers nothing for an incomplete reason it has no member for", () => {
    expect(
      toStopReason(
        { status: "incomplete", incomplete_details: { reason: "content_filter" } },
        false,
      ),
    ).toBeUndefined()
  })

  it("answers nothing for a stream that never settled", () => {
    expect(toStopReason({}, false)).toBeUndefined()
  })
})

describe("toUsage", () => {
  // OpenAI's cached count is a subset of input_tokens, where Anthropic's sits
  // beside it. Without the subtraction those tokens bill twice.
  it("subtracts the cached count from the input count", () => {
    const found = toUsage("gpt-5.6", {
      input_tokens: 2006,
      input_tokens_details: { cached_tokens: 1920 },
      output_tokens: 450,
      output_tokens_details: { reasoning_tokens: 100 },
    })

    expect(found).toEqual({
      kind: "usage",
      model: "openai/gpt-5.6",
      inputTokens: 86,
      outputTokens: 450,
      cacheWriteTokens: null,
      cacheReadTokens: 1920,
      reasoningTokens: 100,
    })
  })

  // OpenAI bills reasoning inside the output count, so outputTicks already
  // charges it once — conformance asserts no openai seed prices it again.
  it("reports reasoningTokens without subtracting them from the output count", () => {
    const found = toUsage("gpt-5.6", {
      input_tokens: 10,
      output_tokens: 500,
      output_tokens_details: { reasoning_tokens: 400 },
    })

    expect(found.outputTokens).toBe(500)
    expect(found.reasoningTokens).toBe(400)
  })

  // OpenAI reports no cache-write count, and silence is not zero.
  it("leaves cacheWriteTokens null rather than zero", () => {
    expect(toUsage("gpt-5.6", { input_tokens: 1, output_tokens: 1 }).cacheWriteTokens).toBeNull()
  })

  it("reports every counter null when nothing was reported", () => {
    expect(toUsage("gpt-5.6", undefined)).toEqual({
      kind: "usage",
      model: "openai/gpt-5.6",
      inputTokens: null,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
  })

  it("never sets costTicks", () => {
    expect("costTicks" in toUsage("gpt-5.6", { input_tokens: 1, output_tokens: 1 })).toBe(false)
  })
})

describe("makeBlocks", () => {
  it("gives one content part one stable number", () => {
    const blocks = makeBlocks()
    expect(blocks("0:c0")).toBe(0)
    expect(blocks("0:c0")).toBe(0)
  })

  it("gives two parts of one output item two numbers", () => {
    const blocks = makeBlocks()
    expect(blocks("0:c0")).toBe(0)
    expect(blocks("0:c1")).toBe(1)
  })

  it("keeps a reasoning summary part apart from a text part of the same index", () => {
    const blocks = makeBlocks()
    expect(blocks("0:s0")).not.toBe(blocks("0:c0"))
  })

  it("starts again per Provider Turn", () => {
    makeBlocks()("0:c0")
    expect(makeBlocks()("0:c1")).toBe(0)
  })
})

describe("availability", () => {
  // Without this the Run reports no_such_model, which sends a reader looking
  // for a model that is there.
  it("is false when no credential resolved, and the provider still answers", () => {
    const provider = makeOpenAIProvider({})
    expect(provider.available()).toBe(false)
    expect(provider.id).toBe("eva.provider.openai")
  })

  it("is true once a credential is given", () => {
    expect(makeOpenAIProvider({ credential: key }).available()).toBe(true)
  })

  it("is true for an injected client, whatever the credential", () => {
    const client = new OpenAI({ apiKey: "sk-injected" })
    expect(makeOpenAIProvider({ client }).available()).toBe(true)
  })
})

// A fake stream standing for the SDK's: it emits events, then settles.
const fakeClient = (events: readonly unknown[], settle: (ok: boolean) => unknown): OpenAI => {
  const handlers: ((event: unknown) => void)[] = []
  const stream = {
    on: (name: string, handler: (event: unknown) => void) => {
      if (name === "event") handlers.push(handler)
      return stream
    },
    finalResponse: () =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          for (const event of events) for (const handler of handlers) handler(event)
          const settled = settle(true)
          if (settled instanceof Error) reject(settled)
          else resolve(settled)
        }, 0)
      }),
    abort: () => {},
  }
  return { responses: { stream: () => stream } } as unknown as OpenAI
}

const response = (over: Record<string, unknown> = {}) => ({
  model: "gpt-5.6",
  status: "completed",
  usage: {
    input_tokens: 10,
    output_tokens: 4,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
  ...over,
})

const request: ProviderRequest = {
  model: { provider: "openai", model: "gpt-5.6" },
  messages: [human("hi")],
}

const collect = (client: OpenAI) =>
  Effect.runPromise(
    Stream.runCollect(makeOpenAIProvider({ credential: key, client }).turn(request).payloads).pipe(
      Effect.map((chunk) => [...chunk] as readonly Payload[]),
      Effect.catchTag("ProviderError", (error) => Effect.succeed(error)),
    ),
  )

// The stop reason, read the way a Run reads it: once the stream has drained.
const reasonAfterDraining = (client: OpenAI) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const turn = makeOpenAIProvider({ credential: key, client }).turn(request)
      yield* Stream.runDrain(turn.payloads)
      return yield* turn.stopReason
    }),
  )

describe("a turn", () => {
  it("reports output-text deltas as text payloads in block order", async () => {
    const found = await collect(
      fakeClient(
        [
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "hel",
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "lo",
          },
          {
            type: "response.output_text.delta",
            output_index: 1,
            content_index: 0,
            delta: "next",
          },
        ],
        () => response(),
      ),
    )

    expect(found).toContainEqual({ kind: "text", block: 0, content: { type: "text", text: "hel" } })
    expect(found).toContainEqual({ kind: "text", block: 0, content: { type: "text", text: "lo" } })
    expect(found).toContainEqual({
      kind: "text",
      block: 1,
      content: { type: "text", text: "next" },
    })
  })

  it("reports a reasoning summary delta as a thought on its own block", async () => {
    const found = await collect(
      fakeClient(
        [
          {
            type: "response.reasoning_summary_text.delta",
            output_index: 0,
            summary_index: 0,
            delta: "hmm",
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "hi",
          },
        ],
        () => response(),
      ),
    )

    expect(found).toContainEqual({
      kind: "thought",
      block: 0,
      content: { type: "text", text: "hmm" },
    })
    expect(found).toContainEqual({ kind: "text", block: 1, content: { type: "text", text: "hi" } })
  })

  it("passes over an event that is not a delta", async () => {
    const found = await collect(
      fakeClient(
        [{ type: "response.created" }, { type: "response.output_item.added", output_index: 0 }],
        () => response(),
      ),
    )

    expect((found as readonly Payload[]).every((one) => one.kind === "usage")).toBe(true)
  })

  // A delta is content. The union has no kind for streamed tool arguments
  // yet, and a Trace that dropped them would answer a later question with a
  // gap it never recorded.
  it("preserves a delta it has no kind for rather than dropping it", async () => {
    const args = {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      delta: '{ "arg":',
    }
    const found = (await collect(fakeClient([args], () => response()))) as readonly Payload[]

    expect(found).toContainEqual({
      kind: "unknown",
      originalKind: "response.function_call_arguments.delta",
      raw: args,
    })
  })

  it("closes the stream with the usage payload", async () => {
    const found = (await collect(
      fakeClient([], () =>
        response({
          usage: {
            input_tokens: 2006,
            output_tokens: 450,
            input_tokens_details: { cached_tokens: 1920 },
            output_tokens_details: { reasoning_tokens: 100 },
          },
        }),
      ),
    )) as readonly Payload[]

    expect(found.at(-1)).toEqual({
      kind: "usage",
      model: "openai/gpt-5.6",
      inputTokens: 86,
      outputTokens: 450,
      cacheWriteTokens: null,
      cacheReadTokens: 1920,
      reasoningTokens: 100,
    })
  })

  it("names the model the response reported, not the one that was asked for", async () => {
    const found = (await collect(
      fakeClient([], () => response({ model: "gpt-4o-mini-2024-07-18" })),
    )) as readonly Payload[]

    expect(found.find((one) => one.kind === "usage")).toMatchObject({
      model: "openai/gpt-4o-mini-2024-07-18",
    })
  })

  it("reports end_turn for a completed response", async () => {
    const reason = await reasonAfterDraining(fakeClient([], () => response()))
    expect(reason).toBe("end_turn")
  })

  it("reports refusal when a refusal delta arrived, and shows its text", async () => {
    const client = fakeClient(
      [{ type: "response.refusal.delta", output_index: 0, content_index: 0, delta: "no" }],
      () => response(),
    )
    const turn = makeOpenAIProvider({ credential: key, client }).turn(request)
    const { found, reason } = await Effect.runPromise(
      Effect.gen(function* () {
        const chunk = yield* Stream.runCollect(turn.payloads)
        return { found: [...chunk] as readonly Payload[], reason: yield* turn.stopReason }
      }),
    )

    expect(found).toContainEqual({ kind: "text", block: 0, content: { type: "text", text: "no" } })
    expect(reason).toBe("refusal")
  })

  it("reports no reason for an incomplete response it has no member for", async () => {
    const reason = await reasonAfterDraining(
      fakeClient([], () =>
        response({ status: "incomplete", incomplete_details: { reason: "content_filter" } }),
      ),
    )
    expect(reason).toBeUndefined()
  })

  it("fails with a classified ProviderError when the request is refused", async () => {
    const refused = Object.create(OpenAI.APIError.prototype) as {
      status: number
      message: string
    }
    refused.status = 429
    refused.message = "slow down"

    const found = await collect(fakeClient([], () => refused))

    expect(found).toMatchObject({
      _tag: "ProviderError",
      provider: "eva.provider.openai",
      errorClass: "rate_limit",
      message: "slow down",
    })
  })

  // A failed response ends the stream cleanly and the terminal promise
  // resolves with it, so without this the Run reports usage and no error.
  it("fails when the response reports failure in-band", async () => {
    const found = await collect(
      fakeClient(
        [
          {
            type: "response.failed",
            response: { error: { code: "server_error", message: "boom" } },
          },
        ],
        () => response({ status: "failed" }),
      ),
    )

    expect(found).toMatchObject({
      _tag: "ProviderError",
      provider: "eva.provider.openai",
      message: expect.stringContaining("boom") as string,
    })
  })
})

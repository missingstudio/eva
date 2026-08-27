import {
  runID,
  sessionID,
  type Claim,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import type { Budget, Recorder } from "./contracts.js"
import {
  ProviderError,
  providerTurn,
  type Provider,
  type ProviderRequest,
  type Retry,
} from "./provider.js"
import { submit, type RunDeps, type RunInput } from "./session.js"
import type { BudgetState, Usage } from "./spec.js"

const input: RunInput = {
  session: sessionID("sess_hooks"),
  spec: { intent: "go" },
  model: { provider: "fake", model: "model" },
  history: [],
}

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const usage = (over: Partial<Extract<Payload, { kind: "usage" }>> = {}): Payload => ({
  kind: "usage",
  model: "fake/model",
  inputTokens: 10,
  outputTokens: 4,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
  ...over,
})

const recorder = () => {
  const groups: Payload[][] = []
  const closed: Claim[] = []
  const impl: Recorder = {
    open: (session: SessionID) => Effect.sync(() => runID(`run_of_${session}`)),
    commit: (payloads) => Effect.sync(() => void groups.push([...payloads])),
    close: (claim) => Effect.sync(() => void closed.push(claim)),
  }
  return { impl, groups, closed }
}

const provider = (turns: readonly Stream.Stream<Payload, ProviderError>[]): Provider => {
  let index = 0
  return {
    id: "eva.provider.fake",
    available: () => true,
    turn: () => providerTurn(turns[Math.min(index++, turns.length - 1)] ?? Stream.empty),
  }
}

const base = (impl: Recorder | undefined, one: Provider): RunDeps => ({
  recorder: Effect.sync(() => impl),
  resolve: (model) => Effect.succeed({ model, provider: one }),
  emit: () => Effect.void,
})

const failing = (errorClass: ProviderError["errorClass"]) =>
  Stream.fail(new ProviderError({ provider: "eva.provider.fake", errorClass, message: "refused" }))

// Every hook `RunDeps` declares must actually run. Registering one
// that never fires is the failure this file exists to prevent.
describe("provider.request.before", () => {
  it("hands the hook the request and sends what it returns", async () => {
    const seen: ProviderRequest[] = []
    const one: Provider = {
      id: "eva.provider.fake",
      available: () => true,
      turn: (request) => {
        seen.push(request)
        return providerTurn(Stream.fromIterable([text("hi")]))
      },
    }
    const kept = recorder()

    await Effect.runPromise(
      submit(
        {
          ...base(kept.impl, one),
          beforeRequest: (request) => Effect.succeed({ ...request, system: "a system prompt" }),
        },
        input,
      ),
    )

    expect(seen[0]?.system).toBe("a system prompt")
  })
})

describe("provider.response.after", () => {
  it("commits what the hook returned, not what the provider sent", async () => {
    const kept = recorder()
    await Effect.runPromise(
      submit(
        {
          ...base(kept.impl, provider([Stream.fromIterable([usage({ outputTokens: -5 })])])),
          afterResponse: (group) =>
            Effect.succeed(
              group.map((payload) =>
                payload.kind === "usage" ? { ...payload, outputTokens: 0 } : payload,
              ),
            ),
        },
        input,
      ),
    )

    const committed = kept.groups.flat().find((payload) => payload.kind === "usage")
    expect(committed).toMatchObject({ outputTokens: 0 })
  })
})

describe("provider.retry", () => {
  it("retries a refused attempt and records each one inside the open Run", async () => {
    const kept = recorder()
    const waited: number[] = []
    const decisions: Retry[] = [
      { retry: true, max: 3, delayMs: 10 },
      { retry: true, max: 3, delayMs: 20 },
      { retry: false, max: 3, delayMs: 0 },
    ]

    const result = await Effect.runPromise(
      submit(
        {
          ...base(
            kept.impl,
            provider([
              failing("overloaded"),
              failing("overloaded"),
              Stream.fromIterable([text("finally"), usage()]),
            ]),
          ),
          retry: (_error, attempt) => Effect.succeed(decisions[attempt - 1] ?? decisions[2]!),
          sleep: (milliseconds) => Effect.sync(() => void waited.push(milliseconds)),
        },
        input,
      ),
    )

    expect(result.claim.result).toBe("done")
    expect(result.attempts).toBe(3)
    expect(waited).toEqual([10, 20])

    const retries = kept.groups.flat().filter((payload) => payload.kind === "retry")
    expect(retries).toHaveLength(2)
    expect(retries[0]).toEqual({
      kind: "retry",
      attempt: 1,
      max: 3,
      delayMs: 10,
      errorClass: "overloaded",
    })
  })

  it("stops when the policy refuses, and the claim carries the class", async () => {
    const kept = recorder()
    const result = await Effect.runPromise(
      submit(
        {
          ...base(kept.impl, provider([failing("auth_failed")])),
          retry: () => Effect.succeed({ retry: false, max: 3, delayMs: 0 }),
        },
        input,
      ),
    )

    expect(result.attempts).toBe(1)
    expect(result.claim).toMatchObject({ result: "failed", errorClass: "auth_failed" })
    expect(kept.groups.flat().filter((one) => one.kind === "retry")).toHaveLength(0)
  })

  it("makes one attempt when no policy is registered", async () => {
    const kept = recorder()
    const result = await Effect.runPromise(
      submit(base(kept.impl, provider([failing("overloaded")])), input),
    )
    expect(result.attempts).toBe(1)
    expect(result.claim.result).toBe("failed")
  })
})

describe("the Budget", () => {
  it("is charged with every usage record the Run commits", async () => {
    const charged: Usage[] = []
    const state: BudgetState = {
      tokens: 0,
      spend: { kind: "none" },
      milliseconds: 0,
      steps: 0,
      limits: {},
    }
    const budget: Budget = {
      charge: (spent) =>
        Effect.sync(() => {
          charged.push(spent)
          return state
        }),
      state: Effect.succeed(state),
      check: Effect.succeed({ kind: "affordable" }),
    }
    const kept = recorder()

    await Effect.runPromise(
      submit(
        {
          ...base(kept.impl, provider([Stream.fromIterable([text("hi"), usage()])])),
          budget: Effect.succeed(budget),
        },
        input,
      ),
    )

    // The cache counters travel too: an estimate that dropped them would
    // price a cache read at the fresh-input rate.
    expect(charged).toEqual([
      {
        model: "fake/model",
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: null,
      },
    ])
  })

  it("runs without a Budget rather than requiring one", async () => {
    const kept = recorder()
    const result = await Effect.runPromise(
      submit(
        {
          ...base(kept.impl, provider([Stream.fromIterable([usage()])])),
          budget: Effect.succeed(undefined),
        },
        input,
      ),
    )
    expect(result.claim.result).toBe("done")
  })
})

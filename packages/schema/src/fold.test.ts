import { describe, expect, it } from "vitest"
import { toTicks } from "./cost.js"
import { foldKeys, type Event } from "./event.js"
import { eventID, runID, sessionID } from "./id.js"
import { answerFold, costFold, mergeText, transcriptFold, validityOf, verdictFold } from "./fold.js"
import type { Payload, Verdict } from "./payload.js"
import { samples } from "./samples.js"

let counter = 0
const make = (payload: Payload, overrides: Partial<Event> = {}): Event => {
  counter += 1
  return {
    id: eventID(`evt_${counter}`),
    seq: counter,
    at: { wall: "2026-08-15T09:00:00Z" },
    run: runID("run_a"),
    session: sessionID("sess_a"),
    parent: null,
    payload,
    ...overrides,
  }
}

const text = (value: string, block = 0): Payload => ({
  kind: "text",
  block,
  content: { type: "text", text: value },
})

const usage = (over: Partial<Extract<Payload, { kind: "usage" }>>): Payload => ({
  kind: "usage",
  model: "anthropic/claude-sonnet-4-5",
  inputTokens: 10,
  outputTokens: 5,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  serverToolTokens: 0,
  costTicks: 100,
  ...over,
})

describe("foldKeys", () => {
  it("carries session, run, and parent", () => {
    const event = make(text("x"))
    expect(foldKeys(event)).toEqual({
      session: event.session,
      run: event.run,
      parent: event.parent,
    })
  })
})

describe("mergeText", () => {
  it("merges adjacent chunks and keeps the first stamp", () => {
    const a = make(text("Hel"))
    const b = make(text("lo."))
    const merged = mergeText([a, b])
    expect(merged).toHaveLength(1)
    const only = merged[0]!
    expect(only.id).toBe(a.id)
    expect(only.at).toEqual(a.at)
    expect(only.payload).toEqual(text("Hello."))
  })

  it.each([
    ["block index differs", make(text("a", 0)), make(text("b", 1))],
    ["run differs", make(text("a")), make(text("b"), { run: runID("run_b") })],
    ["parent differs", make(text("a")), make(text("b"), { parent: eventID("evt_p") })],
    ["session differs", make(text("a")), make(text("b"), { session: sessionID("sess_b") })],
    [
      "content is not text",
      make(text("a")),
      make({
        kind: "text",
        block: 0,
        content: { type: "image", data: "aGk=", mimeType: "image/png" },
      }),
    ],
  ])("does not merge when %s", (_reason, a, b) => {
    expect(mergeText([a, b])).toHaveLength(2)
  })

  it("does not merge across an intervening event", () => {
    const events = [make(text("a")), make(samples().retry), make(text("b"))]
    expect(mergeText(events)).toHaveLength(3)
  })
})

describe("costFold", () => {
  it("returns all-null with no usage records", () => {
    expect(costFold([make(text("x"))])).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
      serverToolTokens: null,
      costTicks: null,
      estimatedCostTicks: null,
    })
  })

  it("sums when every record reports, and zero stays zero", () => {
    const total = costFold([make(usage({})), make(usage({ inputTokens: 0, costTicks: 0 }))])
    expect(total).toEqual({
      inputTokens: 10,
      outputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      serverToolTokens: 0,
      costTicks: 100,
      estimatedCostTicks: null,
    })
  })

  it.each([
    ["inputTokens", usage({ inputTokens: null })],
    ["outputTokens", usage({ outputTokens: null })],
    ["cacheWriteTokens", usage({ cacheWriteTokens: null })],
    ["cacheReadTokens", usage({ cacheReadTokens: null })],
    ["reasoningTokens", usage({ reasoningTokens: null })],
    ["serverToolTokens", usage({ serverToolTokens: null })],
    [
      "costTicks",
      (({ costTicks: _, ...rest }) => rest)(usage({}) as Extract<Payload, { kind: "usage" }>),
    ],
  ] as const)("one silent %s suppresses that total", (key, silent) => {
    const total = costFold([make(usage({})), make(silent)])
    expect(total[key]).toBeNull()
  })

  /**
   * The two shapes of cost. A `usage` cost is what one exchange cost and the
   * fold adds them; an `info` cost is what the producer says the session has
   * cost so far, and adding two of those answers with neither.
   */
  it("takes the last reported total rather than summing the totals", () => {
    const total = costFold([
      make({ kind: "info", costTicks: 100 }),
      make({ kind: "info", costTicks: 300 }),
      make({ kind: "info", costTicks: 700 }),
    ])
    expect(total.costTicks).toBe(700)
  })

  it("lets a reported total stand in for the sum of the exchanges", () => {
    const total = costFold([make(usage({ costTicks: 40 })), make({ kind: "info", costTicks: 700 })])
    expect(total.costTicks).toBe(700)
    expect(total.inputTokens).toBe(10)
  })

  it("passes over an info record that reports no cost", () => {
    const total = costFold([make(usage({ costTicks: 40 })), make({ kind: "info", title: "hello" })])
    expect(total.costTicks).toBe(40)
  })

  /**
   * The estimate answers a different question from the Cost: what the
   * counters come to at catalog rates. It never merges into `costTicks`, so
   * a derived figure cannot be read as a figure a Provider reported.
   */
  describe("the estimate", () => {
    // $3/M in, $15/M out — the rate shape models.dev publishes.
    const price = { inputTicks: toTicks(3), outputTicks: toTicks(15) }
    const rate = () => price

    it("is null when no price lookup is given", () => {
      expect(costFold([make(usage({}))]).estimatedCostTicks).toBeNull()
    })

    it("prices the counters at the catalog rate", () => {
      const counted = usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(costFold([make(counted)], rate).estimatedCostTicks).toBe(toTicks(18))
    })

    it("adds an exchange to the ones before it", () => {
      const one = usage({ inputTokens: 500_000, outputTokens: 0 })
      const two = usage({ inputTokens: 500_000, outputTokens: 0 })
      expect(costFold([make(one), make(two)], rate).estimatedCostTicks).toBe(toTicks(3))
    })

    it("prices the cache counters at their own rates", () => {
      const cached = {
        inputTicks: toTicks(3),
        outputTicks: toTicks(15),
        cacheReadTicks: toTicks(0.3),
      }
      const counted = usage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })
      expect(costFold([make(counted)], () => cached).estimatedCostTicks).toBe(toTicks(0.3))
    })

    // A partial estimate misleads exactly as a partial sum does.
    it("is null when one record names a model the catalog does not price", () => {
      const known = usage({ inputTokens: 1_000_000, outputTokens: 0 })
      const other = usage({ model: "anthropic/unpriced" })
      const found = costFold([make(known), make(other)], (model) =>
        model === "anthropic/unpriced" ? undefined : price,
      )
      expect(found.estimatedCostTicks).toBeNull()
    })

    it("stands beside a reported cost rather than replacing it", () => {
      const counted = usage({ inputTokens: 1_000_000, outputTokens: 0, costTicks: 99 })
      const found = costFold([make(counted)], rate)
      expect(found.costTicks).toBe(99)
      expect(found.estimatedCostTicks).toBe(toTicks(3))
    })

    it("is null when there is nothing to price", () => {
      expect(costFold([make(text("x"))], rate).estimatedCostTicks).toBeNull()
    })
  })

  it("treats an absent optional counter as silence, not zero", () => {
    const bare: Payload = {
      kind: "usage",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    }
    const total = costFold([make(bare)])
    expect(total.reasoningTokens).toBeNull()
    expect(total.costTicks).toBeNull()
    expect(total.inputTokens).toBe(1)
  })
})

describe("transcriptFold", () => {
  it("folds a run into human and agent messages", () => {
    const events = [
      make(samples().started),
      make(samples().plan),
      make(samples().thought),
      make(text("Eva is ")),
      make(text("a model client.")),
      make(samples().tool_call),
      make(samples().tool_update),
      make(samples().tool_result),
      make(samples().usage),
      make(samples().finished),
    ]
    const messages = transcriptFold(events)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({
      author: "human",
      blocks: [
        {
          type: "content",
          block: 0,
          content: { type: "text", text: "explain what this project does" },
        },
      ],
    })
    expect(messages[1]!.author).toBe("agent")
    expect(messages[1]!.blocks).toEqual([
      { type: "thought", block: 1, content: { type: "text", text: "Read the README first." } },
      { type: "content", block: 0, content: { type: "text", text: "Eva is a model client." } },
      {
        type: "tool",
        id: "call_01",
        name: "read",
        tool: "read",
        status: "in_progress",
        disposition: "ok",
      },
    ])
  })

  it("records steering as a human message", () => {
    const messages = transcriptFold([
      make(samples().started),
      make(text("first")),
      make(samples().message),
      make(text("second")),
    ])
    expect(messages.map((m) => m.author)).toEqual(["human", "agent", "human", "agent"])
  })

  it("merges the chunks of a thought", () => {
    const chunk = (value: string): Payload => ({
      kind: "thought",
      block: 0,
      content: { type: "text", text: value },
    })
    const messages = transcriptFold([make(chunk("Read the ")), make(chunk("README first."))])
    expect(messages[0]!.blocks).toEqual([
      { type: "thought", block: 0, content: { type: "text", text: "Read the README first." } },
    ])
  })

  // Every Run numbers its blocks from zero, so the block index alone does
  // not say two chunks belong together. The fold keys do.
  it("keeps two Runs apart when they reuse a block index", () => {
    const messages = transcriptFold([
      make(text("mine")),
      make(text("theirs"), { run: runID("run_b") }),
    ])
    expect(messages[0]!.blocks).toEqual([
      { type: "content", block: 0, content: { type: "text", text: "mine" } },
      { type: "content", block: 0, content: { type: "text", text: "theirs" } },
    ])
  })

  // A Verdict is not conversation content.
  it("keeps a verdict out of the transcript", () => {
    expect(transcriptFold([make(samples().verdict)])).toEqual([])
  })

  // A file the Run changed is. The record holds a path and a count of hunks,
  // so that is what the turn carries.
  it("carries an edit as a block of the agent's turn", () => {
    const messages = transcriptFold([make(text("changing it")), make(samples().edit)])
    expect(messages).toHaveLength(1)
    expect(messages[0]!.blocks[1]).toEqual({ type: "edit", path: "src/index.ts", hunks: 2 })
  })
})

const verdict = (
  step: string,
  word: Verdict,
  attempt: number,
  faults: readonly { at: string; wanted: string }[] = [],
): Payload => ({ kind: "verdict", step, verdict: word, attempt, faults })

const fault = { at: "/title", wanted: "a string" }

describe("verdictFold", () => {
  const none = { firstPass: 0, firstPassValid: 0, settledValid: 0, unchecked: 0, held: 0 }

  it("counts every Candidate that conforms on the first pass", () => {
    const summary = verdictFold([
      make(verdict("draft", "valid", 1)),
      make(verdict("title", "valid", 1)),
    ])
    expect(summary).toEqual({ ...none, firstPass: 2, firstPassValid: 2, settledValid: 2 })
  })

  it("pairs a Repair across two Runs into one Candidate", () => {
    const summary = verdictFold([
      make(verdict("draft", "invalid", 1, [fault])),
      make(verdict("draft", "valid", 2), { run: runID("run_b") }),
    ])
    expect(summary).toEqual({ ...none, firstPass: 1, firstPassValid: 0, settledValid: 1 })
  })

  it("does not move settledValid when every attempt fails", () => {
    const summary = verdictFold([
      make(verdict("draft", "invalid", 1, [fault])),
      make(verdict("draft", "invalid", 2, [fault]), { run: runID("run_b") }),
    ])
    expect(summary).toEqual({ ...none, firstPass: 1 })
  })

  it("holds an unchecked Candidate out of both ratios", () => {
    const summary = verdictFold([
      make(verdict("draft", "unchecked", 1)),
      make({ kind: "degraded", missing: ["Validator"] }),
    ])
    expect(summary).toEqual({ ...none, unchecked: 1, held: 1 })
  })

  it("pairs attempts by step and not by adjacency", () => {
    const summary = verdictFold([
      make(verdict("outline", "invalid", 1, [fault])),
      make(verdict("summary", "valid", 1)),
      make(verdict("outline", "valid", 2), { run: runID("run_b") }),
    ])
    expect(summary).toEqual({ ...none, firstPass: 2, firstPassValid: 1, settledValid: 2 })
  })

  // The retry was a Provider Turn that produced nothing; the attempt
  // counts Candidates.
  it("does not let a retry between attempts split the Candidate", () => {
    const summary = verdictFold([
      make(verdict("draft", "invalid", 1, [fault])),
      make(samples().retry),
      make(verdict("draft", "valid", 2), { run: runID("run_b") }),
    ])
    expect(summary).toEqual({ ...none, firstPass: 1, firstPassValid: 0, settledValid: 1 })
  })

  // This stops a build that quietly lost a slot from reporting a rate it
  // did not earn.
  it("holds every Candidate of a Run that committed a degraded, whatever it lost", () => {
    const summary = verdictFold([
      make(verdict("draft", "valid", 1)),
      make({ kind: "degraded", missing: ["TraceSink"] }),
    ])
    expect(summary).toEqual({ ...none, held: 1 })
  })
})

describe("validityOf", () => {
  it("answers none over nothing, whatever unchecked holds", () => {
    const summary = { firstPass: 0, firstPassValid: 0, settledValid: 0, unchecked: 3, held: 0 }
    expect(validityOf(summary)).toEqual({ kind: "none" })
  })

  it("answers the rate over firstPass, the one denominator", () => {
    const summary = { firstPass: 4, firstPassValid: 3, settledValid: 4, unchecked: 1, held: 1 }
    expect(validityOf(summary)).toEqual({ kind: "rate", valid: 3, of: 4 })
    expect(validityOf(summary)).toMatchObject({ of: summary.firstPass })
  })
})

describe("answerFold", () => {
  const started = (intent: string): Payload => ({ kind: "started", intent })
  const finished = (summary: string, result: "done" | "failed" = "done"): Payload => ({
    kind: "finished",
    claim: { result, summary },
  })

  it("carries no Claim when no Run closed", () => {
    expect(answerFold([make(started("go")), make(text("half"))])).toEqual({ text: "" })
  })

  it("joins the chunks of the Run that closed last", () => {
    const events = [
      make(started("first")),
      make(text("one ")),
      make(text("two")),
      make(finished("first")),
    ]
    expect(answerFold(events)).toEqual({
      claim: { result: "done", summary: "first" },
      text: "one two",
    })
  })

  it("answers with the last Run, and leaves the Runs before it on the Trace", () => {
    const events = [
      make(started("outline")),
      make(text("an outline")),
      make(finished("outline")),
      make(started("prose")),
      make(text("the prose")),
      make(finished("prose")),
    ]
    expect(answerFold(events)).toEqual({
      claim: { result: "done", summary: "prose" },
      text: "the prose",
    })
  })

  it("keeps a refusal that wrote no text", () => {
    const events = [make(started("go")), make(finished("the workflow cannot run", "failed"))]
    expect(answerFold(events)).toEqual({
      claim: { result: "failed", summary: "the workflow cannot run" },
      text: "",
    })
  })
})

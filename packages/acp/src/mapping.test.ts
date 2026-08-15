import {
  costFold,
  decode,
  encode,
  eventID,
  kinds,
  runID,
  sessionID,
  toTicks,
  type Event,
  type Payload,
} from "@missingstudio/eva-schema"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { payloads, toPayload, toStopReason } from "./mapping.js"
import {
  DRAFT_SESSION_UPDATE_KINDS,
  SESSION_UPDATE_KINDS,
  type SessionUpdateKind,
} from "./protocol.js"

const text = { type: "text", text: "on the wire" }

// One populated update per stable kind, with the extras the wire really carries.
const fixtures: Record<SessionUpdateKind, unknown> = {
  user_message_chunk: {
    sessionUpdate: "user_message_chunk",
    content: { ...text, annotations: { audience: ["user"] } },
    messageId: "msg_1",
  },
  agent_message_chunk: { sessionUpdate: "agent_message_chunk", content: text },
  agent_thought_chunk: { sessionUpdate: "agent_thought_chunk", content: text },
  tool_call: {
    sessionUpdate: "tool_call",
    toolCallId: "call_1",
    title: "Read README.md",
    name: "read",
    kind: "read",
    status: "pending",
    rawInput: { path: "README.md" },
    locations: [{ path: "/tmp/README.md", line: 1 }],
  },
  tool_call_update: {
    sessionUpdate: "tool_call_update",
    toolCallId: "call_1",
    status: "completed",
    content: [
      { type: "content", content: text },
      { type: "diff", path: "/tmp/a.ts", oldText: "a", newText: "b" },
    ],
  },
  plan: {
    sessionUpdate: "plan",
    entries: [{ content: "read the file", priority: "high", status: "in_progress" }],
  },
  available_commands_update: {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      { name: "model", description: "set the model", input: { hint: "provider/model" } },
      { name: "cost", description: "show the spend" },
    ],
  },
  current_mode_update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
  config_option_update: {
    sessionUpdate: "config_option_update",
    configOptions: [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "claude-sonnet-4-5",
        options: [],
      },
    ],
  },
  session_info_update: {
    sessionUpdate: "session_info_update",
    title: "Reading the README",
    updatedAt: "2026-08-15T09:00:00Z",
  },
  usage_update: {
    sessionUpdate: "usage_update",
    used: 1200,
    size: 200_000,
    cost: { amount: 5.1, currency: "USD" },
  },
}

// A stop reason ends a Run; it is not a session update, so it is not here.
const expected: Record<SessionUpdateKind, Payload["kind"]> = {
  user_message_chunk: "message",
  agent_message_chunk: "text",
  agent_thought_chunk: "thought",
  tool_call: "tool_call",
  tool_call_update: "tool_update",
  plan: "plan",
  available_commands_update: "commands",
  current_mode_update: "mode",
  config_option_update: "config",
  session_info_update: "info",
  // The cost ACP reports is the session's running total, which is what
  // `info` carries. `usage` is per exchange, and ACP never reports one.
  usage_update: "info",
}

const wrap = (payload: Payload): Event => ({
  id: eventID("evt_acp"),
  seq: 1,
  at: { wall: "2026-08-15T09:00:00Z" },
  run: runID("run_acp"),
  session: sessionID("sess_acp"),
  parent: null,
  payload,
})

const chunk = (kind: "agent_message_chunk" | "agent_thought_chunk", said: string) => ({
  sessionUpdate: kind,
  content: { type: "text", text: said },
})

const read = (updates: readonly unknown[]): Promise<readonly Payload[]> =>
  Effect.runPromise(Stream.runCollect(payloads(Stream.fromIterable(updates))))

// The block index of each chunk, in order. A payload that opens no block has
// none, and says so rather than reporting a number it does not carry.
const blocks = (found: readonly Payload[]): readonly (number | undefined)[] =>
  found.map((one) => (one.kind === "text" || one.kind === "thought" ? one.block : undefined))

// Every session update the protocol defines maps, and nothing defined
// falls through to unknown.
describe("toPayload", () => {
  it.each(SESSION_UPDATE_KINDS)("maps %s to exactly one payload kind", (kind) => {
    expect(toPayload(fixtures[kind]).kind).toBe(expected[kind])
  })

  it("never lets a defined kind fall through to unknown", () => {
    for (const kind of SESSION_UPDATE_KINDS) {
      expect(toPayload(fixtures[kind]).kind).not.toBe("unknown")
    }
  })

  // The mapping is total, not injective: two kinds may answer the same
  // question, and `session_info_update` and `usage_update` both do.
  it("maps every kind to a payload the union names", () => {
    const mapped = SESSION_UPDATE_KINDS.map((kind) => toPayload(fixtures[kind]).kind)
    expect(mapped.filter((kind) => !kinds().includes(kind))).toEqual([])
    expect(new Set(mapped).size).toBe(SESSION_UPDATE_KINDS.length - 1)
  })

  it("produces payloads the schema codec accepts", () => {
    for (const kind of SESSION_UPDATE_KINDS) {
      const payload = toPayload(fixtures[kind])
      expect(decode(encode(wrap(payload))).payload).toEqual(payload)
    }
  })

  it.each(DRAFT_SESSION_UPDATE_KINDS)("preserves the draft kind %s as unknown", (kind) => {
    const update = { sessionUpdate: kind, planId: "plan_1" }
    expect(toPayload(update)).toEqual({ kind: "unknown", originalKind: kind, raw: update })
  })

  it("preserves a fabricated kind as unknown", () => {
    const update = { sessionUpdate: "party_mode_update", confetti: true }
    expect(toPayload(update)).toEqual({
      kind: "unknown",
      originalKind: "party_mode_update",
      raw: update,
    })
  })

  it("preserves a defined kind with a malformed body as unknown", () => {
    const update = { sessionUpdate: "plan", entries: "not an array" }
    expect(toPayload(update)).toMatchObject({ kind: "unknown", originalKind: "plan" })
  })
})

describe("the field projections", () => {
  it("drops annotations and _meta from a content block", () => {
    const payload = toPayload(fixtures.user_message_chunk)
    expect(payload).toEqual({
      kind: "message",
      content: { type: "text", text: "on the wire" },
      target: "next-run",
    })
  })

  it("keeps tool_call args raw and titles a call that has no name", () => {
    const payload = toPayload({
      sessionUpdate: "tool_call",
      toolCallId: "call_2",
      title: "Run the tests",
      rawInput: { command: "bun test" },
    })
    expect(payload).toEqual({
      kind: "tool_call",
      id: "call_2",
      name: "Run the tests",
      tool: "other",
      args: { command: "bun test" },
      status: "pending",
      redacted: false,
    })
  })

  it("carries only content blocks out of a tool update, never a diff", () => {
    expect(toPayload(fixtures.tool_call_update)).toEqual({
      kind: "tool_update",
      id: "call_1",
      status: "completed",
      content: [{ type: "text", text: "on the wire" }],
    })
  })

  it("treats a content-only tool update as work in progress", () => {
    expect(toPayload({ sessionUpdate: "tool_call_update", toolCallId: "call_3" })).toEqual({
      kind: "tool_update",
      id: "call_3",
      status: "in_progress",
    })
  })

  it("converts a USD cost to integer ticks on the level, not the increment", () => {
    expect(toPayload(fixtures.usage_update)).toEqual({
      kind: "info",
      costTicks: 51_000_000_000,
    })
  })

  /**
   * ACP's cost is the session's running total. Committing it as `usage`
   * would hand a level to a fold that adds, so three updates of a session
   * that cost $0.05 would fold to $0.08 and charge the Budget the same.
   */
  it("does not sum the running totals ACP reports", async () => {
    const spend = (amount: number) => ({
      sessionUpdate: "usage_update",
      used: 10,
      size: 100,
      cost: { amount, currency: "USD" },
    })
    const found = await read([spend(0.01), spend(0.03), spend(0.05)])

    expect(costFold(found.map(wrap)).costTicks).toBe(toTicks(0.05))
  })

  // The SDK leaves `cost` optional, so an update may carry only occupancy —
  // which has no kind. The record then says nothing, rather than nothing
  // being recorded, because every update the protocol defines has somewhere
  // to go.
  it("records an update that carries only occupancy as an info that says nothing", () => {
    expect(toPayload({ sessionUpdate: "usage_update", used: 10, size: 100 })).toEqual({
      kind: "info",
    })
  })

  it("leaves a non-USD cost unreported rather than converting it", () => {
    const payload = toPayload({
      sessionUpdate: "usage_update",
      used: 10,
      size: 100,
      cost: { amount: 5.1, currency: "EUR" },
    })
    expect(payload).not.toHaveProperty("costTicks")
  })
})

/**
 * ACP carries no block index, so the stream is what assigns one. These are
 * the boundaries the Recorder groups its commits by and the transcript
 * coalesces on, and none of them is knowable one update at a time.
 */
describe("payloads", () => {
  it("keeps one run of chunks in one block", async () => {
    const found = await read([
      chunk("agent_message_chunk", "one "),
      chunk("agent_message_chunk", "two "),
      chunk("agent_message_chunk", "three"),
    ])
    expect(blocks(found)).toEqual([0, 0, 0])
  })

  it("opens a block when the chunk kind changes", async () => {
    const found = await read([
      chunk("agent_thought_chunk", "thinking"),
      chunk("agent_message_chunk", "saying"),
      chunk("agent_thought_chunk", "thinking again"),
    ])
    expect(found.map((one) => one.kind)).toEqual(["thought", "text", "thought"])
    expect(blocks(found)).toEqual([0, 1, 2])
  })

  it("closes the block a tool call interrupts", async () => {
    const found = await read([
      chunk("agent_message_chunk", "before"),
      fixtures.tool_call,
      chunk("agent_message_chunk", "after"),
    ])
    expect(found.map((one) => one.kind)).toEqual(["text", "tool_call", "text"])
    expect(blocks(found)).toEqual([0, undefined, 1])
  })

  it("leaves the index alone for an update that opens no block", async () => {
    const found = await read([fixtures.plan, fixtures.usage_update, fixtures.plan])
    expect(found.map((one) => one.kind)).toEqual(["plan", "info", "plan"])
  })

  it("counts a preserved unknown as a block boundary, because it is not a chunk", async () => {
    const found = await read([
      chunk("agent_message_chunk", "before"),
      { sessionUpdate: "party_mode_update" },
      chunk("agent_message_chunk", "after"),
    ])
    expect(blocks(found)).toEqual([0, undefined, 1])
  })

  it("maps every update the stream carries, in order", async () => {
    const found = await read(SESSION_UPDATE_KINDS.map((kind) => fixtures[kind]))
    expect(found.map((one) => one.kind)).toEqual(SESSION_UPDATE_KINDS.map((kind) => expected[kind]))
  })
})

/**
 * The stop reason arrives on the `session/prompt` result, not as a session
 * update. It is the twelfth row of the mapping table.
 */
describe("toStopReason", () => {
  it.each(["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"] as const)(
    "maps %s",
    (reason) => {
      expect(toStopReason({ stopReason: reason })).toBe(reason)
    },
  )

  it("leaves a reason the protocol does not define unreported", () => {
    expect(toStopReason({ stopReason: "tool_use" })).toBeUndefined()
  })

  it("leaves a result that names no reason unreported", () => {
    expect(toStopReason({})).toBeUndefined()
    expect(toStopReason(null)).toBeUndefined()
    expect(toStopReason(undefined)).toBeUndefined()
  })
})

import { eventID, sessionID } from "./id.js"
import type { Kind, Payload } from "./payload.js"

// One populated payload per kind. A kind with no sample fails the registry test.
export const samples = (): Record<Kind, Payload> => ({
  started: {
    kind: "started",
    intent: "explain what this project does",
  },
  text: { kind: "text", block: 0, content: { type: "text", text: "This project is Eva." } },
  thought: { kind: "thought", block: 1, content: { type: "text", text: "Read the README first." } },
  message: {
    kind: "message",
    content: { type: "text", text: "also check the docs directory" },
    target: "next-step",
  },
  tool_call: {
    kind: "tool_call",
    id: "call_01",
    name: "read",
    tool: "read",
    args: { path: "README.md" },
    status: "pending",
    redacted: false,
  },
  tool_update: {
    kind: "tool_update",
    id: "call_01",
    status: "in_progress",
    content: [{ type: "text", text: "reading README.md" }],
  },
  tool_result: { kind: "tool_result", id: "call_01", name: "read", disposition: "ok", bytes: 2048 },
  plan: {
    kind: "plan",
    entries: [
      { content: "survey the tree", priority: "high", status: "completed" },
      { content: "write the summary", priority: "medium", status: "in_progress" },
    ],
  },
  mode: { kind: "mode", mode: "plan", reason: "user switched" },
  commands: {
    kind: "commands",
    commands: [
      { name: "model", description: "set the session model", input: { hint: "provider/model" } },
    ],
  },
  config: {
    kind: "config",
    options: [{ id: "model", name: "Model", value: "anthropic/claude-sonnet-4-5" }],
  },
  info: {
    kind: "info",
    title: "Project overview",
    updatedAt: "2026-08-15T09:00:00Z",
    costTicks: 42_000_000,
  },
  usage: {
    kind: "usage",
    model: "anthropic/claude-sonnet-4-5",
    inputTokens: 1200,
    outputTokens: 340,
    cacheWriteTokens: null,
    cacheReadTokens: 0,
    reasoningTokens: 20,
    serverToolTokens: null,
  },
  retry: { kind: "retry", attempt: 1, max: 3, delayMs: 2000, errorClass: "overloaded" },
  verdict: {
    kind: "verdict",
    step: "summarize",
    verdict: "invalid",
    attempt: 1,
    faults: [{ at: "/summary", wanted: "a string" }],
  },
  edit: { kind: "edit", path: "src/index.ts", hunks: 2 },
  needs_human: {
    kind: "needs_human",
    question: "Overwrite the existing file?",
    resume: { session: sessionID("sess_sample"), seq: 7 },
  },
  resolved: {
    kind: "resolved",
    question: eventID("evt_sample_question"),
    resolution: "answered",
    content: { type: "text", text: "Yes, overwrite it." },
  },
  finished: {
    kind: "finished",
    claim: { result: "done", summary: "answered" },
    stopReason: "end_turn",
  },
  degraded: { kind: "degraded", missing: ["TraceSink"] },
  unknown: { kind: "unknown", originalKind: "acp/party_mode", raw: { confetti: true } },
})

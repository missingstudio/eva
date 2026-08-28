import type { Cursor, EventID } from "./id.js"

export type EmbeddedResource =
  | { readonly uri: string; readonly mimeType?: string; readonly text: string }
  | { readonly uri: string; readonly mimeType?: string; readonly blob: string }

export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image"
      readonly data: string
      readonly mimeType: string
      readonly uri?: string
    }
  | { readonly type: "audio"; readonly data: string; readonly mimeType: string }
  | {
      readonly type: "resource_link"
      readonly uri: string
      readonly name: string
      readonly mimeType?: string
      readonly size?: number
    }
  | { readonly type: "resource"; readonly resource: EmbeddedResource }

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other"

// How a tool call ended. Each one is data the model can recover from.
export type Disposition =
  | "ok"
  | "denied"
  | "failed"
  | "skipped"
  | "cancelled"
  | "unknown_tool"
  | "budget_denied"

// How a Question ended. A Question with no Resolution is still open.
export type Resolution = "answered" | "rejected" | "expired" | "cancelled"

// Why an attempt failed. An absent class means nobody classified it.
export type ErrorClass =
  | "rate_limit"
  | "overloaded"
  | "auth_failed"
  | "unreachable"
  | "server_error"
  | "no_such_model"
  | "billing"
  | "other"

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"

export type Result = "done" | "failed"

export interface Claim {
  readonly result: Result
  readonly summary?: string
  // Absent means nobody classified the failure, which is not `other`.
  readonly errorClass?: ErrorClass
}

/**
 * What came of judging one Candidate. `unchecked` is the caller's word, never
 * a Validator's: an empty Slot answers nothing, so the caller writes it and
 * every rate holds it out.
 */
export type Verdict = "valid" | "invalid" | "unchecked"

/**
 * One thing a Candidate got wrong: where, and what the JSON Schema wanted
 * there. `at` is a JSON Pointer and "" is the root. It carries no value found,
 * because the Candidate itself is recorded as `text`, and because Stage 6's
 * redaction should confirm that rule rather than discover it.
 */
export interface Fault {
  readonly at: string
  readonly wanted: string
}

export interface PlanEntry {
  readonly content: string
  readonly priority: "high" | "medium" | "low"
  readonly status: "pending" | "in_progress" | "completed"
}

export interface HarnessCommand {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
}

export interface ConfigOption {
  readonly id: string
  readonly name: string
  readonly value?: string | null
}

/**
 * The sealed payload union. A `switch` over `kind` with no `default` is
 * exhaustive. `unknown` preserves input the schema does not define — a
 * defined ACP update that lands there is a bug.
 *
 * Counters are `null` when the provider did not report them. Silence is
 * not zero. `costTicks` is the provider's own figure in ticks of 1e-10
 * USD, absent when unreported, never computed from tokens.
 */
export type Payload =
  // What a harness can do is negotiated in ACP's own shape, and no harness
  // negotiates yet. A Run records the intent it opened on.
  | { readonly kind: "started"; readonly intent: string }
  | { readonly kind: "text"; readonly block: number; readonly content: ContentBlock }
  | { readonly kind: "thought"; readonly block: number; readonly content: ContentBlock }
  | {
      readonly kind: "message"
      readonly content: ContentBlock
      readonly target: "next-run" | "next-step"
    }
  | {
      readonly kind: "tool_call"
      readonly id: string
      readonly name: string
      readonly tool: ToolKind
      readonly args: unknown
      readonly status: ToolStatus
      readonly redacted: boolean
    }
  | {
      readonly kind: "tool_update"
      readonly id: string
      readonly status: ToolStatus
      readonly content?: readonly ContentBlock[]
    }
  | {
      readonly kind: "tool_result"
      readonly id: string
      readonly name: string
      readonly disposition: Disposition
      readonly bytes: number
    }
  | { readonly kind: "plan"; readonly entries: readonly PlanEntry[] }
  | { readonly kind: "mode"; readonly mode: string; readonly reason?: string }
  | { readonly kind: "commands"; readonly commands: readonly HarnessCommand[] }
  | { readonly kind: "config"; readonly options: readonly ConfigOption[] }
  | {
      readonly kind: "info"
      readonly title?: string
      readonly updatedAt?: string
      /**
       * Whether a person has put this Session away. It is a fact on the
       * record and not a row taken out of a store, so the Trace still
       * rebuilds everything that happened — this included — and a listing
       * that leaves the Session out is a fold rather than an erasure.
       *
       * A level and not an increment: a later record replaces an earlier
       * one, so putting a Session away and taking it back out are the one
       * field saying two things.
       */
      readonly retired?: boolean
      // What the Session has cost so far, as the producer counts it. This is
      // a level and not an increment: a later record replaces an earlier one
      // and nothing adds two together.
      readonly costTicks?: number
    }
  | {
      readonly kind: "usage"
      // Absent when the Provider Turn reported no model. ACP's usage
      // update is one: it reports occupancy and cost, and names nothing.
      readonly model?: string
      readonly inputTokens: number | null
      readonly outputTokens: number | null
      readonly cacheWriteTokens: number | null
      readonly cacheReadTokens: number | null
      readonly reasoningTokens?: number | null
      readonly serverToolTokens?: number | null
      // What this exchange cost. This is an increment, and a fold adds it to
      // the others. A producer that reports a running total says so with
      // `info`, because adding two totals answers with neither.
      readonly costTicks?: number
    }
  | {
      readonly kind: "retry"
      readonly attempt: number
      readonly max: number
      readonly delayMs: number
      readonly errorClass: ErrorClass
    }
  | {
      readonly kind: "verdict"
      /**
       * Which Step of a Workflow produced the Candidate. A projection pairs
       * attempts by this and by the Session, not by the Run, because a
       * Repair is its own Run. It is in the payload and not on the envelope:
       * a key nothing folds by does not earn a place on every record, and
       * only this kind is folded by it.
       */
      readonly step: string
      readonly verdict: Verdict
      /**
       * 1 is the first pass and a Repair is 2. This counts Candidates, so a
       * `retry` record between two attempts does not advance it: that was a
       * Provider Turn that produced nothing, and this one produced an answer.
       */
      readonly attempt: number
      // Every Fault the Validator found, so the Repair is rebuildable from
      // the Trace. Empty unless the verdict is `invalid`.
      readonly faults: readonly Fault[]
    }
  | { readonly kind: "edit"; readonly path: string; readonly hunks: number }
  | { readonly kind: "needs_human"; readonly question: string; readonly resume: Cursor }
  | {
      readonly kind: "resolved"
      // The `needs_human` this answers. The pair is what the inbox folds.
      readonly question: EventID
      readonly resolution: Resolution
      readonly content?: ContentBlock
    }
  | {
      readonly kind: "finished"
      readonly claim: Claim
      // Absent when the Run ended without reaching one — a refused
      // attempt that nothing retried closes with a Claim and no reason.
      readonly stopReason?: StopReason
    }
  | { readonly kind: "degraded"; readonly missing: readonly string[] }
  | { readonly kind: "unknown"; readonly originalKind: string; readonly raw: unknown }

export type Kind = Payload["kind"]

const KINDS = [
  "started",
  "text",
  "thought",
  "message",
  "tool_call",
  "tool_update",
  "tool_result",
  "plan",
  "mode",
  "commands",
  "config",
  "info",
  "usage",
  "retry",
  "verdict",
  "edit",
  "needs_human",
  "resolved",
  "finished",
  "degraded",
  "unknown",
] as const

type KindsCover = [Kind] extends [(typeof KINDS)[number]]
  ? [(typeof KINDS)[number]] extends [Kind]
    ? true
    : never
  : never
const kindsCover: KindsCover = true
void kindsCover

const ERROR_CLASSES = [
  "rate_limit",
  "overloaded",
  "auth_failed",
  "unreachable",
  "server_error",
  "no_such_model",
  "billing",
  "other",
] as const satisfies readonly ErrorClass[]

const DISPOSITIONS = [
  "ok",
  "denied",
  "failed",
  "skipped",
  "cancelled",
  "unknown_tool",
  "budget_denied",
] as const satisfies readonly Disposition[]

const RESOLUTIONS = [
  "answered",
  "rejected",
  "expired",
  "cancelled",
] as const satisfies readonly Resolution[]

const VERDICTS = ["valid", "invalid", "unchecked"] as const satisfies readonly Verdict[]

export const kinds = (): readonly Kind[] => KINDS
export const errorClasses = (): readonly ErrorClass[] => ERROR_CLASSES
export const dispositions = (): readonly Disposition[] => DISPOSITIONS
export const resolutions = (): readonly Resolution[] => RESOLUTIONS
export const verdicts = (): readonly Verdict[] => VERDICTS

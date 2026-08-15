import { readContentBlock } from "@missingstudio/eva-schema"
import { z } from "zod"

/**
 * The pinned protocol. `PROTOCOL_VERSION` is what `initialize` negotiates;
 * `SDK_VERSION` is the named npm release of `@agentclientprotocol/sdk` this
 * package was verified against. A bump of either is a reviewed change.
 */
export const PROTOCOL_VERSION = 1
export const SDK_VERSION = "1.3.0"

// The eleven kinds ACP v1 defines. `plan_update` and `plan_removed` are draft.
export const SESSION_UPDATE_KINDS = [
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
] as const

export type SessionUpdateKind = (typeof SESSION_UPDATE_KINDS)[number]

// Kinds the SDK ships but the spec does not define yet.
export const DRAFT_SESSION_UPDATE_KINDS = ["plan_update", "plan_removed"] as const

export const toolKind = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
])

export const toolCallStatus = z.enum(["pending", "in_progress", "completed", "failed"])

// The set is Eva's `StopReason`, and `toStopReason` is where the two are tied.
export const stopReason = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
])

export const cost = z.object({ amount: z.number(), currency: z.string() })

const toolCallContent = z.union([
  z.object({ type: z.literal("content"), content: readContentBlock }).transform((e) => e.content),
  // A diff or a terminal. The wire carries it and the union has no kind for
  // it, so it reads and does not keep.
  z.object({ type: z.string() }).transform(() => undefined),
])

const planEntry = z.object({
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["pending", "in_progress", "completed"]),
})

const availableCommand = z.object({
  name: z.string(),
  description: z.string(),
  input: z.object({ hint: z.string() }).nullish(),
})

const configOption = z.object({
  id: z.string(),
  name: z.string(),
  currentValue: z.union([z.string(), z.boolean()]).nullish(),
})

// The wire carries `annotations` and `_meta`; the reader keeps neither.
const chunk = { content: readContentBlock }

// One schema per stable kind. The mapping module routes on the discriminant.
export const sessionUpdates = {
  user_message_chunk: z.object(chunk),
  agent_message_chunk: z.object(chunk),
  agent_thought_chunk: z.object(chunk),
  tool_call: z.object({
    toolCallId: z.string(),
    title: z.string(),
    name: z.string().nullish(),
    kind: toolKind.nullish(),
    status: toolCallStatus.nullish(),
    rawInput: z.unknown(),
  }),
  tool_call_update: z.object({
    toolCallId: z.string(),
    status: toolCallStatus.nullish(),
    content: z.array(toolCallContent).nullish(),
  }),
  plan: z.object({ entries: z.array(planEntry) }),
  available_commands_update: z.object({ availableCommands: z.array(availableCommand) }),
  current_mode_update: z.object({ currentModeId: z.string() }),
  config_option_update: z.object({ configOptions: z.array(configOption) }),
  session_info_update: z.object({
    title: z.string().nullish(),
    updatedAt: z.string().nullish(),
  }),
  usage_update: z.object({
    used: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    cost: cost.nullish(),
  }),
} satisfies Record<SessionUpdateKind, z.ZodType>

export interface AgentCapabilities {
  readonly loadSession?: boolean
  readonly auth?: { readonly logout?: boolean }
  readonly promptCapabilities?: {
    readonly image?: boolean
    readonly audio?: boolean
    readonly embeddedContext?: boolean
  }
  readonly sessionCapabilities?: {
    readonly resume?: boolean
    readonly fork?: boolean
    readonly list?: boolean
    readonly close?: boolean
  }
  readonly mcpCapabilities?: { readonly http?: boolean; readonly sse?: boolean }
}

export interface ClientCapabilities {
  readonly fs?: { readonly readTextFile?: boolean; readonly writeTextFile?: boolean }
  readonly terminal?: boolean
  readonly auth?: { readonly terminal?: boolean }
  readonly elicitation?: { readonly form?: boolean; readonly url?: boolean }
}

export interface PermissionRequest {
  readonly sessionId: string
  readonly toolCall: { readonly toolCallId: string; readonly title: string }
  readonly options: readonly {
    readonly optionId: string
    readonly name: string
    readonly kind: PermissionOutcome["kind"]
  }[]
}

// The "always" axis is persistence, not strictness.
export type PermissionOutcome =
  | { readonly kind: "allow_once" }
  | { readonly kind: "allow_always" }
  | { readonly kind: "reject_once"; readonly reason: string }
  | { readonly kind: "reject_always"; readonly reason: string }

const jsonrpcId = z.union([z.string(), z.number().int()])

export const jsonrpcRequest = z.looseObject({
  jsonrpc: z.literal("2.0"),
  id: jsonrpcId,
  method: z.string(),
  params: z.unknown().optional(),
})

export const jsonrpcNotification = z.looseObject({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
})

export const jsonrpcResponse = z.union([
  z.looseObject({ jsonrpc: z.literal("2.0"), id: jsonrpcId, result: z.unknown() }),
  z.looseObject({
    jsonrpc: z.literal("2.0"),
    id: jsonrpcId,
    error: z.looseObject({ code: z.number().int(), message: z.string() }),
  }),
])

export const jsonrpcMessage = z.union([jsonrpcResponse, jsonrpcRequest, jsonrpcNotification])
export type JsonRpcMessage = z.infer<typeof jsonrpcMessage>

export class FramingError extends Error {
  override readonly name = "FramingError"
}

// Stdio framing is newline-delimited JSON. One message, one line.
export const encodeMessage = (message: JsonRpcMessage): string => JSON.stringify(message)
export const decodeMessage = (line: string): JsonRpcMessage => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new FramingError(`invalid JSON-RPC line: ${(cause as Error).message}`)
  }
  const parsed = jsonrpcMessage.safeParse(value)
  if (!parsed.success) throw new FramingError(`not a JSON-RPC message: ${parsed.error.message}`)
  return parsed.data
}

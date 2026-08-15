import { toTicks, type Payload, type StopReason } from "@missingstudio/eva-schema"
import { Stream } from "effect"
import type { z } from "zod"
import { sessionUpdates, stopReason, type SessionUpdateKind } from "./protocol.js"

/**
 * ACP reports a cumulative session cost as a decimal amount with a currency.
 * Only USD converts, because `costTicks` is defined in USD and a converted
 * figure would not be the provider's own. Anything else stays unreported.
 */
const toCostTicks = (cost: { amount: number; currency: string } | null | undefined) =>
  cost == null || cost.currency.toUpperCase() !== "USD" ? {} : { costTicks: toTicks(cost.amount) }

type Mapped = { [K in SessionUpdateKind]: (update: z.infer<(typeof sessionUpdates)[K]>) => Payload }

/**
 * One stable kind, one payload kind. The table is total by its type, so a
 * kind the protocol defines cannot be left without somewhere to go.
 *
 * The `block` a chunk carries is a placeholder. ACP sends no block index, so
 * `payloads` assigns it from the stream and nothing reads the zero below.
 */
const mappers: Mapped = {
  // ACP carries no steering target, so the plain user message takes the default.
  user_message_chunk: (update) => ({
    kind: "message",
    content: update.content,
    target: "next-run",
  }),
  agent_message_chunk: (update) => ({ kind: "text", block: 0, content: update.content }),
  agent_thought_chunk: (update) => ({ kind: "thought", block: 0, content: update.content }),
  tool_call: (update) => ({
    kind: "tool_call",
    id: update.toolCallId,
    name: update.name ?? update.title,
    tool: update.kind ?? "other",
    args: update.rawInput,
    status: update.status ?? "pending",
    redacted: false,
  }),
  // An update with no status is a content-only report on running work.
  tool_call_update: (update) => {
    const blocks = (update.content ?? []).filter((entry) => entry !== undefined)
    return {
      kind: "tool_update",
      id: update.toolCallId,
      status: update.status ?? "in_progress",
      ...(blocks.length === 0 ? {} : { content: blocks }),
    }
  },
  plan: (update) => ({
    kind: "plan",
    entries: update.entries.map((entry) => ({
      content: entry.content,
      priority: entry.priority,
      status: entry.status,
    })),
  }),
  available_commands_update: (update) => ({
    kind: "commands",
    commands: update.availableCommands.map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.input == null ? {} : { input: { hint: command.input.hint } }),
    })),
  }),
  current_mode_update: (update) => ({ kind: "mode", mode: update.currentModeId }),
  config_option_update: (update) => ({
    kind: "config",
    options: update.configOptions.map((option) => ({
      id: option.id,
      name: option.name,
      ...(option.currentValue == null ? {} : { value: String(option.currentValue) }),
    })),
  }),
  session_info_update: (update) => ({
    kind: "info",
    ...(update.title == null ? {} : { title: update.title }),
    ...(update.updatedAt == null ? {} : { updatedAt: update.updatedAt }),
  }),
  /**
   * ACP reports context occupancy and a cost, never a token split. The cost
   * is the session's cumulative one, so it goes to `info`, which is the
   * level: a `usage` cost is what one exchange cost and a fold adds those,
   * and adding running totals answers with neither. The occupancy figures
   * have no kind in the union and are not recorded.
   */
  usage_update: (update) => ({ kind: "info", ...toCostTicks(update.cost) }),
}

const isStable = (kind: string): kind is SessionUpdateKind => kind in sessionUpdates

/**
 * Maps one ACP session update to exactly one payload kind. Input the protocol
 * does not define — a draft kind, a foreign kind, or a body that fails its
 * own schema — is preserved as `unknown` rather than dropped.
 *
 * Package-private: `payloads` is the interface, because the block index a
 * chunk carries is only knowable from the stream.
 */
export const toPayload = (update: unknown): Payload => {
  const kind = (update as { sessionUpdate?: unknown } | null)?.sessionUpdate
  if (typeof kind !== "string") {
    return { kind: "unknown", originalKind: "", raw: update }
  }

  if (!isStable(kind)) {
    return { kind: "unknown", originalKind: kind, raw: update }
  }

  const parsed = sessionUpdates[kind].safeParse(update)
  if (!parsed.success) {
    return { kind: "unknown", originalKind: kind, raw: update }
  }

  const mapper = mappers[kind] as (value: unknown) => Payload
  return mapper(parsed.data)
}

interface Blocks {
  readonly index: number
  // The chunk kind the open block holds. Absent when no block is open.
  readonly open?: "text" | "thought"
}

/**
 * The block index ACP does not carry. A block holds chunks of one kind, so it
 * advances when the kind changes, and anything that is not a chunk closes the
 * block it interrupts — a tool call between two runs of text makes two blocks.
 */
const advance = (state: Blocks, payload: Payload): readonly [Blocks, Payload] => {
  if (payload.kind !== "text" && payload.kind !== "thought") {
    return [state.open === undefined ? state : { index: state.index + 1 }, payload]
  }

  const index =
    state.open === undefined || state.open === payload.kind ? state.index : state.index + 1
  return [
    { index, open: payload.kind },
    { ...payload, block: index },
  ]
}

/**
 * One ACP session update stream, one Payload stream. Adjacency is a fact of
 * the stream, so the stream is what owns the block index — a caller mapping
 * one update at a time could only ever say block zero, and the Recorder
 * groups its commits by that number.
 */
export const payloads = <E, R>(
  updates: Stream.Stream<unknown, E, R>,
): Stream.Stream<Payload, E, R> =>
  Stream.mapAccum(
    updates,
    (): Blocks => ({ index: 0 }),
    (state, update) => {
      const [next, payload] = advance(state, toPayload(update))
      return [next, [payload]] as const
    },
  )

/**
 * The Stop Reason that ends a prompt turn. It arrives on the `session/prompt`
 * result rather than as a session update, so it needs a mapper of its own —
 * and the return type is what ties ACP's five reasons to Eva's.
 *
 * A reason the protocol does not define is absent rather than guessed: a Run
 * closes with a Claim, and `finished.stopReason` says nothing it was not told.
 */
export const toStopReason = (result: unknown): StopReason | undefined => {
  const parsed = stopReason.safeParse((result as { stopReason?: unknown } | null)?.stopReason)
  return parsed.success ? parsed.data : undefined
}

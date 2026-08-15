import { estimateTicks, type PriceLookup } from "./cost.js"
import { sameFoldKeys, type Event } from "./event.js"
import type { ActorKind } from "./id.js"
import type { ContentBlock, Disposition, ToolKind, ToolStatus } from "./payload.js"

const isText = (content: ContentBlock): content is Extract<ContentBlock, { type: "text" }> =>
  content.type === "text"

type ChunkKind = "text" | "thought"
type Chunk = Extract<Event["payload"], { kind: ChunkKind }>

const chunkOf = (event: Event, kinds: readonly ChunkKind[]): Chunk | undefined => {
  const payload = event.payload
  const chunked = payload.kind === "text" || payload.kind === "thought"
  return chunked && kinds.includes(payload.kind) ? payload : undefined
}

/**
 * The one coalescing rule. Two chunks merge only when they are the same
 * kind, every envelope fold key and the block index match, and both
 * contents are plain text. The merged event keeps the first chunk's id,
 * wire position, and timestamp: that stamp is where time to first token is
 * measured.
 *
 * Which kinds coalesce is the caller's, because the Trace and the
 * transcript answer that differently.
 */
const coalesce = (events: readonly Event[], kinds: readonly ChunkKind[]): readonly Event[] => {
  const out: Event[] = []
  for (const event of events) {
    const last = out[out.length - 1]
    const into = last === undefined ? undefined : chunkOf(last, kinds)
    const from = chunkOf(event, kinds)
    if (
      last !== undefined &&
      into !== undefined &&
      from !== undefined &&
      into.kind === from.kind &&
      sameFoldKeys(last, event) &&
      into.block === from.block &&
      isText(into.content) &&
      isText(from.content)
    ) {
      out[out.length - 1] = {
        ...last,
        payload: {
          ...into,
          content: { type: "text", text: into.content.text + from.content.text },
        },
      }
    } else {
      out.push(event)
    }
  }
  return out
}

// What the Trace coalesces. A `thought` stays one record per chunk, so
// nothing collapses reasoning before it is written down.
export const mergeText = (events: readonly Event[]): readonly Event[] => coalesce(events, ["text"])

export interface CostSummary {
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly cacheReadTokens: number | null
  readonly reasoningTokens: number | null
  readonly serverToolTokens: number | null
  // What a Provider reported. Null when none did, which is not zero.
  readonly costTicks: number | null
  // What the counters come to at catalog rates. Never a Cost, never written
  // down, and null when any record cannot be priced.
  readonly estimatedCostTicks: number | null
}

/**
 * Which figure a reader is shown, and what kind it is. The four are a closed
 * set, so a surface switches over them and formats each; none of them decides
 * between them, and none can quietly show an estimate as a reported figure.
 */
export type Spend =
  | { readonly kind: "none" }
  | { readonly kind: "reported"; readonly ticks: number }
  | { readonly kind: "estimated"; readonly ticks: number }
  | { readonly kind: "unreported" }

/**
 * `ran` is whether the Session has done anything. A Session that has not run
 * has spent nothing, which is not a spend nobody reported — one answer for
 * both tells a reader the Provider is silent when it has not been asked.
 */
export const spendOf = (summary: CostSummary, ran: boolean): Spend => {
  if (!ran) return { kind: "none" }
  if (summary.costTicks !== null) return { kind: "reported", ticks: summary.costTicks }
  if (summary.estimatedCostTicks !== null) {
    return { kind: "estimated", ticks: summary.estimatedCostTicks }
  }
  return { kind: "unreported" }
}

const EMPTY_COST: CostSummary = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
  serverToolTokens: null,
  costTicks: null,
  estimatedCostTicks: null,
}

const addCounter = (total: number | null, reported: number | null | undefined, first: boolean) => {
  if (reported === null || reported === undefined || (!first && total === null)) return null
  return (first ? 0 : (total as number)) + reported
}

/**
 * Sums usage records. One silent record suppresses that counter's total,
 * because a partial sum is never shown. Silence is not zero.
 *
 * Cost has two shapes and they do not add. A `usage` cost is what one
 * exchange cost, and the sum of them is the session's. An `info` cost is
 * what the producer says the session has cost so far, so the last one is the
 * answer and the sum of the exchanges is not consulted at all — a producer
 * reports one shape or the other, never both.
 *
 * `priceOf` adds the estimate, which is a separate answer to a separate
 * question: what the counters come to at catalog rates. It never merges into
 * `costTicks`, so a derived figure cannot be read as a reported one. One
 * record this fold cannot price nulls the whole estimate, because a partial
 * estimate misleads exactly as a partial sum does.
 */
export const costFold = (events: readonly Event[], priceOf?: PriceLookup): CostSummary => {
  let total = EMPTY_COST
  let first = true
  let reported: number | undefined
  let estimated: number | null = priceOf === undefined ? null : 0
  let priced = false
  for (const event of events) {
    if (event.payload.kind === "info") {
      reported = event.payload.costTicks ?? reported
      continue
    }
    if (event.payload.kind !== "usage") continue
    const usage = event.payload
    if (priceOf !== undefined && estimated !== null) {
      const price = usage.model === undefined ? undefined : priceOf(usage.model)
      if (price === undefined) estimated = null
      else {
        estimated += estimateTicks(usage, price)
        priced = true
      }
    }
    total = {
      inputTokens: addCounter(total.inputTokens, usage.inputTokens, first),
      outputTokens: addCounter(total.outputTokens, usage.outputTokens, first),
      cacheWriteTokens: addCounter(total.cacheWriteTokens, usage.cacheWriteTokens, first),
      cacheReadTokens: addCounter(total.cacheReadTokens, usage.cacheReadTokens, first),
      reasoningTokens: addCounter(total.reasoningTokens, usage.reasoningTokens, first),
      serverToolTokens: addCounter(total.serverToolTokens, usage.serverToolTokens, first),
      costTicks: addCounter(total.costTicks, usage.costTicks, first),
      // Carried, not summed here. The estimate is settled at the return.
      estimatedCostTicks: total.estimatedCostTicks,
    }
    first = false
  }
  return {
    ...total,
    ...(reported === undefined ? {} : { costTicks: reported }),
    estimatedCostTicks: priced ? estimated : null,
  }
}

// What a Session says about itself: what to call it, and when it last
// moved. Both are in the Trace, so a listing is a fold like any other.
export interface Header {
  readonly title?: string
  readonly updatedAt?: string
}

/**
 * Folds one session's events into its Header. An `info` record answers
 * both questions and a later one wins; the intent a Run opened on is the
 * title until an `info` gives a better one.
 */
export const headerFold = (events: readonly Event[]): Header => {
  let title: string | undefined
  let updatedAt: string | undefined
  for (const event of events) {
    if (event.payload.kind === "info") {
      title = event.payload.title ?? title
      updatedAt = event.payload.updatedAt ?? updatedAt
    }
    if (title === undefined && event.payload.kind === "started") {
      title = event.payload.intent
    }
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

export type TranscriptBlock =
  | { readonly type: "content"; readonly block: number; readonly content: ContentBlock }
  | { readonly type: "thought"; readonly block: number; readonly content: ContentBlock }
  | {
      readonly type: "tool"
      readonly id: string
      readonly name: string
      readonly tool: ToolKind
      readonly status: ToolStatus
      readonly disposition?: Disposition
    }

export interface TranscriptMessage {
  readonly author: ActorKind
  readonly blocks: readonly TranscriptBlock[]
}

interface MutableMessage {
  author: ActorKind
  blocks: TranscriptBlock[]
}

/**
 * Folds one session's events, in trace order, into messages. Payload kinds
 * that are not conversation content (usage, retry, mode, and the rest) do
 * not appear in the transcript.
 *
 * A reader sees continuous prose, so this coalesces both chunk kinds first
 * rather than merging blocks as it goes. The Fold Keys guard then covers
 * the transcript too: two Runs that reuse a block index stay apart.
 */
export const transcriptFold = (events: readonly Event[]): readonly TranscriptMessage[] => {
  const messages: MutableMessage[] = []
  const tools = new Map<string, { message: MutableMessage; index: number }>()

  const push = (message: MutableMessage) => {
    messages.push(message)
    return message
  }

  const agentTail = (): MutableMessage => {
    const last = messages[messages.length - 1]
    return last !== undefined && last.author === "agent"
      ? last
      : push({ author: "agent", blocks: [] })
  }

  const appendContent = (type: "content" | "thought", block: number, content: ContentBlock) => {
    agentTail().blocks.push({ type, block, content })
  }

  for (const event of coalesce(events, ["text", "thought"])) {
    const payload = event.payload
    switch (payload.kind) {
      case "started":
        push({
          author: "human",
          blocks: [{ type: "content", block: 0, content: { type: "text", text: payload.intent } }],
        })
        break
      case "message":
        push({ author: "human", blocks: [{ type: "content", block: 0, content: payload.content }] })
        break
      case "text":
        appendContent("content", payload.block, payload.content)
        break
      case "thought":
        appendContent("thought", payload.block, payload.content)
        break
      case "tool_call": {
        const message = agentTail()
        message.blocks.push({
          type: "tool",
          id: payload.id,
          name: payload.name,
          tool: payload.tool,
          status: payload.status,
        })
        tools.set(payload.id, { message, index: message.blocks.length - 1 })
        break
      }
      case "tool_update": {
        const found = tools.get(payload.id)
        if (found !== undefined) {
          const block = found.message.blocks[found.index] as Extract<
            TranscriptBlock,
            { type: "tool" }
          >
          found.message.blocks[found.index] = { ...block, status: payload.status }
        }
        break
      }
      case "tool_result": {
        const found = tools.get(payload.id)
        if (found !== undefined) {
          const block = found.message.blocks[found.index] as Extract<
            TranscriptBlock,
            { type: "tool" }
          >
          found.message.blocks[found.index] = { ...block, disposition: payload.disposition }
        }
        break
      }
      default:
        break
    }
  }
  return messages
}

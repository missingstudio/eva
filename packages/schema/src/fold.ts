import { estimateTicks, type PriceLookup } from "./cost.js"
import { sameFoldKeys, type Event } from "./event.js"
import type { ActorKind } from "./id.js"
import type { Claim, ContentBlock, Disposition, ToolKind, ToolStatus, Verdict } from "./payload.js"

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
 * The identity of the `headerStep` rule below. A store that keeps a Header
 * beside the Trace records this number with it, so a row written under an
 * older rule is found and folded again rather than read as current. Bump it
 * in the same commit that changes `headerStep`.
 */
export const HEADER_RULE = 2

/**
 * One event applied to a Header, so a store that keeps a Header beside the
 * Trace applies the same rule the fold does. The intent a Run opened on is
 * the title until an `info` gives a better one, and a later `info` wins.
 * Every event moves `updatedAt` to its own wall time, because a commit is
 * the Session moving; an `info` that carries an explicit one says better.
 */
export const headerStep = (header: Header, event: Event): Header => {
  const payload = event.payload
  const title =
    payload.kind === "info"
      ? (payload.title ?? header.title)
      : (header.title ?? (payload.kind === "started" ? payload.intent : undefined))
  const updatedAt =
    payload.kind === "info" && payload.updatedAt !== undefined ? payload.updatedAt : event.at.wall
  return { ...(title === undefined ? {} : { title }), updatedAt }
}

// Folds one session's events into its Header, one `headerStep` at a time.
export const headerFold = (events: readonly Event[]): Header =>
  events.reduce(headerStep, {} as Header)

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
  /**
   * A file the Run changed: the path, and how many hunks changed in it. That
   * is the whole of what the record holds, so that is the whole of what this
   * carries — the hunk text arrives when the edit tools ship, and this block
   * does not change shape when it does.
   */
  | { readonly type: "edit"; readonly path: string; readonly hunks: number }
  /**
   * The permission mode the Session runs under, from the moment it changed.
   * A mode is a fact on the record and not only a change in behaviour, so a
   * reader who scrolls back reads which mode each Run was made under.
   */
  | { readonly type: "mode"; readonly mode: string; readonly reason?: string }
  /**
   * A payload kind the schema does not define. It is still something the Run
   * said, so the fold keeps it: `originalKind` is what it was and `raw` is
   * what it said. A renderer draws that it could not draw it, which is a
   * renderer that renders less; dropping it here would be every Surface
   * knowing less, and nothing later would say there had been one.
   */
  | { readonly type: "unknown"; readonly originalKind: string; readonly raw: unknown }

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
 * not appear in the transcript. A kind the schema does not define is not one
 * of those: nothing here can say it was not content, so it is kept.
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
      // A file the Run changed is something the Run did, so the turn says
      // so. A reader who cannot see it reads a transcript that leaves the
      // work out.
      case "edit":
        agentTail().blocks.push({ type: "edit", path: payload.path, hunks: payload.hunks })
        break
      // Which mode the Session runs under, and why it changed. It is a thing
      // the Run did, for the reason an edit is: a transcript that left it out
      // would show writes being refused and never say what refused them.
      case "mode":
        agentTail().blocks.push({
          type: "mode",
          mode: payload.mode,
          ...(payload.reason === undefined ? {} : { reason: payload.reason }),
        })
        break
      // The codec parks a wire kind it does not recognise here. It survives
      // the fold as what it was, so a Surface can say the record holds one.
      case "unknown":
        agentTail().blocks.push({
          type: "unknown",
          originalKind: payload.originalKind,
          raw: payload.raw,
        })
        break
      default:
        break
    }
  }
  return messages
}

/**
 * What a run of Candidates came to. Five counters, and each one is divided by
 * or reported. There is no `settledInvalid` and no `repaired`: both are
 * arithmetic on these, and a counter nothing divides by does not land.
 *
 * A Candidate is the run of `verdict` records with the same Session and the
 * same `step`, whose `attempt` starts at 1 and rises by one. An attempt that
 * returns to 1 starts the next Candidate. The Run is not part of the key,
 * because a Repair is its own Run.
 */
export interface VerdictSummary {
  // Candidates that were judged on their first pass, in a Run that lost no
  // slot. The denominator of both ratios.
  readonly firstPass: number
  // Of those, how many conformed at once. Records with attempt 1 and verdict
  // `valid`.
  readonly firstPassValid: number
  // Of those, how many reached `valid` at any attempt. Post-repair validity is
  // this over `firstPass`, so the two ratios share one denominator.
  readonly settledValid: number
  /**
   * Candidates nothing judged, because the Validator slot was empty. Held out
   * of both ratios and reported, so an absent Validator lowers coverage and
   * can never raise the rate.
   */
  readonly unchecked: number
  /**
   * Candidates from a Run that committed any `degraded` record. Held out of
   * both ratios and reported, because Eva keeps Degraded data, marks it, and
   * holds it out of eval scoring. An `unchecked` Candidate is normally held
   * too — the caller reports `degraded` naming `Validator` — so the two
   * counters overlap on purpose and neither enters a ratio.
   */
  readonly held: number
}

interface Candidate {
  // The verdict of the attempt-1 record. Null when the trace lost it, which
  // keeps an interrupted Candidate out of the denominator.
  first: Verdict | null
  settledValid: boolean
  held: boolean
}

export const verdictFold = (events: readonly Event[]): VerdictSummary => {
  // A `degraded` record can land after the verdicts of its Run, so the held
  // mark needs the whole trace before any Candidate is tallied.
  const degradedRuns = new Set<string>()
  for (const event of events) {
    if (event.payload.kind === "degraded") degradedRuns.add(event.run)
  }

  const candidates: Candidate[] = []
  const open = new Map<string, Candidate>()
  for (const event of events) {
    if (event.payload.kind !== "verdict") continue
    const record = event.payload
    const key = `${event.session}\u0000${record.step}`
    let candidate = open.get(key)
    if (candidate === undefined || record.attempt === 1) {
      candidate = {
        first: record.attempt === 1 ? record.verdict : null,
        settledValid: false,
        held: false,
      }
      candidates.push(candidate)
      open.set(key, candidate)
    }
    candidate.settledValid ||= record.verdict === "valid"
    candidate.held ||= degradedRuns.has(event.run)
  }

  let firstPass = 0
  let firstPassValid = 0
  let settledValid = 0
  let unchecked = 0
  let held = 0
  for (const candidate of candidates) {
    if (candidate.held) held += 1
    if (candidate.first === "unchecked") unchecked += 1
    if (candidate.held || candidate.first === "unchecked" || candidate.first === null) continue
    firstPass += 1
    if (candidate.first === "valid") firstPassValid += 1
    if (candidate.settledValid) settledValid += 1
  }
  return { firstPass, firstPassValid, settledValid, unchecked, held }
}

/**
 * A rate over nothing is not zero. This mirrors `spendOf`, so a measurement
 * that judged nothing cannot print 0% or 100%.
 */
export type Validity =
  | { readonly kind: "none" }
  | { readonly kind: "rate"; readonly valid: number; readonly of: number }

// First-pass validity. `of` is `firstPass`, the one denominator: post-repair
// validity is `settledValid` over the same figure, never over a second one.
export const validityOf = (summary: VerdictSummary): Validity =>
  summary.firstPass === 0
    ? { kind: "none" }
    : { kind: "rate", valid: summary.firstPassValid, of: summary.firstPass }

/**
 * What a Harness answered: the Claim the Run that closed last carries, and
 * the text that Run wrote. A Workflow is many Runs and each one closes, so
 * the earlier Runs stay on the Trace and the answer is the last one's.
 *
 * An absent Claim is a record no Run closed in. It is not a failed Claim —
 * the caller says in its own words what an empty record means to it.
 */
export interface Answer {
  readonly claim?: Claim
  // Empty when the Run that closed last wrote no text.
  readonly text: string
}

export const answerFold = (events: readonly Event[]): Answer => {
  let claim: Claim | undefined
  let text = ""
  // The Run in hand. A `started` opens one, so its text never carries over.
  let buffered = ""
  for (const { payload } of events) {
    if (payload.kind === "started") buffered = ""
    if (payload.kind === "text" && payload.content.type === "text") {
      buffered += payload.content.text
    }
    if (payload.kind === "finished") {
      claim = payload.claim
      text = buffered
    }
  }
  return claim === undefined ? { text } : { claim, text }
}

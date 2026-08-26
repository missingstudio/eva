import type {
  ContentBlock,
  Disposition,
  Payload,
  SessionID,
  ToolKind,
  ToolStatus,
} from "@missingstudio/eva-schema"
import { Effect } from "effect"

/**
 * What a tool answers. Every ending is a result: a tool that could not do the
 * work says so in its Disposition rather than failing, because each
 * Disposition is data the model can recover from.
 */
export interface ToolResult {
  readonly disposition: Disposition
  readonly content: readonly ContentBlock[]
}

// A result of one text block, which is what a tool answers.
export const toolText = (disposition: Disposition, text: string): ToolResult => ({
  disposition,
  content: [{ type: "text", text }],
})

/**
 * One tool, as a row of the tool domain. The row carries the action the way
 * `CommandInfo.run` and `HarnessInfo.open` do, so a row with no `execute`
 * names a tool the build knows of and cannot run.
 *
 * `id` is the name the model calls: `eva.tool.read` registers `read`.
 * `input` is the JSON Schema the model is shown, typed the way a Validator
 * types a schema — it is data on its way to a provider, and nothing here
 * reads it.
 */
export interface ToolInfo {
  id: string
  description: string
  kind: ToolKind
  input: unknown
  execute?: (input: unknown) => Effect.Effect<ToolResult>
}

/**
 * What a hook at `tool.execute.before` may decide. These are ACP's four
 * options plus the question, so a foreign harness plugs into this gate rather
 * than getting one of its own.
 *
 * `ask` is not a final answer: a gate that can reach a person resolves it
 * into one of the other four, and a call that reaches the tool still holding
 * an `ask` is denied — a permission request with nobody to answer it is a
 * denial.
 */
export type ToolDecision =
  | { readonly kind: "allow_once" }
  | { readonly kind: "allow_always" }
  | { readonly kind: "reject_once"; readonly reason: string }
  | { readonly kind: "reject_always"; readonly reason: string }
  | { readonly kind: "ask"; readonly question: string }

/**
 * How restrictive each decision is. `ask` outranks both allows because a call
 * nobody has answered for does not run, and a repo profile may therefore
 * narrow a mandate and never widen it.
 */
const STRICTNESS: Record<ToolDecision["kind"], number> = {
  reject_always: 4,
  reject_once: 3,
  ask: 2,
  allow_once: 1,
  allow_always: 0,
}

/**
 * The strictest decision the boundary reached, or nothing when no hook
 * decided — which allows, because a hook nobody registered is a no-op and not
 * a missing feature. A tie keeps the earlier decision, so the reason that
 * reaches the model is the first hook's.
 */
export const strictest = (decisions: readonly ToolDecision[]): ToolDecision | undefined =>
  decisions.reduce<ToolDecision | undefined>(
    (held, one) =>
      held === undefined || STRICTNESS[one.kind] > STRICTNESS[held.kind] ? one : held,
    undefined,
  )

// Why the boundary denied, or nothing when the call may run.
const denial = (decision: ToolDecision | undefined): string | undefined => {
  if (decision === undefined) return undefined
  switch (decision.kind) {
    case "allow_once":
    case "allow_always":
      return undefined
    case "ask":
      return `nobody answered: ${decision.question}`
    case "reject_once":
    case "reject_always":
      return decision.reason
  }
}

export interface ToolCall {
  // The call id, and the join key of every record of the call. Not an EventID.
  readonly id: string
  readonly name: string
  readonly args: unknown
  readonly session: SessionID
}

// What the deciding boundary settled: the arguments its hooks left, and the
// strictest decision any of them made.
export interface Decided {
  readonly args: unknown
  readonly decision?: ToolDecision
}

/**
 * The dependencies one tool call reads. Each one is a late read, for the
 * reason `RunDeps` are: a plugin that replaced a tool row or registered a
 * hook takes effect on the next call.
 */
export interface ToolDeps {
  // Which tool answers this name, after `tool.resolve`. Nothing is a refusal.
  readonly tool: (call: ToolCall) => Effect.Effect<ToolInfo | undefined>
  // The deciding boundary. Absent means nothing decides and the call runs.
  readonly beforeExecute?: (call: ToolCall) => Effect.Effect<Decided>
  readonly afterExecute?: (call: ToolCall, result: ToolResult) => Effect.Effect<ToolResult>
  // Where the records of the call go, in order.
  readonly emit: (payload: Payload) => Effect.Effect<void>
}

const bytesIn = (text: string): number => new TextEncoder().encode(text).length

const sizeOf = (block: ContentBlock): number => {
  switch (block.type) {
    case "text":
      return bytesIn(block.text)
    case "image":
    case "audio":
      return bytesIn(block.data)
    case "resource_link":
      return bytesIn(block.uri)
    case "resource":
      return bytesIn("text" in block.resource ? block.resource.text : block.resource.blob)
  }
}

// How much the result carried, so a fold reads the size without the content.
const bytesOf = (content: readonly ContentBlock[]): number =>
  content.reduce((total, block) => total + sizeOf(block), 0)

// A call is completed only when it did the work. Every other ending failed,
// and its Disposition says which ending it was.
const statusOf = (disposition: Disposition): ToolStatus =>
  disposition === "ok" ? "completed" : "failed"

/**
 * One tool call, from the name the model wrote to the three records it
 * leaves: `tool_call`, then the closing `tool_update`, then `tool_result`.
 * The call record lands before the tool runs and before any update or result,
 * because a fold joins the three by the call id and drops an orphan without a
 * word.
 *
 * It records the arguments the tool really ran with, so the record is emitted
 * once the deciding boundary has settled them. The schema carries arguments
 * in one place, and a record naming arguments nothing ran with is a lie no
 * fold can correct.
 *
 * Nothing here throws. A name nothing answers, a boundary that denied, and a
 * tool that failed are all Dispositions.
 */
export const executeTool = Effect.fn("core.tool")(function* (deps: ToolDeps, call: ToolCall) {
  const opened = (tool: ToolKind, args: unknown) =>
    deps.emit({
      kind: "tool_call",
      id: call.id,
      name: call.name,
      tool,
      args,
      status: "pending",
      redacted: false,
    })

  const closed = Effect.fn("core.tool.close")(function* (result: ToolResult) {
    yield* deps.emit({
      kind: "tool_update",
      id: call.id,
      status: statusOf(result.disposition),
      ...(result.content.length === 0 ? {} : { content: result.content }),
    })
    yield* deps.emit({
      kind: "tool_result",
      id: call.id,
      name: call.name,
      disposition: result.disposition,
      bytes: bytesOf(result.content),
    })
    return result
  })

  const found = yield* deps.tool(call)
  if (found?.execute === undefined) {
    yield* opened("other", call.args)
    return yield* closed(
      toolText(
        "unknown_tool",
        found === undefined
          ? `no tool named ${call.name} is registered`
          : `the tool named ${call.name} is registered and cannot run`,
      ),
    )
  }

  const settled =
    deps.beforeExecute === undefined ? { args: call.args } : yield* deps.beforeExecute(call)
  yield* opened(found.kind, settled.args)

  const refused = denial(settled.decision)
  if (refused !== undefined) return yield* closed(toolText("denied", refused))

  const answered = yield* found.execute(settled.args)
  // The observing boundary reads what the tool answered. A denial never
  // reaches it: a hook that could rewrite one into an allow is not a gate.
  const result =
    deps.afterExecute === undefined ? answered : yield* deps.afterExecute(call, answered)
  return yield* closed(result)
})

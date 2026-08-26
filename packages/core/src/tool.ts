import type { PermissionOutcome, PermissionRequest } from "@missingstudio/eva-acp"
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
 * ACP's permission types, re-exported: `Approving` names both in its own
 * signature, so anything that fills or calls the gate reaches them from here
 * rather than depending on the protocol package for two type names.
 */
export type { PermissionOutcome, PermissionRequest }

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
 * What one call gives the tool beside its arguments.
 *
 * There is no `stop` here. Nothing cancels a call yet: a per-call stop is
 * wired to `SessionAPI.cancel` when that arrives, and an optional field
 * nothing fills is scaffolding a reader has to guess about.
 */
export interface ToolContext {
  // The call id every record of this call joins on. Not an EventID.
  readonly id: string
  /**
   * Records the tool writes while it works. The pipeline owns `tool_call`,
   * the closing `tool_update`, and `tool_result`; a tool that works for a
   * while says so in between.
   */
  readonly emit: (payload: Payload) => Effect.Effect<void>
}

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
  /**
   * Whether this call may run beside another one. The runtime classifies
   * parallel safety and the model never does, so the claim is the tool's own
   * — and it reads the arguments, because a tool that is safe for one input
   * and not for another says which is which per call.
   *
   * A row that carries none is unclassified and runs alone. Nothing widens
   * that.
   */
  parallelSafe?: (input: unknown) => boolean
  execute?: (input: unknown, context: ToolContext) => Effect.Effect<ToolResult>
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

/**
 * The options a person is offered, and the only ones. ACP carries an option
 * list per request because a foreign agent may offer a subset; Eva's gate
 * offers all four of them every time, so the list is a constant here rather
 * than a field on the request — a request that carried it would carry the
 * same four words on every ask, and a surface would have two places to read
 * the labels from.
 *
 * `optionId` is the kind, because the answer names an option by id and the
 * gate turns that id back into an outcome. Two spellings of one option would
 * be a table to keep in step.
 */
export const PERMISSION_OPTIONS: PermissionRequest["options"] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
  { optionId: "reject_always", name: "Reject always", kind: "reject_always" },
]

/**
 * The option this text names, or nothing. It reads an `optionId` and the
 * human name, so a surface that offers the four as words needs no table of
 * its own.
 */
export const optionFor = (text: string): PermissionOutcome["kind"] | undefined => {
  const wanted = text.trim().toLowerCase()
  return PERMISSION_OPTIONS.find(
    (one) => one.optionId.toLowerCase() === wanted || one.name.toLowerCase() === wanted,
  )?.kind
}

/**
 * How an `ask` becomes an answer. This is `HarnessClient.requestPermission`
 * with the call beside it: the ACP request names the call and not its
 * arguments, and remembering an answer that says "always" is written over the
 * words the call would run.
 *
 * Absent, an `ask` is a denial. A permission request with nobody to answer it
 * is a denial, and a surface that takes no input has nobody behind it.
 */
export type Approving = (
  request: PermissionRequest,
  call: ToolCall,
) => Effect.Effect<PermissionOutcome>

/**
 * The tool kinds that only look. Everything else may change something, and a
 * kind this list does not name is one of those — failing closed is what a
 * gate does.
 *
 * It is here rather than in the gate that first needed it, because two gates
 * ask the same question: the deterministic one decides whether a protected
 * path in the arguments is a write, and a permission mode decides which tools
 * it reaches at all. Two lists would be one list to keep in step.
 */
export const LOOKS_ONLY: readonly ToolKind[] = ["read", "search", "think", "fetch"]

export const looksOnly = (kind: ToolKind): boolean => LOOKS_ONLY.includes(kind)

/**
 * The words a call would run, or nothing when it names none. A `command`
 * argument is already-split words, which is the shape a tool that runs a
 * program takes — so the words are read out of the arguments and never off the
 * tool's name, and a second command tool is read with no change here.
 *
 * It is here for the reason `looksOnly` is: the deterministic gate judges
 * these words and the approval gate writes a grant over them, and two readers
 * of one argument would be two answers to keep in step.
 */
export const argvOf = (args: unknown): readonly string[] | undefined => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>)["command"]
  return Array.isArray(command) &&
    command.length > 0 &&
    command.every((one) => typeof one === "string")
    ? (command as readonly string[])
    : undefined
}

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
  /**
   * Turns the `ask` the boundary settled on into one of the four options.
   *
   * It runs after the boundary rather than inside a hook, and that is the
   * whole reason it is here: `strictest` has already chosen, so one call asks
   * one person once whichever hook asked, and no other hook's `ask` can
   * outrank the answer a person gave.
   */
  readonly approving?: Approving
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
 * word. A tool that works for a while writes its own `tool_update` records in
 * between, through the `ToolContext` this hands it.
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

  /**
   * The person answers after the call record lands, so a surface drawing the
   * question already holds the call it is about — the call id is the request
   * id, and the record naming that id came first.
   */
  const asked =
    settled.decision?.kind === "ask" && deps.approving !== undefined
      ? yield* deps.approving(
          {
            sessionId: call.session,
            toolCall: { toolCallId: call.id, title: settled.decision.question },
            options: PERMISSION_OPTIONS,
          },
          { ...call, args: settled.args },
        )
      : settled.decision

  const refused = denial(asked)
  if (refused !== undefined) return yield* closed(toolText("denied", refused))

  const answered = yield* found.execute(settled.args, { id: call.id, emit: deps.emit })
  // The observing boundary reads what the tool answered. A denial never
  // reaches it: a hook that could rewrite one into an allow is not a gate.
  const result =
    deps.afterExecute === undefined ? answered : yield* deps.afterExecute(call, answered)
  return yield* closed(result)
})

/**
 * How many parallel-safe calls run at once when a caller names no bound. A
 * group is as wide as the model wrote it, and a hundred reads at once is a
 * hundred open file handles, so the group runs under a ceiling. Eight is a
 * ceiling and not a target.
 */
export const TOOL_GROUP_LIMIT = 8

export interface ToolGroupDeps extends ToolDeps {
  /**
   * A lower ceiling than `TOOL_GROUP_LIMIT`, for a caller that wants one. A
   * bound below one is read as one, so a caller cannot remove the ceiling by
   * naming a smaller number than there is.
   */
  readonly limit?: number
}

/**
 * Whether one call may run beside its neighbours. A row that carries no
 * `parallelSafe` is unclassified and runs alone, and a classifier that throws
 * is read the same way: the runtime fails closed to serial rather than widen
 * what a tool did not claim.
 */
const runsBeside = (tool: ToolInfo | undefined, args: unknown): boolean => {
  if (tool?.parallelSafe === undefined) return false
  try {
    return tool.parallelSafe(args) === true
  } catch {
    return false
  }
}

// One call admitted to a parallel window, with the row that classified it.
interface Admitted {
  readonly call: ToolCall
  readonly tool: ToolInfo | undefined
}

/**
 * One group of tool calls, as one provider response proposed them. Every
 * result comes back in the order the calls were made, whatever order they
 * finished in.
 *
 * The group is split into windows. A run of consecutive parallel-safe calls is
 * one window and runs together under the bound; every other call is a
 * **barrier** and is a window of one, so everything before it commits before
 * it starts and nothing after it starts until it has committed. An
 * unclassified tool is not parallel-safe, which is what makes the split fail
 * closed.
 *
 * A parallel window's records are held until the window ends and are then
 * committed call by call in source order, so the Trace reads the same bytes
 * whichever call finished first. Nothing commits early: a call that answered
 * while its neighbours still work holds its records in this group's own
 * buffer, and a window that dies commits none of them rather than leaving
 * half a window on the record.
 *
 * A barrier emits straight through, because nothing runs beside it — which is
 * how a command that streams its output still streams.
 *
 * A failure stays with the call that failed. Every ending a tool has is a
 * Disposition, so a sibling that could not do the work answers `failed` and
 * the rest of the window answers for itself.
 */
export const executeToolGroup = Effect.fn("core.tool.group")(function* (
  deps: ToolGroupDeps,
  calls: readonly ToolCall[],
) {
  const limit = Math.max(1, deps.limit ?? TOOL_GROUP_LIMIT)
  const results: ToolResult[] = []

  /**
   * One call of a parallel window, with its records held back. It runs the
   * row that classified it, so a registry rebuilt while the window is open
   * cannot put a tool it now calls unsafe beside another one.
   */
  const held = ({ call, tool }: Admitted) => {
    const said: Payload[] = []
    const buffered: ToolDeps = {
      ...deps,
      tool: () => Effect.succeed(tool),
      emit: (payload) => Effect.sync(() => void said.push(payload)),
    }
    return Effect.map(executeTool(buffered, call), (result) => ({ result, said }))
  }

  const window = Effect.fn("core.tool.group.window")(function* (admitted: readonly Admitted[]) {
    const ran = yield* Effect.forEach(admitted, held, { concurrency: limit })
    for (const one of ran) {
      for (const payload of one.said) yield* deps.emit(payload)
      results.push(one.result)
    }
  })

  let admitted: Admitted[] = []
  for (const call of calls) {
    const tool = yield* deps.tool(call)
    if (runsBeside(tool, call.args)) {
      admitted.push({ call, tool })
      continue
    }
    yield* window(admitted)
    admitted = []
    /**
     * A barrier is looked up twice — once here to classify it, once by the
     * pipeline to run it — and the second read is the one that runs. So a
     * tool domain rebuilt while the group was in flight decides the barrier,
     * which is what a mode change needs.
     */
    results.push(yield* executeTool(deps, call))
  }
  yield* window(admitted)

  const answered: readonly ToolResult[] = results
  return answered
})

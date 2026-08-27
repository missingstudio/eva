import type {
  ContentBlock,
  Disposition,
  Payload,
  ToolKind,
  ToolStatus,
} from "@missingstudio/eva-schema"
import { Effect } from "effect"
import {
  PERMISSION_OPTIONS,
  unaskable,
  type Approving,
  type Decided,
  type ToolCall,
  type ToolDecision,
} from "./deciding.js"

/**
 * The tool runtime: one call, and the group of calls one response proposed.
 * The words a gate reasons in are in `deciding.ts` — what may be decided about
 * a call is not a fact of running one, and a gate that reads them imports no
 * scheduler.
 */

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
   * Records the tool writes while it works. The execution owns `tool_call`,
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

// Why the boundary denied, or nothing when the call may run.
const denial = (decision: ToolDecision | undefined): string | undefined => {
  if (decision === undefined) return undefined
  switch (decision.kind) {
    case "allow_once":
    case "allow_always":
      return undefined
    case "ask":
      // Still an `ask` at the tool means no adapter could reach a person.
      return unaskable(decision.question)
    case "reject_once":
    case "reject_always":
      return decision.reason
  }
}

/**
 * The dependencies one tool call reads. Each one is a late read, for the
 * reason `RunDeps` are: a plugin that replaced a tool row or registered a
 * hook takes effect on the next call.
 */
export interface ToolDeps {
  // Which tool answers this name, after `tool.resolve`. Nothing is a refusal.
  readonly tool: (call: ToolCall) => Effect.Effect<ToolInfo | undefined>
  /**
   * The deciding boundary. Absent means nothing decides and the call runs.
   * The row is the one the execution resolved for this call, so a gate at the
   * boundary judges the row that will run and reads the domain no second time.
   */
  readonly beforeExecute?: (call: ToolCall, tool: ToolInfo) => Effect.Effect<Decided>
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
 * The three records one call leaves, as the two halves that write them. The
 * call record lands before the tool runs and before any update or result,
 * because a fold joins the three by the call id and drops an orphan without a
 * word.
 *
 * It is one function because two callers write the same three records: the
 * call that ran, and the call that never started.
 */
const records = (deps: ToolDeps, call: ToolCall) => ({
  opened: (tool: ToolKind, args: unknown) =>
    deps.emit({
      kind: "tool_call",
      id: call.id,
      name: call.name,
      tool,
      args,
      status: "pending",
      redacted: false,
    }),

  closed: Effect.fn("core.tool.close")(function* (result: ToolResult) {
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
  }),
})

/**
 * One proposed call that will not run, recorded the way a call that ran is.
 * The row is resolved so the record names what the call would have been, and
 * no hook is asked: nothing is being decided, because the answer is already
 * settled.
 *
 * A Budget exhausted between a response and its calls is the first caller,
 * and it answers `budget_denied`. Steering leaves unstarted calls behind and
 * is the second, and it answers `skipped`. Both need the pair joined by the
 * call id, and a fold that found a `tool_call` with no `tool_result` would
 * show a call that never ended.
 */
export const refuseCall = Effect.fn("core.tool.refuse")(function* (
  deps: ToolDeps,
  call: ToolCall,
  disposition: Disposition,
  said: string,
) {
  const { opened, closed } = records(deps, call)
  const found = yield* deps.tool(call)
  yield* opened(found?.kind ?? "other", call.args)
  return yield* closed(toolText(disposition, said))
})

/**
 * One tool call, from the name the model wrote to the three records it
 * leaves: `tool_call`, then the closing `tool_update`, then `tool_result`.
 * A tool that works for a while writes its own `tool_update` records in
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
  const { opened, closed } = records(deps, call)

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

  // Read once, so the closure below holds the implementation the row had.
  const execute = found.execute
  const settled =
    deps.beforeExecute === undefined ? { args: call.args } : yield* deps.beforeExecute(call, found)
  yield* opened(found.kind, settled.args)

  const answering = Effect.gen(function* () {
    /**
     * The person answers after the call record lands, so a surface drawing
     * the question already holds the call it is about — the call id is the
     * request id, and the record naming that id came first.
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

    const answered = yield* execute(settled.args, { id: call.id, emit: deps.emit })
    // The observing boundary reads what the tool answered. A denial never
    // reaches it: a hook that could rewrite one into an allow is not a gate.
    const result =
      deps.afterExecute === undefined ? answered : yield* deps.afterExecute(call, answered)
    return yield* closed(result)
  })

  /**
   * A stop that lands while the call works still closes the pair the call
   * record opened. A fold joins the three records by the call id and drops an
   * orphan without a word, so an interrupted call that left no result would
   * show a call that never ended.
   *
   * A barrier is where this is reachable: it emits straight through, while a
   * parallel window holds its records back and commits none of them when it
   * dies.
   */
  return yield* Effect.onInterrupt(answering, () =>
    Effect.asVoid(closed(toolText("cancelled", `${call.name} stopped before it answered`))),
  )
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
  /**
   * Whether the group must stop before it opens another window, and the words
   * the calls it leaves unstarted report. It is read at every window
   * boundary, so a caller that holds an inbox stops the group at a structural
   * point and never inside a call that is running.
   *
   * Absent is a group nothing stops, which is every group until something
   * holds an inbox.
   */
  readonly stop?: Effect.Effect<string | undefined>
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
 * `stop` ends the group at a window boundary: the window that is running
 * commits whole, and every call from the head of the window that has not
 * opened to the end of the group is `skipped`. So a group that stops leaves
 * no call without the records that close it.
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
   * row that classified it, so a domain rebuilt while the window is open
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

  /**
   * Whether the group stops here, and the calls it leaves behind if it does.
   * `from` is the head of the window that has not opened, so the calls waiting
   * in that window are skipped with the ones after it — none of them started.
   */
  const stopped = Effect.fn("core.tool.group.stop")(function* (from: number) {
    const said = deps.stop === undefined ? undefined : yield* deps.stop
    if (said === undefined) return false
    for (const call of calls.slice(from)) {
      results.push(yield* refuseCall(deps, call, "skipped", said))
    }
    return true
  })

  /**
   * The group, window by window. Every window is a unit that either starts
   * whole or does not start, and the stop is read before each of them — so a
   * steer that arrived while one window was running stops the next one and
   * never the one that is committing.
   */
  const walk = Effect.fn("core.tool.group.walk")(function* () {
    let admitted: Admitted[] = []
    for (const [at, call] of calls.entries()) {
      const tool = yield* deps.tool(call)
      if (runsBeside(tool, call.args)) {
        admitted.push({ call, tool })
        continue
      }
      if (admitted.length > 0) {
        if (yield* stopped(at - admitted.length)) return
        yield* window(admitted)
        admitted = []
      }
      if (yield* stopped(at)) return
      /**
       * A barrier is looked up twice — once here to classify it, once by the
       * execution to run it — and the second read is the one that runs. So a
       * tool domain rebuilt while the group was in flight decides the barrier,
       * which is what a mode change needs.
       */
      results.push(yield* executeTool(deps, call))
    }
    if (admitted.length > 0) {
      if (yield* stopped(calls.length - admitted.length)) return
      yield* window(admitted)
    }
  })

  yield* walk()

  const answered: readonly ToolResult[] = results
  return answered
})

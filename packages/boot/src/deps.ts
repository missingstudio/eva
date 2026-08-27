import {
  settled,
  type Approving,
  type Decided,
  type ModelRef,
  type ModelResolution,
  type ProviderError,
  type ProviderRequest,
  type Retry,
  type RunDeps,
  type ToolCall,
  type ToolDecision,
  type ToolDeps,
  type ToolInfo,
  type ToolResult,
} from "@missingstudio/eva-core"
import type { Payload } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import type { Kernel } from "./boot.js"

/**
 * What a Hook may change while it runs. Two of the four events declare
 * `{ get, update }` and the other two only set, so one cell serves both and
 * an adapter stops declaring a `let` and its closures for each.
 */
const cell = <A>(initial: A) => {
  let held = initial
  return {
    read: () => held,
    set: (value: A) => void (held = value),
    port: {
      get: () => held,
      update: (next: (one: A) => A) => void (held = next(held)),
    },
  }
}

/**
 * The dependencies `submit` reads, built from the kernel. Every hook the SDK
 * declares is run here. A hook no plugin registered is a no-op, not a
 * missing feature.
 *
 * `approving` is carried through to the tool execution rather than read here,
 * for the reason `toolDeps` states: the surface that holds a person and the
 * rule language that remembers an answer are two plugins, and the
 * composition root is where they meet.
 *
 * A Hook edits what it is given in place and `submit` wants an
 * answer back, so each of these holds the answer while the Hooks run and
 * returns what the last one left.
 */
export const runDeps = (
  kernel: Kernel,
  emit: (payload: Payload) => Effect.Effect<void>,
  approving?: Approving,
): RunDeps => {
  const resolve = Effect.fn("boot.resolve")(function* (reference: ModelRef) {
    const held = cell<ModelResolution | undefined>(undefined)
    yield* kernel.hooks.run("model.resolve", { reference, resolve: held.set })
    return held.read()
  })

  const beforeRequest = Effect.fn("boot.beforeRequest")(function* (request: ProviderRequest) {
    const held = cell(request)
    yield* kernel.hooks.run("provider.request.before", { request: held.port })
    return held.read()
  })

  const afterResponse = Effect.fn("boot.afterResponse")(function* (group: readonly Payload[]) {
    const held = cell(group)
    yield* kernel.hooks.run("provider.response.after", { payloads: held.port })
    return held.read()
  })

  const retry = Effect.fn("boot.retry")(function* (error: ProviderError, attempt: number) {
    const held = cell<Retry>({ retry: false, max: attempt, delayMs: 0 })
    yield* kernel.hooks.run("provider.retry", { error, attempt, decide: held.set })
    return held.read()
  })

  return {
    recorder: kernel.slot.recorder.peek,
    resolve,
    beforeRequest,
    afterResponse,
    retry,
    budget: kernel.slot.budget.peek,
    sleep: (milliseconds) => Effect.sleep(milliseconds),
    emit,
    /**
     * The tool execution the Run runs its proposed calls through. It takes the
     * Run's own report path, so the records of a call commit inside the Run
     * that proposed it. The ceiling stays `TOOL_GROUP_LIMIT`: a swappable
     * bound belongs to the host-scoped `schedule` slot, which does not exist.
     */
    tools: (into) => toolDeps(kernel, into, approving),
  }
}

/**
 * The dependencies one tool call reads, built from the kernel. The tool
 * domain answers which tool a name names, and the three tool hooks run here.
 *
 * `tool.execute.before` is a deciding boundary, so this is where its hooks are
 * gathered: what they decided, what they stated as a baseline, and the hook
 * that died. The kernel stops at a failure and no later hook runs. What those
 * three settle into is `settled` in
 * [`@missingstudio/eva-core`](../../core/README.md), because every driver of
 * this boundary settles the same way and a precedence spelled at each of them
 * is a precedence to keep in step.
 *
 * `approving` is how an `ask` reaches a person. It is handed in rather than
 * built here: the surface that holds a person and the rule language that
 * remembers an answer belong to two different plugins, and the composition
 * root is where they meet. Left out, an `ask` is a denial.
 */
export const toolDeps = (
  kernel: Kernel,
  emit: (payload: Payload) => Effect.Effect<void>,
  approving?: Approving,
): ToolDeps => {
  const tool = Effect.fn("boot.tool.resolve")(function* (call: ToolCall) {
    const rows = yield* kernel.domains.tool.get
    const held = cell(rows.find((row) => row.id === call.name))
    yield* kernel.toolHooks.run("tool.resolve", {
      name: call.name,
      session: call.session,
      resolve: held.set,
    })
    return held.read()
  })

  const beforeExecute = Effect.fn("boot.tool.before")(function* (call: ToolCall, named: ToolInfo) {
    const args = cell(call.args)
    const decisions: ToolDecision[] = []
    const baselines: ToolDecision[] = []
    const failure = yield* kernel.toolHooks.run("tool.execute.before", {
      name: call.name,
      // The row the execution resolved for this call, so every gate judges
      // the row that will run and none reads the domain a second time.
      kind: named.kind,
      session: call.session,
      args: args.port,
      decide: (decision) => void decisions.push(decision),
      otherwise: (decision) => void baselines.push(decision),
    })
    /**
     * What the boundary settled, and why, is `settled`'s. This gathers the
     * hooks and performs what one answer says; the precedence among a
     * decision, a baseline and a hook that died belongs to one module every
     * driver of this boundary reads.
     */
    const decision = settled({
      decisions,
      baselines,
      ...(failure === undefined ? {} : { failure }),
    })
    return {
      args: args.read(),
      ...(decision === undefined ? {} : { decision }),
    } satisfies Decided
  })

  const afterExecute = Effect.fn("boot.tool.after")(function* (call: ToolCall, result: ToolResult) {
    const held = cell(result)
    yield* kernel.toolHooks.run("tool.execute.after", {
      name: call.name,
      session: call.session,
      result: held.port,
    })
    return held.read()
  })

  return {
    tool,
    beforeExecute,
    afterExecute,
    emit,
    ...(approving === undefined ? {} : { approving }),
  }
}

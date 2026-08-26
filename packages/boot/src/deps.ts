import {
  strictest,
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
 * `approving` is carried through to the tool pipeline rather than read here,
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
     * The tool pipeline the Run runs its proposed calls through. It takes the
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
 * `tool.execute.before` is a deciding boundary, so this is where its answer
 * is read: a hook that threw denies the call it was deciding, because a gate
 * that fails open because a plugin threw is not a gate. The kernel stops at
 * the failure and no later hook runs, so the denial joins the decisions the
 * hooks before it made and the strictest of them wins.
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

  const beforeExecute = Effect.fn("boot.tool.before")(function* (call: ToolCall) {
    const args = cell(call.args)
    const decisions: ToolDecision[] = []
    const baselines: ToolDecision[] = []
    const failure = yield* kernel.toolHooks.run("tool.execute.before", {
      name: call.name,
      session: call.session,
      args: args.port,
      decide: (decision) => void decisions.push(decision),
      otherwise: (decision) => void baselines.push(decision),
    })
    if (failure !== undefined)
      decisions.push({
        kind: "reject_once",
        reason: `the ${failure.hook} hook of ${failure.owner} failed`,
      })

    /**
     * A baseline is read only when nothing decided. So specific standing
     * authority — a rule a person wrote — is never asked about again, and a
     * mode that supervises still asks about everything no rule named.
     */
    const decision = strictest(decisions) ?? strictest(baselines)
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

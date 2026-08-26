import { toolDeps, type Kernel } from "@missingstudio/eva-boot"
import {
  executeTool,
  executeToolGroup,
  type ToolContext,
  type ToolGroupDeps,
  type ToolResult,
} from "@missingstudio/eva-core"
import { sessionID, type Payload, type SessionID } from "@missingstudio/eva-schema"
import { Effect } from "effect"

// The Session a call is made in when a test names none.
export const CALLING_SESSION: SessionID = sessionID("sess_tool")

/**
 * The context a test hands a tool it calls straight, without the pipeline. It
 * keeps nothing: a tool that writes records while it works is held to them
 * through `calling`, where the order the records land in is the order a reader
 * of the Trace finds.
 */
export const CALLING_CONTEXT: ToolContext = { id: "call_direct", emit: () => Effect.void }

export interface CallOptions {
  readonly session?: SessionID
  // Where the payloads go beside the log: a Recorder, for a suite that wants
  // the call on a real Trace.
  readonly emit?: (payload: Payload) => Effect.Effect<void>
  // A lower bound on a parallel window than the group runner's own.
  readonly limit?: number
}

// One call of a group, as a test writes one. The id is the group's position
// when a test names none, so the records of a group read in source order.
export interface GroupCall {
  readonly name: string
  readonly args?: unknown
  readonly id?: string
}

export interface Calling {
  readonly call: (name: string, args?: unknown, id?: string) => Effect.Effect<ToolResult>
  /**
   * One group of calls, scheduled the way a harness schedules one: the
   * parallel-safe calls run together, every other call is a barrier, and the
   * results come back in the order they were made.
   */
  readonly group: (calls: readonly GroupCall[]) => Effect.Effect<readonly ToolResult[]>
  // Every payload the calls made, in the order they were made.
  readonly said: () => readonly Payload[]
}

/**
 * Tool calls over a live kernel, through the same pipeline a composition root
 * builds. A plugin may not import boot, so without this a tool plugin's own
 * tests could reach its `execute` and never the pipeline that runs it.
 */
export const calling = (kernel: Kernel, options: CallOptions = {}): Calling => {
  const said: Payload[] = []
  const emit = (payload: Payload): Effect.Effect<void> =>
    Effect.suspend(() => {
      said.push(payload)
      return options.emit === undefined ? Effect.void : options.emit(payload)
    })

  const deps: ToolGroupDeps = {
    ...toolDeps(kernel, emit),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  }
  let counted = 0
  const session = options.session ?? CALLING_SESSION
  const named = (one: GroupCall) => ({
    id: one.id ?? `call_${(counted += 1)}`,
    name: one.name,
    args: one.args,
    session,
  })

  return {
    call: (name, args, id) =>
      executeTool(deps, named({ name, args, ...(id === undefined ? {} : { id }) })),
    group: (calls) => executeToolGroup(deps, calls.map(named)),
    said: () => said,
  }
}

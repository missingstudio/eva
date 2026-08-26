import { toolDeps, type Kernel } from "@missingstudio/eva-boot"
import { executeTool, type ToolContext, type ToolResult } from "@missingstudio/eva-core"
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
}

export interface Calling {
  readonly call: (name: string, args?: unknown, id?: string) => Effect.Effect<ToolResult>
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

  const deps = toolDeps(kernel, emit)
  let counted = 0

  return {
    call: (name, args, id) =>
      executeTool(deps, {
        id: id ?? `call_${(counted += 1)}`,
        name,
        args,
        session: options.session ?? CALLING_SESSION,
      }),
    said: () => said,
  }
}

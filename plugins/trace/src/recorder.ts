import type { Recorder, TraceSink } from "@missingstudio/eva-core"
import {
  eventID,
  runID,
  type Claim,
  type Event,
  type EventID,
  type Payload,
  type RunID,
  type SessionID,
  type StopReason,
  type Timestamp,
} from "@missingstudio/eva-schema"
import { Effect } from "effect"

export interface RecorderDeps {
  // Read at every commit, never captured: replacing the sink plugin moves
  // the next commit into the new sink with no restart.
  readonly sink: Effect.Effect<TraceSink | undefined>
  readonly now: () => Timestamp
  readonly nextID: () => string
  // Published after a group commits, so a surface can follow the record.
  readonly published?: (events: readonly Event[]) => Effect.Effect<void>
}

export class RunNotOpenError extends Error {
  override readonly name = "RunNotOpenError"
  constructor() {
    super("the recorder has no open Run")
  }
}

export const makeRecorder = (deps: RecorderDeps): Effect.Effect<Recorder> =>
  Effect.sync(() => {
    let run: RunID | undefined
    let session: SessionID | undefined
    let parent: EventID | null = null
    let closed = false
    // Which slots were empty when a commit needed them. The close reports
    // this rather than letting the Run claim a record it does not have.
    const missing = new Set<string>()

    const stamp = (payload: Payload): Event => {
      const id = eventID(deps.nextID())
      const event: Event = {
        id,
        seq: 0,
        at: deps.now(),
        run: run ?? runID("run_unopened"),
        session: session ?? ("sess_unopened" as SessionID),
        parent,
        payload,
      }
      return event
    }

    // The one commit path. A group lands whole or not at all.
    const commitGroup = Effect.fn("eva.trace.commit")(function* (payloads: readonly Payload[]) {
      if (payloads.length === 0) return
      const group = payloads.map(stamp)
      const sink = yield* deps.sink
      if (sink === undefined) {
        missing.add("TraceSink")
        return
      }
      const committed = yield* sink.append(group)
      if (deps.published !== undefined) yield* deps.published(committed)
    })

    return {
      open: (id) =>
        Effect.sync(() => {
          session = id
          run = runID(`run_${deps.nextID()}`)
          parent = null
          closed = false
          missing.clear()
          return run
        }),

      commit: (payloads) =>
        Effect.suspend(() =>
          run === undefined ? Effect.die(new RunNotOpenError()) : commitGroup(payloads),
        ),

      // Idempotent, and it commits the caveat with the claim as one group
      // so a reader never sees a Run close clean that did not.
      close: (claim: Claim, stopReason?: StopReason) =>
        Effect.suspend(() => {
          if (closed || run === undefined) return Effect.void
          closed = true
          const caveat: readonly Payload[] =
            missing.size === 0 ? [] : [{ kind: "degraded", missing: [...missing] }]
          const finished: Payload =
            stopReason === undefined
              ? { kind: "finished", claim }
              : { kind: "finished", claim, stopReason }
          return commitGroup([...caveat, finished])
        }),
    }
  })

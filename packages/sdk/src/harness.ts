import type {
  Harness,
  HarnessHost,
  ResumeResult,
  RunInput,
  RunResult,
  SubmitInput,
} from "@missingstudio/eva-core"
import { newSessionID } from "@missingstudio/eva-core"
import type { Payload, SessionID, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"

/**
 * The body every native Harness plugin shares. Two plugins spelled this twice
 * — the same session mint, the same fiber map, the same interrupt
 * classification, the same refusal group, the same no-wire answers — with only
 * the loop differing. The body lives here once; a Harness plugin keeps what is
 * its own: what one Prompt does, and what a steer does when one arrives.
 *
 * This is the same absorption `streamingProvider` performed at the Provider
 * seam, for the same reason: a rule spelled once per adapter is a rule that
 * only one adapter's suite proves.
 *
 * A Harness reached over the Agent Client Protocol wire uses none of this. It
 * brings its own session state and its own process, and Eva hands it nothing.
 */

const message = (author: "human" | "agent", text: string): TranscriptMessage => ({
  author,
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

/**
 * One message of a history a Harness builds. The history is the one shape
 * every Provider is handed, so a Harness says what a person and a model said
 * in the same two words wherever it says them.
 */
export const human = (text: string): TranscriptMessage => message("human", text)

export const agent = (text: string): TranscriptMessage => message("agent", text)

/**
 * One line a person said while a Harness was working, and the boundary it is
 * held for. A Harness holds the inbox, because only it knows where its next
 * Step begins.
 */
export type Steer = Extract<SubmitInput, { readonly kind: "steer" }>

/**
 * What one Prompt is handed. It is the Harness host with the Run bookkeeping
 * already done, so an answer body states what it wants and never what a
 * refusal looks like.
 */
export interface Prompting {
  /**
   * One Run, and the fact that a Run happened. `refuse` reads that fact, which
   * is why a Run goes through here rather than through the host directly.
   */
  readonly run: (input: RunInput) => Effect.Effect<RunResult>
  // One group outside a Run, for a record a Run cannot carry — a Verdict is
  // known only after the Run that produced the Candidate has closed.
  readonly report: (payloads: readonly Payload[]) => Effect.Effect<void>
  /**
   * The Prompt gives up, and says so on the Trace. Before the first Run it is
   * a `started` and a `finished` with the failed Claim, because there is no
   * Run for the refusal to land in; after one it is the `finished` alone, since
   * the Runs already carry the story up to the refusal.
   *
   * A caller that names a Stop Reason records it and answers it. One that
   * names none answers `end_turn` and records no reason, because a Harness
   * whose Steps are declared has no reason to report beyond the failure.
   */
  readonly refuse: (summary: string, stopReason?: StopReason) => Effect.Effect<StopReason>
}

/**
 * What a native Harness plugin states, and the whole of it.
 */
export interface NativeSpec {
  // The row's id, and the name a person types after `eva run`.
  readonly id: string
  // What one Prompt does. It answers a Stop Reason, and it never throws one:
  // an interrupt is classified for it.
  readonly answer: (
    prompting: Prompting,
    session: SessionID,
    intent: string,
  ) => Effect.Effect<StopReason>
  /**
   * What a steer does when one arrives. It is called before the current Stop
   * Reason answers the caller, because the Prompt a steer lands in is not the
   * steering call's to wait for.
   *
   * Absent refuses steering: the line is not recorded and not ignored, because
   * a delivery record for a Harness whose Steps are declared would assert
   * something false. Present, the Harness holds the line and decides where in
   * its own Step cycle it lands — which is why the routing is the Harness's and
   * not the Session API's.
   */
  readonly steer?: (session: SessionID, steer: Steer) => void
}

/**
 * A Harness takes text and answers a Stop Reason. Every capability field is
 * optional and absent means not supported, so a native Harness answering none
 * of them is honest rather than Degraded: it negotiates nothing, holds the
 * client half without ever calling it, and speaks no MCP. A permission reaches
 * a person through the tool execution's own gate, which is the Run's.
 */
const CAPABILITIES = {}

export const nativeHarness = (host: HarnessHost, spec: NativeSpec): Harness => {
  // Minted by createSession. The cwd is accepted and unused: a tool reads the
  // FileSystem slot, whose root is the workspace the build was given.
  const minted = new Map<SessionID, string>()
  const running = new Map<SessionID, Fiber.Fiber<StopReason>>()
  const last = new Map<SessionID, StopReason>()

  // One Prompt's bookkeeping: whether a Run has opened, which is the only
  // thing a refusal's shape turns on.
  const prompting = (intent: string): Prompting => {
    let ran = false
    return {
      run: (input) =>
        Effect.suspend(() => {
          ran = true
          return host.run(input)
        }),
      report: host.report,
      /**
       * Suspended, so whether a Run has opened is read when the refusal runs
       * and not when it is built. A caller that composes the refusal before
       * the Run it follows would otherwise record a `started` for a Run that
       * had already opened one.
       */
      refuse: (summary, stopReason) =>
        Effect.suspend(() => {
          const finished: Payload = {
            kind: "finished",
            claim: { result: "failed", summary },
            ...(stopReason === undefined ? {} : { stopReason }),
          }
          return host
            .report(ran ? [finished] : [{ kind: "started", intent }, finished])
            .pipe(Effect.as(stopReason ?? ("end_turn" as const)))
        }),
    }
  }

  const prompt = Effect.fn(`${spec.id}.prompt`)(function* (session: SessionID, input: SubmitInput) {
    /**
     * A steer answers with the current Stop Reason, because the Prompt it
     * lands in is not this call's to wait for. Where the line lands is the
     * Harness's own, and a Harness that states no `steer` refuses it.
     */
    if (input.kind === "steer") {
      spec.steer?.(session, input)
      return last.get(session) ?? ("end_turn" as const)
    }

    const stepping = yield* Effect.forkChild(
      spec.answer(prompting(input.text), session, input.text),
    )
    running.set(session, stepping)
    const exit = yield* Fiber.await(stepping)
    running.delete(session)

    // A Harness answers a Stop Reason, so an interrupt is classified here
    // rather than thrown.
    const reason = Exit.isSuccess(exit)
      ? exit.value
      : Cause.hasInterruptsOnly(exit.cause)
        ? ("cancelled" as const)
        : yield* Effect.failCause(exit.cause)
    last.set(session, reason)
    return reason
  })

  return {
    id: spec.id,
    capabilities: CAPABILITIES,
    initialize: () => Effect.succeed(CAPABILITIES),
    createSession: (cwd) =>
      Effect.sync(() => {
        const session = newSessionID()
        minted.set(session, cwd)
        return session
      }),
    // Never `undetectable`: a native Harness always knows what it holds. It
    // keeps no state between Prompts, so a resume is the next Prompt.
    resumeSession: (id) =>
      Effect.sync(
        (): ResumeResult =>
          minted.has(id)
            ? { kind: "resumed", session: id }
            : { kind: "rejected", reason: `${spec.id} did not open ${id}` },
      ),
    prompt,
    cancel: (id) =>
      Effect.gen(function* () {
        const stepping = running.get(id)
        if (stepping !== undefined) yield* Fiber.interrupt(stepping)
      }),
    // A native Harness has no wire; every payload goes through core's one Run
    // path.
    updates: Stream.empty,
  }
}

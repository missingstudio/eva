import type {
  Budget,
  CalledTool,
  Harness,
  HarnessHost,
  ResumeResult,
  SubmitInput,
  ToolInfo,
} from "@missingstudio/eva-core"
import { newSessionID } from "@missingstudio/eva-core"
import type { Payload, SessionID, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import { instructionOf, type CatalogState, type Gap, type PromptInfo } from "@missingstudio/eva-sdk"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import { LOOP_TEMPLATE_ID } from "./prompt.js"
import { human, offeredIn, stepMessages } from "./step.js"

// The row's id, and the name a person types after `eva run`.
export const LOOP_HARNESS_ID = "eva.harness.loop"

/**
 * What the loop reads while it runs. Every member but the two ceilings is an
 * Effect that resolves the current implementation, read at the point of use
 * and never captured — so a permission mode that rebuilt the tool domain is
 * what the next Step offers, and a Budget filled mid-Prompt is checked.
 */
export interface LoopDeps {
  readonly tools: Effect.Effect<readonly ToolInfo[]>
  readonly prompts: Effect.Effect<readonly PromptInfo[]>
  readonly catalog: Effect.Effect<CatalogState>
  readonly budget: Effect.Effect<Budget | undefined>
  /**
   * The max-steps fuse: the ceiling on Steps in one Prompt.
   *
   * It is not the Budget's `steps` limit, and it cannot be. A Budget is one
   * accumulator for the process: its `steps` counter never resets, so a limit
   * of twenty would let the first Prompt spend all twenty and stop the second
   * at its first Step. A fuse bounds one Prompt. The two measure different
   * spans, so neither can disagree with the other, and both stop the Prompt
   * the same way.
   */
  readonly steps: number
  /**
   * The ceiling on consecutive Steps in which no proposed call ran. A call
   * that ran and failed is an answer the model can act on; a call naming a
   * tool that is not there is a malformed proposal, and a model repeating one
   * would otherwise spend the whole fuse on it.
   */
  readonly repairs: number
}

/**
 * The loop takes text and answers a Stop Reason. It forks a Step, holds no
 * session state a resume needs, and speaks no MCP. Every field is optional and
 * absent means not supported, so this is honest rather than Degraded.
 */
const CAPABILITIES = {}

// A Gap said in one clause, the same words a failed Claim carries.
const gapWord = (gap: Gap): string =>
  `${gap.kind} ${gap.name}${gap.meant === undefined ? "" : `, did you mean ${gap.meant}`}`

// Whether every call this Step proposed named a tool that is not there.
const noneRan = (called: readonly CalledTool[]): boolean =>
  called.every((one) => one.result.disposition === "unknown_tool")

/**
 * `eva.harness.loop`'s Harness: propose, act, observe. One Step is one
 * `host.run`, so the tool calls a response proposed run inside the Run that
 * proposed them and every Instruction is on the Trace. A Step that proposed no
 * call is the answer, and the Prompt ends there.
 *
 * Two ceilings bound it: the Budget, which is the process's spend, and the
 * max-steps fuse, which is this Prompt's. Reaching either is an Outcome and
 * not an error — the partial work stays on the Trace and the Run that reached
 * it closed with its own Claim.
 *
 * A refusal is on the Trace too: before any Run it is a `started` and a
 * `finished` with the failed Claim, and after one it is the `finished` alone,
 * because the Runs already carry the story up to the refusal.
 */
export const makeLoopHarness = (host: HarnessHost, deps: LoopDeps): Harness => {
  // Minted by createSession. The cwd is accepted and unused: the tools read
  // the FileSystem slot, whose root is the workspace the build was given.
  const minted = new Map<SessionID, string>()
  const running = new Map<SessionID, Fiber.Fiber<StopReason>>()
  const last = new Map<SessionID, StopReason>()

  const answer = Effect.fn("eva.harness.loop.answer")(function* (
    session: SessionID,
    intent: string,
  ) {
    let ran = false

    const close = (summary: string, stopReason: StopReason) => {
      const finished: Payload = {
        kind: "finished",
        claim: { result: "failed", summary },
        stopReason,
      }
      return host
        .report(ran ? [finished] : [{ kind: "started", intent }, finished])
        .pipe(Effect.as(stopReason))
    }

    // Checked before the first Run, so a build that cannot answer refuses
    // before a Provider Turn is paid for.
    const catalog = yield* deps.catalog
    const model = catalog.default
    if (model === undefined) {
      return yield* close("no model is named and the Catalog holds no default", "end_turn")
    }

    let history: readonly TranscriptMessage[] = [human(intent)]
    // Consecutive Steps in which nothing the model proposed could run.
    let malformed = 0

    for (let step = 1; ; step += 1) {
      /**
       * Before every Step. The Budget first, because it is a spend fact and it
       * is what a person set; the fuse second, because it is this Prompt's own
       * ceiling. A Step the previous one's calls were `budget_denied` in lands
       * here, which is where the Outcome is stated.
       */
      const budget = yield* deps.budget
      if (budget !== undefined) {
        const decision = yield* budget.check
        if (decision.kind === "exhausted") {
          return yield* close(`the Budget is exhausted: ${decision.limit}`, "max_turn_requests")
        }
      }
      if (step > deps.steps) {
        return yield* close(
          `the max-steps fuse stopped this Prompt after ${deps.steps} Steps`,
          "max_turn_requests",
        )
      }

      const filled = instructionOf(yield* deps.prompts, LOOP_TEMPLATE_ID, {})
      if (filled.kind === "refused") {
        const said = filled.gaps.map(gapWord).join("; ")
        return yield* close(`the loop cannot fill ${LOOP_TEMPLATE_ID}: ${said}`, "end_turn")
      }

      ran = true
      const result = yield* host.run({
        session,
        spec: { intent },
        model,
        history,
        system: filled.text,
        // Read per Step, so a mode change is in the next Step's list.
        tools: offeredIn(yield* deps.tools),
      })

      // The Run's own record already says why it failed, so the loop stops
      // there and adds no second story.
      if (result.claim.result === "failed") return result.stopReason ?? ("end_turn" as const)
      if (result.stopReason !== undefined && result.stopReason !== "end_turn") {
        return result.stopReason
      }

      /**
       * A Step that proposed no call is the answer. The last Run's own Claim
       * is what closed it, so nothing more is written — and silence is not
       * `end_turn`, which is why an unreported reason came back above.
       */
      if (result.calls.length === 0) return "end_turn" as const

      history = [...history, ...stepMessages(result.text, result.calls)]

      malformed = noneRan(result.calls) ? malformed + 1 : 0
      if (malformed > deps.repairs) {
        const named = [...new Set(result.calls.map((one) => one.call.name))].join(", ")
        return yield* close(
          `no tool answered any call for ${malformed} Steps: ${named}`,
          "max_turn_requests",
        )
      }
    }
  })

  const prompt = Effect.fn("eva.harness.loop.prompt")(function* (
    session: SessionID,
    input: SubmitInput,
  ) {
    /**
     * Steering is not delivered yet, and the current Stop Reason is the whole
     * answer until it is. The structural point a steer lands on already
     * exists: the top of the Step loop above, which is reached once the Run
     * has closed and its tool group has committed. `eva.steer` owns the inbox
     * that holds a line until then, and `refuseCall` in core is what turns the
     * calls a steer left unstarted into `skipped` results.
     */
    if (input.kind === "steer") return last.get(session) ?? ("end_turn" as const)

    const stepping = yield* Effect.forkChild(answer(session, input.text))
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
    id: LOOP_HARNESS_ID,
    capabilities: CAPABILITIES,
    // The loop negotiates nothing: it answers its own capabilities unchanged
    // and keeps the client half without ever calling it. A permission reaches
    // a person through the tool pipeline's own gate, which is the Run's.
    initialize: () => Effect.succeed(CAPABILITIES),
    createSession: (cwd) =>
      Effect.sync(() => {
        const session = newSessionID()
        minted.set(session, cwd)
        return session
      }),
    // Never `undetectable`: a native harness always knows what it holds. The
    // loop keeps no state between Prompts, so a resume is the next Prompt.
    resumeSession: (id) =>
      Effect.sync(
        (): ResumeResult =>
          minted.has(id)
            ? { kind: "resumed", session: id }
            : { kind: "rejected", reason: `${LOOP_HARNESS_ID} did not open ${id}` },
      ),
    prompt,
    cancel: (id) =>
      Effect.gen(function* () {
        const stepping = running.get(id)
        if (stepping !== undefined) yield* Fiber.interrupt(stepping)
      }),
    // A native harness has no wire; every payload goes through core's one Run
    // path.
    updates: Stream.empty,
  }
}

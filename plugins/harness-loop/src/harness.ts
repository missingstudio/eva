import type {
  Budget,
  CalledTool,
  Harness,
  HarnessHost,
  SteerMessage,
  ToolInfo,
} from "@missingstudio/eva-core"
import type { SessionID, TranscriptMessage } from "@missingstudio/eva-schema"
import {
  human,
  instructionOf,
  nativeHarness,
  sayGap,
  type CatalogState,
  type PromptInfo,
  type Prompting,
  type Steer,
} from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { LOOP_TEMPLATE_ID } from "./prompt.js"
import { offeredIn, stepMessages } from "./step.js"

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
   * The ceiling on consecutive Steps in which every proposed call named a tool
   * that is not there. A call that ran and failed is an answer the model can
   * act on; a call naming a tool nothing holds is a malformed proposal, and a
   * model repeating one would otherwise spend the whole fuse on it.
   */
  readonly malformedSteps: number
}

// A steer as the record carries it. The payload kind is the schema's, and it
// already names the boundary the words were held for.
const messageOf = (steer: Steer): SteerMessage => ({
  kind: "message",
  content: { type: "text", text: steer.text },
  target: steer.target,
})

// What the calls a steer left unstarted report.
const SKIPPED = "a steer arrived and this call did not start"

// Whether every call this Step proposed named a tool that is not there.
const allUnknown = (called: readonly CalledTool[]): boolean =>
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
  /**
   * Steering that has not landed yet, per Session. The loop holds it because
   * only the loop knows where its next Step begins: a Session API that held it
   * would have to know the shape of every Harness. `architecture.md` §12.3a
   * promises the loop a host-scoped inbox slot, and that is where this moves
   * once the loop hosts extension points of its own.
   *
   * A caller routes steering before this does — Eva's own Session API hands
   * over a `next-step` steer and queues the rest against the next Prompt, so
   * the `next-run` half here answers a driver that is not it: a direct caller,
   * and the protocol's client half at a later stage.
   */
  const inbox = new Map<SessionID, Steer[]>()

  // The steering held for one boundary, in the order it arrived. What is held
  // for the other boundary stays in the inbox.
  const taken = (session: SessionID, target: Steer["target"]): readonly Steer[] => {
    const held = inbox.get(session) ?? []
    const mine = held.filter((one) => one.target === target)
    if (mine.length > 0) {
      inbox.set(
        session,
        held.filter((one) => one.target !== target),
      )
    }
    return mine
  }

  /**
   * Why the tool group of the Run in flight must stop, or nothing. A steer
   * waiting for the next Step is the only reason: the group stops at its next
   * window boundary, the window that is running commits whole, and the calls
   * of the windows that never opened are `skipped`.
   */
  const stopping = (session: SessionID): string | undefined =>
    (inbox.get(session) ?? []).some((one) => one.target === "next-step") ? SKIPPED : undefined

  const answer = Effect.fn("eva.harness.loop.answer")(function* (
    prompting: Prompting,
    session: SessionID,
    intent: string,
  ) {
    // Checked before the first Run, so a build that cannot answer refuses
    // before a Provider Turn is paid for.
    const catalog = yield* deps.catalog
    const model = catalog.default
    if (model === undefined) {
      return yield* prompting.refuse(
        "no model is named and the Catalog holds no default",
        "end_turn",
      )
    }

    /**
     * Steering that waited for the whole arc. It arrived before this Prompt,
     * so it is said before the intent — the order the person said it in.
     */
    const opening = taken(session, "next-run")
    let history: readonly TranscriptMessage[] = [
      ...opening.map((one) => human(one.text)),
      human(intent),
    ]
    // Steering the next Run records. A Recorder holds one open Run, so the
    // words land inside a Run and never in a commit of their own.
    let pending: readonly SteerMessage[] = opening.map(messageOf)
    // Consecutive Steps in which every call named a tool that is not there.
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
          return yield* prompting.refuse(
            `the Budget is exhausted: ${decision.limit}`,
            "max_turn_requests",
          )
        }
      }
      if (step > deps.steps) {
        return yield* prompting.refuse(
          `the max-steps fuse stopped this Prompt after ${deps.steps} Steps`,
          "max_turn_requests",
        )
      }

      /**
       * The steering that waited for this Step, which is the structural point
       * the roadmap's rule names: the response and its tool group are over and
       * their records are committed. It is read after the ceilings, so a Prompt
       * that stops here leaves the words in the inbox for the next Prompt
       * rather than swallowing them.
       */
      const arrived = taken(session, "next-step")
      if (arrived.length > 0) {
        history = [...history, ...arrived.map((one) => human(one.text))]
        pending = [...pending, ...arrived.map(messageOf)]
      }

      const filled = instructionOf(yield* deps.prompts, LOOP_TEMPLATE_ID, {})
      if (filled.kind === "refused") {
        const said = filled.gaps.map(sayGap).join("; ")
        return yield* prompting.refuse(
          `the loop cannot fill ${LOOP_TEMPLATE_ID}: ${said}`,
          "end_turn",
        )
      }

      const result = yield* prompting.run({
        session,
        spec: { intent },
        model,
        history,
        system: filled.text,
        // Read per Step, so a mode change is in the next Step's list.
        tools: offeredIn(yield* deps.tools),
        ...(pending.length === 0 ? {} : { steered: pending }),
        // Read at every window boundary of this Run's group, never captured.
        stop: Effect.sync(() => stopping(session)),
      })
      pending = []

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

      malformed = allUnknown(result.calls) ? malformed + 1 : 0
      if (malformed > deps.malformedSteps) {
        const named = [...new Set(result.calls.map((one) => one.call.name))].join(", ")
        return yield* prompting.refuse(
          `no tool answered any call for ${malformed} Steps: ${named}`,
          "max_turn_requests",
        )
      }
    }
  })

  /**
   * A steer goes into the inbox and the current Stop Reason answers the
   * caller, because the Prompt it lands in is not that call's to wait for.
   * The loop accepts one; a Workflow refuses one, and that is the difference
   * between a declared list of Steps and an agent.
   *
   * `next-step` lands at the top of the Step loop above, which is reached once
   * the Run has closed and its tool group has committed. `next-run` is the
   * whole arc's boundary and waits for the next Prompt. Neither is an error,
   * and a steer that arrives with no Prompt running waits for one.
   */
  const steer = (session: SessionID, arrived: Steer): void => {
    inbox.set(session, [...(inbox.get(session) ?? []), arrived])
  }

  return nativeHarness(host, { id: LOOP_HARNESS_ID, answer, steer })
}

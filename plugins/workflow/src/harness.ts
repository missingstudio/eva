import type {
  Budget,
  Harness,
  HarnessHost,
  ModelRef,
  ResumeResult,
  SubmitInput,
  Validator,
} from "@missingstudio/eva-core"
import { formatModelRef, newSessionID } from "@missingstudio/eva-core"
import type { Payload, SessionID, StopReason, TranscriptMessage } from "@missingstudio/eva-schema"
import {
  instructionOf,
  nearest,
  type CatalogState,
  type Gap,
  type PromptInfo,
} from "@missingstudio/eva-sdk"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import type { ReadWorkflow, Step } from "./document.js"
import { resolveReference } from "./reference.js"
import { faultLine, REPAIR_TEMPLATE_ID } from "./repair.js"

/**
 * What the harness reads while it runs. Every member but `repairs` is an
 * Effect that resolves the current implementation, read at the point of use
 * and never captured — so replacing the Validator plugin mid-Run moves the
 * next check, and a prompt row that arrives late is seen by the next fill.
 */
export interface WorkflowDeps {
  readonly document: ReadWorkflow
  readonly prompts: Effect.Effect<readonly PromptInfo[]>
  readonly catalog: Effect.Effect<CatalogState>
  readonly validator: Effect.Effect<Validator | undefined>
  readonly budget: Effect.Effect<Budget | undefined>
  // The ceiling on Repairs per Step. A Step may override it.
  readonly repairs: number
}

// A Workflow takes text, holds no session state, forks nothing, and speaks
// no MCP. Every field is optional and absent means not supported, so this is
// honest rather than Degraded.
const CAPABILITIES = {}

const human = (text: string): TranscriptMessage => ({
  author: "human",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

const agent = (text: string): TranscriptMessage => ({
  author: "agent",
  blocks: [{ type: "content", block: 0, content: { type: "text", text } }],
})

// A Gap said in one clause, the same words a failed Claim carries.
const gapWord = (gap: Gap): string =>
  `${gap.kind} ${gap.name}${gap.meant === undefined ? "" : `, did you mean ${gap.meant}`}`

/**
 * `eva.workflow`'s Harness: a declared list of Steps answers a Prompt. The
 * file owns the control flow and the model fills the slots. Each Step is one
 * `host.run`, so every Instruction is on the Trace; each Verdict goes through
 * `host.report` before the next Run opens, so an interrupt cannot shrink a
 * measured denominator.
 *
 * A refusal is on the Trace too: before any Run it is a `started` and a
 * `finished` with the failed Claim, and after one it is the `finished` alone,
 * because the Runs already carry the story up to the failure.
 */
export const makeWorkflowHarness = (host: HarnessHost, deps: WorkflowDeps): Harness => {
  // Minted by createSession. The cwd is accepted and unused: a Workflow
  // reads no files, because there is no FileSystem slot until Stage 2.
  const minted = new Map<SessionID, string>()
  const running = new Map<SessionID, Fiber.Fiber<StopReason>>()
  const last = new Map<SessionID, StopReason>()

  const answer = Effect.fn("eva.workflow.answer")(function* (session: SessionID, intent: string) {
    let ran = false

    const close = (summary: string) => {
      const finished: Payload = { kind: "finished", claim: { result: "failed", summary } }
      return host
        .report(ran ? [finished] : [{ kind: "started", intent }, finished])
        .pipe(Effect.as("end_turn" as const))
    }

    const workflow = deps.document.workflow
    if (workflow === undefined) {
      const said = deps.document.problems.join("; ")
      return yield* close(`workflow ${deps.document.id} cannot run: ${said}`)
    }

    // The second pass, before the first model call: every template, model
    // and schema for every Step, and every problem reported together.
    const rows = yield* deps.prompts
    const catalog = yield* deps.catalog
    const problems: string[] = []
    const plan: { readonly step: Step; readonly model: ModelRef }[] = []
    for (const step of workflow.steps) {
      if (!rows.some((row) => row.id === step.template)) {
        const meant = nearest(
          step.template,
          rows.map((row) => row.id),
        )
        problems.push(
          `step ${step.id}: no Template is ${step.template}${meant === undefined ? "" : `, did you mean ${meant}`}`,
        )
      }
      const model = step.model ?? workflow.model ?? catalog.default
      if (model === undefined) {
        problems.push(`step ${step.id}: no model is named and the Catalog holds no default`)
      } else if (catalog.models.get(model.provider)?.get(model.model) === undefined) {
        problems.push(`step ${step.id}: the Catalog does not hold ${formatModelRef(model)}`)
      } else {
        plan.push({ step, model })
      }
      if (step.schema !== undefined) {
        const validator = yield* deps.validator
        if (validator !== undefined) {
          const broken = yield* validator.accepts(step.schema).pipe(
            Effect.as(undefined),
            Effect.catchTag("ValidatorError", (error) => Effect.succeed(error.message)),
          )
          if (broken !== undefined) problems.push(`step ${step.id}: ${broken}`)
        }
      }
    }
    if (problems.length > 0) {
      return yield* close(`workflow ${deps.document.id} cannot run: ${problems.join("; ")}`)
    }

    const outputs = new Map<string, unknown>()
    for (const { step, model } of plan) {
      // Fill. The Variables are the `with` references resolved against the
      // Prompt and the earlier Outputs.
      const variables: Record<string, string> = {}
      const holes: string[] = []
      for (const [name, reference] of Object.entries(step.with)) {
        const resolved = resolveReference(reference, intent, outputs)
        if (resolved.kind === "text") variables[name] = resolved.text
        else holes.push(`${name}: ${resolved.why}`)
      }
      if (holes.length > 0) {
        return yield* close(`step ${step.id} cannot bind: ${holes.join("; ")}`)
      }

      const filled = instructionOf(yield* deps.prompts, step.template, variables)
      if (filled.kind === "refused") {
        const said = filled.gaps.map(gapWord).join("; ")
        return yield* close(`step ${step.id} cannot fill ${step.template}: ${said}`)
      }

      const ceiling = step.repairs ?? deps.repairs
      let attempt = 1
      let instruction = filled.text
      // Steps do not share a history: each Step starts fresh, so it sees
      // exactly the references it declared.
      let history: readonly TranscriptMessage[] = [human(filled.text)]

      for (;;) {
        // Before every Step, Repairs included — the one place a Repair
        // could go unbounded.
        const budget = yield* deps.budget
        if (budget !== undefined) {
          const decision = yield* budget.check
          if (decision.kind === "exhausted") {
            return yield* close(`the Budget is exhausted: ${decision.limit}`)
          }
        }

        ran = true
        const result = yield* host.run({
          session,
          spec: { intent: instruction },
          model,
          history,
        })

        // The Run's own record already says why it failed, so the Workflow
        // stops there and adds no second story.
        if (result.claim.result === "failed") return result.stopReason ?? ("end_turn" as const)
        if (result.stopReason !== undefined && result.stopReason !== "end_turn") {
          return result.stopReason
        }

        // No schema: the Output is the text and the Step is done. Nothing
        // is Degraded — the Step declared no shape and it is complete.
        if (step.schema === undefined) {
          outputs.set(step.id, result.text)
          break
        }

        const validator = yield* deps.validator
        if (validator === undefined) {
          // Degrade, never refuse: the answer still arrives, marked.
          yield* host.report([
            { kind: "degraded", missing: ["Validator"] },
            { kind: "verdict", step: step.id, verdict: "unchecked", attempt, faults: [] },
          ])
          outputs.set(step.id, result.text)
          break
        }

        const judged = yield* validator
          .check(step.schema, result.text)
          .pipe(
            Effect.catchTag("ValidatorError", (error) =>
              Effect.succeed({ verdict: "unreadable" as const, message: error.message }),
            ),
          )
        // The schema faulted mid-run, not the Candidate; nothing was judged.
        if (judged.verdict === "unreadable") {
          return yield* close(`step ${step.id}: ${judged.message}`)
        }

        yield* host.report([
          {
            kind: "verdict",
            step: step.id,
            verdict: judged.verdict,
            attempt,
            faults: judged.verdict === "invalid" ? judged.faults : [],
          },
        ])

        if (judged.verdict === "valid") {
          outputs.set(step.id, judged.value)
          break
        }

        if (attempt > ceiling) {
          const said = judged.faults.map(faultLine).join("; ")
          return yield* close(
            `step ${step.id}: the Candidate did not conform after ${attempt} attempts: ${said}`,
          )
        }

        // The Repair: the same task, the refused Candidate as the prior
        // assistant message, and every Fault named — one more Step.
        const repairRows = yield* deps.prompts
        const named = `${deps.document.id}.repair`
        const template = repairRows.some((row) => row.id === named) ? named : REPAIR_TEMPLATE_ID
        const repair = instructionOf(repairRows, template, {
          instruction: filled.text,
          faults: judged.faults.map(faultLine).join("\n"),
        })
        if (repair.kind === "refused") {
          const said = repair.gaps.map(gapWord).join("; ")
          return yield* close(`step ${step.id} cannot fill ${template}: ${said}`)
        }
        history = [human(filled.text), agent(result.text), human(repair.text)]
        instruction = repair.text
        attempt += 1
      }
    }

    // Every Step validated and the last one finished. The last Run's own
    // Claim is the answer, so nothing more is written.
    return "end_turn" as const
  })

  const prompt = Effect.fn("eva.workflow.prompt")(function* (
    session: SessionID,
    input: SubmitInput,
  ) {
    // Steering is refused, not recorded and ignored: a Workflow's Steps are
    // the file's, so a delivery record would assert something false. The
    // current Stop Reason is the whole answer.
    if (input.kind === "steer") return last.get(session) ?? ("end_turn" as const)

    const stepping = yield* Effect.forkChild(answer(session, input.text))
    running.set(session, stepping)
    const exit = yield* Fiber.await(stepping)
    running.delete(session)

    const reason = Exit.isSuccess(exit)
      ? exit.value
      : Cause.hasInterruptsOnly(exit.cause)
        ? ("cancelled" as const)
        : yield* Effect.failCause(exit.cause)
    last.set(session, reason)
    return reason
  })

  return {
    id: deps.document.id,
    capabilities: CAPABILITIES,
    // A Workflow negotiates nothing: it answers its own capabilities
    // unchanged and keeps the client half without ever calling it.
    initialize: () => Effect.succeed(CAPABILITIES),
    createSession: (cwd) =>
      Effect.sync(() => {
        const session = newSessionID()
        minted.set(session, cwd)
        return session
      }),
    // Never `undetectable`: a native harness always knows what it holds.
    // Re-running from the top is what a resume means, because there is no
    // state between Runs.
    resumeSession: (id) =>
      Effect.sync(
        (): ResumeResult =>
          minted.has(id)
            ? { kind: "resumed", session: id }
            : { kind: "rejected", reason: `workflow ${deps.document.id} did not open ${id}` },
      ),
    prompt,
    cancel: (id) =>
      Effect.gen(function* () {
        const stepping = running.get(id)
        if (stepping !== undefined) yield* Fiber.interrupt(stepping)
      }),
    // A native harness has no wire; every payload goes through core's one
    // Run path.
    updates: Stream.empty,
  }
}

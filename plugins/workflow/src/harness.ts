import type { Budget, Harness, HarnessHost, ModelRef, Validator } from "@missingstudio/eva-core"
import { formatModelRef } from "@missingstudio/eva-core"
import type { SessionID, TranscriptMessage } from "@missingstudio/eva-schema"
import {
  agent,
  human,
  instructionOf,
  nativeHarness,
  nearest,
  sayGap,
  type CatalogState,
  type PromptInfo,
  type Prompting,
} from "@missingstudio/eva-sdk"
import { Effect } from "effect"
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
  const answer = Effect.fn("eva.workflow.answer")(function* (
    prompting: Prompting,
    session: SessionID,
    intent: string,
  ) {
    const workflow = deps.document.workflow
    if (workflow === undefined) {
      const said = deps.document.problems.join("; ")
      return yield* prompting.refuse(`workflow ${deps.document.id} cannot run: ${said}`)
    }

    // The second pass, before the first model call: every template, model
    // and schema for every Step, the repair Template a Repair would fill,
    // and every problem reported together.
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

    // The repair Template, resolved as the Repair resolves it and dry-filled,
    // so a missing or broken row refuses here and not after a paid Provider
    // Turn. Only a Step with a schema and a ceiling above zero can repair.
    const couldRepair = workflow.steps.some(
      (step) => step.schema !== undefined && (step.repairs ?? deps.repairs) > 0,
    )
    if (couldRepair) {
      const named = `${deps.document.id}.repair`
      const template = rows.some((row) => row.id === named) ? named : REPAIR_TEMPLATE_ID
      const dry = instructionOf(rows, template, { instruction: "", faults: "" })
      if (dry.kind === "refused") {
        problems.push(`the Repair cannot fill ${template}: ${dry.gaps.map(sayGap).join("; ")}`)
      }
    }

    if (problems.length > 0) {
      return yield* prompting.refuse(
        `workflow ${deps.document.id} cannot run: ${problems.join("; ")}`,
      )
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
        return yield* prompting.refuse(`step ${step.id} cannot bind: ${holes.join("; ")}`)
      }

      const filled = instructionOf(yield* deps.prompts, step.template, variables)
      if (filled.kind === "refused") {
        const said = filled.gaps.map(sayGap).join("; ")
        return yield* prompting.refuse(`step ${step.id} cannot fill ${step.template}: ${said}`)
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
            return yield* prompting.refuse(`the Budget is exhausted: ${decision.limit}`)
          }
        }

        const result = yield* prompting.run({
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
          yield* prompting.report([
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
          return yield* prompting.refuse(`step ${step.id}: ${judged.message}`)
        }

        yield* prompting.report([
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
          return yield* prompting.refuse(
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
          const said = repair.gaps.map(sayGap).join("; ")
          return yield* prompting.refuse(`step ${step.id} cannot fill ${template}: ${said}`)
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

  /**
   * No `steer`: a Workflow's Steps are the file's, so a line a person says
   * while one runs is refused rather than recorded and ignored — a delivery
   * record would assert something false. The current Stop Reason is the whole
   * answer, which the shared body gives.
   */
  return nativeHarness(host, { id: deps.document.id, answer })
}

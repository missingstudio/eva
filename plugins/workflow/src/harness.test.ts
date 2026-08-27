import type { Budget, BudgetState, Judged, Validator } from "@missingstudio/eva-core"
import { ValidatorError } from "@missingstudio/eva-core"
import { sessionID, type Fault, type Payload } from "@missingstudio/eva-schema"
import type { CatalogState, PromptInfo } from "@missingstudio/eva-sdk"
import { scriptedHost, type ScriptedHost } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { readWorkflow } from "./document.js"
import { makeWorkflowHarness, type WorkflowDeps } from "./harness.js"

const SESSION = sessionID("sess_workflow")

const SCHEMA = { type: "object", required: ["entries"] }

const FAULTS: readonly Fault[] = [{ at: "", wanted: "a property named entries" }]

const ROWS: readonly PromptInfo[] = [{ id: "draft", text: "Summarize: {{changelog}}" }]

// The built-in repair Template, as the plugin registers it. The harness
// reads it back from the prompt domain, so the fake rows carry it too.
const REPAIR_ROW: PromptInfo = {
  id: "workflow.repair",
  text: "{{instruction}}\n\nThe answer you gave does not conform:\n{{faults}}\n\nAnswer again with only the corrected output.",
}

const catalogOf = (held: boolean): CatalogState => ({
  providers: new Map(),
  models: held
    ? new Map([["fake", new Map([["model", { id: "model", name: "model" }]])]])
    : new Map(),
})

const judging = (answers: readonly Judged[]): Validator => {
  let at = 0
  return {
    accepts: () => Effect.void,
    check: () => Effect.sync(() => answers[Math.min(at++, answers.length - 1)] as Judged),
  }
}

const STATE: BudgetState = {
  tokens: 0,
  spend: { kind: "none" },
  milliseconds: 0,
  steps: 0,
  limits: {},
}

const countingBudget = (
  exhaustedAt?: number,
): { readonly budget: Budget; checks: () => number } => {
  let checks = 0
  return {
    budget: {
      charge: () => Effect.succeed(STATE),
      state: Effect.succeed(STATE),
      check: Effect.sync(() => {
        checks += 1
        return exhaustedAt !== undefined && checks >= exhaustedAt
          ? ({ kind: "exhausted", limit: "steps" } as const)
          : ({ kind: "affordable" } as const)
      }),
    },
    checks: () => checks,
  }
}

const ONE_STEP = readWorkflow("notes", {
  name: "Notes",
  model: "fake/model",
  steps: [{ id: "draft", template: "draft", with: { changelog: "input" }, schema: SCHEMA }],
})

const deps = (over: Partial<WorkflowDeps>): WorkflowDeps => ({
  document: ONE_STEP,
  prompts: Effect.succeed([...ROWS, REPAIR_ROW]),
  catalog: Effect.succeed(catalogOf(true)),
  validator: Effect.succeed(undefined),
  budget: Effect.succeed(undefined),
  repairs: 1,
  ...over,
})

const prompted = (watched: ScriptedHost, over: Partial<WorkflowDeps>, text = "CHANGES") =>
  Effect.runPromise(
    makeWorkflowHarness(watched.host, deps(over)).prompt(SESSION, { kind: "prompt", text }),
  )

const finishedOf = (watched: ScriptedHost): readonly Payload[] =>
  watched.reports.flat().filter((one) => one.kind === "finished")

describe("one Step that validates", () => {
  it("fills the Template, runs once, and commits one valid verdict", async () => {
    const watched = scriptedHost([{ text: '{"entries":["a"]}' }])
    const reason = await prompted(watched, {
      validator: Effect.succeed(judging([{ verdict: "valid", value: { entries: ["a"] } }])),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(1)
    expect(watched.runs[0]?.spec.intent).toBe("Summarize: CHANGES")
    // Steps do not share a history: this Step gets exactly the one human
    // message holding the Instruction.
    expect(watched.runs[0]?.history).toEqual([
      {
        author: "human",
        blocks: [
          { type: "content", block: 0, content: { type: "text", text: "Summarize: CHANGES" } },
        ],
      },
    ])
    expect(watched.reports).toEqual([
      [{ kind: "verdict", step: "draft", verdict: "valid", attempt: 1, faults: [] }],
    ])
  })

  it("hands one Step's Output to the next through a dotted path", async () => {
    const document = readWorkflow("notes", {
      model: "fake/model",
      steps: [
        { id: "draft", template: "draft", with: { changelog: "input" }, schema: SCHEMA },
        { id: "group", template: "group", with: { entries: "draft.output.entries" } },
      ],
    })
    const watched = scriptedHost([{ text: '{"entries":["a","b"]}' }, { text: "grouped" }])
    const reason = await prompted(watched, {
      document,
      prompts: Effect.succeed([...ROWS, REPAIR_ROW, { id: "group", text: "Group: {{entries}}" }]),
      validator: Effect.succeed(judging([{ verdict: "valid", value: { entries: ["a", "b"] } }])),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs[1]?.spec.intent).toBe('Group: ["a","b"]')
  })
})

describe("a refused Candidate and its Repair", () => {
  const repaired = () =>
    judging([
      { verdict: "invalid", faults: FAULTS },
      { verdict: "valid", value: { entries: [] } },
    ])

  it("commits exactly two verdicts, attempts 1 and 2, on the same Step", async () => {
    const watched = scriptedHost([{ text: "not json" }, { text: '{"entries":[]}' }])
    const reason = await prompted(watched, { validator: Effect.succeed(repaired()) })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(2)
    expect(watched.reports.flat().filter((one) => one.kind === "verdict")).toEqual([
      { kind: "verdict", step: "draft", verdict: "invalid", attempt: 1, faults: FAULTS },
      { kind: "verdict", step: "draft", verdict: "valid", attempt: 2, faults: [] },
    ])
  })

  // The one place an interrupt can cost the measurement a denominator: the
  // first-pass verdict must be on the record before the Repair is paid for.
  it("reports the first verdict before the Repair's Run opens", async () => {
    const watched = scriptedHost([{ text: "not json" }, { text: '{"entries":[]}' }])
    await prompted(watched, { validator: Effect.succeed(repaired()) })

    expect(watched.calls).toEqual(["run", "report:verdict", "run", "report:verdict"])
  })

  it("carries the refused Candidate as the prior assistant message", async () => {
    const watched = scriptedHost([{ text: "not json" }, { text: '{"entries":[]}' }])
    await prompted(watched, { validator: Effect.succeed(repaired()) })

    const history = watched.runs[1]?.history ?? []
    expect(history.map((one) => one.author)).toEqual(["human", "agent", "human"])
    expect(history[1]?.blocks[0]).toEqual({
      type: "content",
      block: 0,
      content: { type: "text", text: "not json" },
    })
  })

  it("asks again with the task, every Fault, and never the JSON Schema", async () => {
    const watched = scriptedHost([{ text: "not json" }, { text: '{"entries":[]}' }])
    await prompted(watched, { validator: Effect.succeed(repaired()) })

    const instruction = watched.runs[1]?.spec.intent ?? ""
    expect(instruction).toContain("Summarize: CHANGES")
    expect(instruction).toContain("at the root — wanted a property named entries")
    expect(instruction).not.toContain("required")
  })

  it("prefers a Template named <workflow>.repair when the domain holds one", async () => {
    const watched = scriptedHost([{ text: "not json" }, { text: '{"entries":[]}' }])
    await prompted(watched, {
      prompts: Effect.succeed([
        ...ROWS,
        REPAIR_ROW,
        { id: "notes.repair", text: "Fix it: {{faults}}\n{{instruction}}" },
      ]),
      validator: Effect.succeed(repaired()),
    })

    expect(watched.runs[1]?.spec.intent).toContain("Fix it:")
  })
})

describe("a Candidate refused twice", () => {
  it("closes with a failed Claim, no Error Class and no Stop Reason", async () => {
    const watched = scriptedHost([{ text: "bad" }, { text: "still bad" }])
    const reason = await prompted(watched, {
      validator: Effect.succeed(
        judging([
          { verdict: "invalid", faults: FAULTS },
          { verdict: "invalid", faults: FAULTS },
        ]),
      ),
    })

    // The Provider answered fine; it answered wrongly. `end_turn` is what
    // prompt answers, and the record carries neither class nor reason.
    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(2)
    const finished = finishedOf(watched)
    expect(finished).toEqual([
      {
        kind: "finished",
        claim: {
          result: "failed",
          summary:
            "step draft: the Candidate did not conform after 2 attempts: at the root — wanted a property named entries",
        },
      },
    ])
  })

  it("never repairs when the ceiling is zero", async () => {
    const watched = scriptedHost([{ text: "bad" }])
    await prompted(watched, {
      validator: Effect.succeed(judging([{ verdict: "invalid", faults: FAULTS }])),
      repairs: 0,
    })

    expect(watched.runs).toHaveLength(1)
    expect(finishedOf(watched)).toHaveLength(1)
  })
})

describe("an empty Validator slot", () => {
  it("degrades, commits unchecked, and the answer still arrives", async () => {
    const watched = scriptedHost([{ text: "plain answer" }])
    const reason = await prompted(watched, { validator: Effect.succeed(undefined) })

    expect(reason).toBe("end_turn")
    expect(watched.reports).toEqual([
      [
        { kind: "degraded", missing: ["Validator"] },
        { kind: "verdict", step: "draft", verdict: "unchecked", attempt: 1, faults: [] },
      ],
    ])
  })
})

describe("refused before the first model call", () => {
  it("refuses a JSON Schema the Validator cannot read, with no run at all", async () => {
    const watched = scriptedHost()
    const reason = await prompted(watched, {
      validator: Effect.succeed({
        accepts: () =>
          Effect.fail(new ValidatorError({ message: "the JSON Schema cannot be read" })),
        check: () => Effect.die("never reached"),
      } satisfies Validator),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(0)
    expect(watched.reports).toEqual([
      [
        { kind: "started", intent: "CHANGES" },
        {
          kind: "finished",
          claim: {
            result: "failed",
            summary: "workflow notes cannot run: step draft: the JSON Schema cannot be read",
          },
        },
      ],
    ])
  })

  it("refuses a Template the prompt domain does not hold, naming the near miss", async () => {
    const watched = scriptedHost()
    const reason = await prompted(watched, {
      prompts: Effect.succeed<readonly PromptInfo[]>([{ id: "drafts", text: "x" }]),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(0)
    const finished = finishedOf(watched)[0]
    expect(finished?.kind === "finished" && finished.claim.summary).toContain(
      "step draft: no Template is draft, did you mean drafts",
    )
  })

  // A broken repair row used to surface mid-run, after a Provider Turn was
  // paid for. The pre-flight pass dry-fills the row the Repair would use.
  it("refuses a repair Template the prompt domain does not hold, with no run at all", async () => {
    const watched = scriptedHost()
    const reason = await prompted(watched, { prompts: Effect.succeed(ROWS) })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(0)
    const finished = finishedOf(watched)[0]
    expect(finished?.kind === "finished" && finished.claim.summary).toBe(
      "workflow notes cannot run: the Repair cannot fill workflow.repair: template workflow.repair",
    )
  })

  it("refuses a shadowing <workflow>.repair row that cannot fill", async () => {
    const watched = scriptedHost()
    const reason = await prompted(watched, {
      prompts: Effect.succeed([
        ...ROWS,
        REPAIR_ROW,
        { id: "notes.repair", text: "Fix: {{schema}}" },
      ]),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(0)
    const finished = finishedOf(watched)[0]
    expect(finished?.kind === "finished" && finished.claim.summary).toBe(
      "workflow notes cannot run: the Repair cannot fill notes.repair: variable schema",
    )
  })

  // The other side: a Workflow that can never repair must not refuse over a
  // row it would never read.
  it("skips the repair Template when no Step could repair", async () => {
    const document = readWorkflow("notes", {
      model: "fake/model",
      steps: [
        // A schema with a ceiling of zero, and a ceiling with no schema:
        // neither Step can reach a Repair.
        {
          id: "draft",
          template: "draft",
          with: { changelog: "input" },
          schema: SCHEMA,
          repairs: 0,
        },
        { id: "group", template: "draft", with: { changelog: "input" } },
      ],
    })
    const watched = scriptedHost([{ text: '{"entries":[]}' }, { text: '{"entries":[]}' }])
    const reason = await prompted(watched, {
      document,
      prompts: Effect.succeed(ROWS),
      validator: Effect.succeed(judging([{ verdict: "valid", value: { entries: [] } }])),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(2)
  })

  it("refuses a model the Catalog does not hold", async () => {
    const watched = scriptedHost()
    const reason = await prompted(watched, { catalog: Effect.succeed(catalogOf(false)) })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(0)
    const finished = finishedOf(watched)[0]
    expect(finished?.kind === "finished" && finished.claim.summary).toContain(
      "step draft: the Catalog does not hold fake/model",
    )
  })

  it("refuses a document that failed the load pass, naming every problem", async () => {
    const watched = scriptedHost()
    const reason = await prompted(watched, {
      document: readWorkflow("broken", { steps: [] }),
    })

    expect(reason).toBe("end_turn")
    expect(watched.runs).toHaveLength(0)
    const finished = finishedOf(watched)[0]
    expect(finished?.kind === "finished" && finished.claim.summary).toBe(
      "workflow broken cannot run: steps is empty",
    )
  })
})

describe("the Budget", () => {
  it("is checked before every Step, Repairs included", async () => {
    const counting = countingBudget()
    const watched = scriptedHost([{ text: "bad" }, { text: '{"entries":[]}' }])
    await prompted(watched, {
      validator: Effect.succeed(
        judging([
          { verdict: "invalid", faults: FAULTS },
          { verdict: "valid", value: { entries: [] } },
        ]),
      ),
      budget: Effect.succeed(counting.budget),
    })

    expect(counting.checks()).toBe(2)
    expect(watched.runs).toHaveLength(2)
  })

  it("stops exhausted with a failed Claim, no Stop Reason, and the partial work kept", async () => {
    const document = readWorkflow("notes", {
      model: "fake/model",
      steps: [
        { id: "draft", template: "draft", with: { changelog: "input" } },
        { id: "group", template: "draft", with: { changelog: "input" } },
      ],
    })
    const counting = countingBudget(2)
    const watched = scriptedHost([{ text: "first" }])
    const reason = await prompted(watched, {
      document,
      budget: Effect.succeed(counting.budget),
    })

    expect(reason).toBe("end_turn")
    // The first Step ran and its record stands; the close is the bare
    // failed Claim, with no started of its own and no Stop Reason.
    expect(watched.runs).toHaveLength(1)
    expect(watched.reports).toEqual([
      [
        {
          kind: "finished",
          claim: { result: "failed", summary: "the Budget is exhausted: steps" },
        },
      ],
    ])
  })
})

describe("steering", () => {
  it("changes nothing and commits nothing", async () => {
    const watched = scriptedHost()
    const harness = makeWorkflowHarness(watched.host, deps({}))
    const reason = await Effect.runPromise(
      harness.prompt(SESSION, { kind: "steer", text: "faster", target: "next-step" }),
    )

    expect(reason).toBe("end_turn")
    expect(watched.calls).toEqual([])
  })

  it("answers the Stop Reason the last prompt reached", async () => {
    const watched = scriptedHost([{ stopReason: "max_tokens", text: "cut" }])
    const harness = makeWorkflowHarness(
      watched.host,
      deps({
        document: readWorkflow("notes", {
          model: "fake/model",
          steps: [{ id: "draft", template: "draft", with: { changelog: "input" } }],
        }),
      }),
    )
    await Effect.runPromise(harness.prompt(SESSION, { kind: "prompt", text: "go" }))
    const reason = await Effect.runPromise(
      harness.prompt(SESSION, { kind: "steer", text: "more", target: "next-run" }),
    )

    expect(reason).toBe("max_tokens")
  })
})

describe("the Step that stopped the Workflow", () => {
  it("answers the Provider's own Stop Reason unchanged", async () => {
    const document = readWorkflow("notes", {
      model: "fake/model",
      steps: [
        { id: "draft", template: "draft", with: { changelog: "input" } },
        { id: "group", template: "draft", with: { changelog: "input" } },
      ],
    })
    const watched = scriptedHost([{ stopReason: "refusal", text: "" }])
    const reason = await prompted(watched, { document })

    expect(reason).toBe("refusal")
    expect(watched.runs).toHaveLength(1)
  })

  it("stops on a Step whose Run failed, adding no second story", async () => {
    const watched = scriptedHost([
      { claim: { result: "failed", summary: "no provider", errorClass: "no_such_model" } },
    ])
    const reason = await prompted(watched, {
      document: readWorkflow("notes", {
        model: "fake/model",
        steps: [{ id: "draft", template: "draft", with: { changelog: "input" } }],
      }),
    })

    expect(reason).toBe("end_turn")
    expect(watched.reports).toEqual([])
  })
})

describe("sessions", () => {
  it("mints with createSession and resumes only what it minted", async () => {
    const harness = makeWorkflowHarness(scriptedHost().host, deps({}))
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* harness.createSession("/anywhere")
        return {
          resumed: yield* harness.resumeSession(session),
          rejected: yield* harness.resumeSession(sessionID("sess_elsewhere")),
        }
      }).pipe(Effect.scoped),
    )

    expect(found.resumed.kind).toBe("resumed")
    // Never `undetectable`: a native harness always knows what it holds.
    expect(found.rejected.kind).toBe("rejected")
  })
})

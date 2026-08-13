# The primitive

One type recurs at every rung. Build this type first. Everything else is a nesting of it.

```go
type Unit interface {
    Run(ctx context.Context, spec Spec, rt Runtime) Outcome
}

type Spec struct {
    Tenant      TenantID    // never retrofit this
    Actor       Identity    // user, service account, or agent
    Intent      string      // what
    Inputs      []Ref       // context refs, not blobs
    Acceptance  []Check      // machine-checkable, or it isn't a spec
    Constraints []Constraint // standing boundaries ("do not push", "no schema drops");
                             // read by the mandate check, unreachable by compaction —
                             // a boundary that lives only in the transcript is not one
    Remediation *Command     // on_failure: compensating cleanup run BETWEEN attempts,
                             // so a retried job never inherits a dirty environment
    RetryPolicy RetryPolicy  // per-task: keep failure context (avoid repeating a
                             // mistake) OR reset history to initial (avoid self-poison)
    Budget      Budget       // tokens, dollars, wallclock
    Mandate     MandateID    // authority under which this runs
}

// Runtime is Go's cancellation plumbing and rides alongside as the first argument.
type Runtime struct {
    Env       Env       // window | process | worktree | sandbox | fleet | market
    Tools     Tools     // bounded action surface
    Procedure Procedure // compiled (workflow) | interpreted (skill)
    Memory    Memory    // episodic | semantic | procedural
    Verifier  Verifier  // Spec.Acceptance -> Evidence
    Meter     Meter     // consumption, live
    Identity  Identity  // who acts
    Trace     TraceSink // append-only, always
    Hooks     Hooks     // extensions attach here — observe | veto | mutate (Part 2)
}

type OutcomeKind int // Done | Failed | NeedsHuman | Exhausted

type Outcome struct {
    Kind     OutcomeKind
    Artifact *Artifact // Done; Exhausted carries the partial
    Evidence *Evidence // Done, Failed
    Reason   string    // Failed
    Question string    // NeedsHuman
    Resume   Cursor    // NeedsHuman — the position the answer re-enters at,
                       // not the session it belongs to (ADR 0008)
    Spent    Meter     // Exhausted
}
```

**Where this is in the tree today.** The shape above is the destination, not the current
signature. What answers a prompt now is `harness.Harness`, and what it is handed is a
`Prompt`: a Spec beside the Run that is open to answer it in — the Provider, the system
prompt, and everything else a `Runtime` field names above are held by the implementation
the registry built, per [0040](../adr/0040-a-unit-holds-its-capabilities-and-execute-takes-only-a-spec.md).
There is no `Unit` interface in Go: one concept gets one name, and at this rung the name
is Harness ([0062](../adr/0062-a-harness-holds-what-a-build-gives-it-and-is-handed-the-prompt-to-answer.md)).
Unit stays the word for the thing at every rung, which is what this page is about.

`Hooks` is on the primitive for the same reason as `Tenant`. If you add an extension surface later, you must re-plumb every loop. Our harness will not build all software. Community skills, tools, and extensions must compose in. So the attachment point exists from commit one, although the extension host itself ships at stage 6.5.

Every optional capability in `Runtime` ships a null implementation from day one: `NoCompaction`, `NoMemory`, and `NoSubagents`. This is owainlewis/neo's pattern. The loop never branches on presence. A "shallow" stage means a null implementation behind the final interface. It does not mean a missing field.

## The loop, also universal

```
loop {
    if meter.exhausted()                     -> Exhausted
    action = procedure.next(rt, memory)
    action = hooks.before(action)            // veto -> NeedsHuman | mutate | pass
    if action.is_finish() {
        ev = verifier.check(spec.acceptance)
        if ev.passed { -> Done(ev) } else { memory.record(ev); continue }
    }
    if !mandate.permits(action)              -> NeedsHuman
    obs = env.apply(tools, action)
    obs = hooks.after(obs)                   // observe | rewrite result
    trace.append(action, obs); memory.update(obs)
}
```

Hooks can **narrow** the loop. A hook can veto an action, redact a result, or inject context. Hooks can never **widen** the loop. A hook cannot grant what the mandate denies. The kernel keeps policy enforcement. Hooks are advisory-restrictive.

Two more loop invariants are cheap now and structural later. **Errors are data.** Denied, unknown, failed, canceled, and skipped tool calls all return error-shaped results. The model can recover from these results. So the transcript stays structurally valid for the next provider call. **Budget exhaustion is also data.** When the meter denies a call, the denial enters the transcript as a recoverable result — it is not a process kill from outside. The agent reads "budget reached", summarizes its partial work, and returns `Exhausted` with the partial artifact, instead of dying mid-turn. The top-of-loop `meter.exhausted()` guard is the backstop; the denied call is the graceful path. **The commit is atomic.** An assistant message and all of its tool results enter the transcript together. No `tool_use` is ever persisted without its `tool_result`. Resume, replay, branching, and compaction all depend on these two invariants.

## The composition rule

```go
// any Unit is a tool to a parent Unit
func AsTool(u Unit) Tool { return toolAdapter{u} }
```

That one line *is* the ladder. A harness is a Unit whose tools include subagent Units. A factory is a Unit whose tools include harness Units plus a scheduler. A company is a Unit whose tools include factory Units plus a treasury.

## Same type, five scales

| Rung       | Env            | Procedure         | Evidence               | Timescale |
| ---------- | -------------- | ----------------- | ---------------------- | --------- |
| Model call | context window | prompt            | schema valid           | ms        |
| Workflow   | process        | compiled pipeline | assertions pass        | seconds   |
| Agent      | worktree       | interpreted skill | tests green            | minutes   |
| Harness    | sandbox        | profile           | suite green, in budget | hours     |
| Factory    | fleet          | scheduler policy  | merge queue green      | days      |
| Company    | market         | mandate           | retention, margin      | months    |

Only three things change as you climb: the timescale, what counts as evidence, and how much the mandate grants. The type signature never changes.

**One thing does not compose for free: the verifier.** Each scale must produce its evidence natively. You cannot sum passing unit tests into "the company is healthy". Every new rung needs a new oracle. To invent that oracle is the real work of climbing.

## Workflows and skills

The artifact type is the same: a captured procedure. The executor is different.

- A **workflow** is a procedure that your *code* executes. The sequence is fixed. The model fills the slots. It is compiled.
- A **skill** is a procedure that the *model* executes. The instructions and resources load into the context. It is interpreted.

A skill can invoke a workflow. A workflow can load a skill. Prefer the workflow when a procedure is fully deterministic. The workflow is cheaper, and it cannot drift.

---

# Eva

**Status: draft.** This document describes what Eva will be, not what it is. No code exists yet and stage 0 has not started. Verification basis: none — there is no implementation to verify against. The first stage to ship sets this to its commit.

**Stage 0's event schema is settled and is no longer a draft.** It was resolved in a design session on 2026-08-08 and now lives in `docs/adr/0001`–`0008`, which own the reasoning. Part 2 below carries the resulting shape only. Where the two ever disagree, the ADRs win.

Two later decisions also override this document: `docs/adr/0009` fixes config and profiles as TOML, and `docs/adr/0010` fixes the module layout, which differs from the tree in the final-repo-shape section below.

One document. It goes from a single model call to an autonomous, multi-tenant software factory. It gives the frame, the primitive, the target architecture, the production platform, and the staged build path that connects them.

**Implementation language: Go.** Use interfaces, not inheritance. Use one `go.work` workspace. Keep imports between layers one-way. All code sketches below are Go.

**Name: Eva.** Decided on 2026-08-08. The other candidates collide with names in the same niche. **Tau** is twotimespi.dev's educational coding agent (`tau_ai`/`tau_agent`/`tau_coding`). **Neo** is owainlewis/neo, an MIT-licensed Go coding agent paired with owainlewis/factory. Eva has no collision with a coding agent or a factory. The nearest names are a voice-agent eval framework, a pentest agent, and an Emacs assistant. Eva also reads as eval and evidence, which fits a verifier-centric factory.

---

## Contents

- [Part 0 — The frame](#part-0--the-frame)
- [Part 1 — The primitive](#part-1--the-primitive)
- [Part 2 — Target architecture](#part-2--target-architecture)
- [Part 3 — Production platform](#part-3--production-platform)
- [Part 4 — The build path](#part-4--the-build-path)
- [Part 5 — Sequencing rules](#part-5--sequencing-rules)

---

# Part 0 — The frame

## The ladder, with its missing rungs

The usual chain is model → agent → harness → factory → company. This chain skips five rungs. Each omission is a known failure mode. The full ladder is below.

**model → workflow → agent → environment + verifier → harness → scheduler + spec → factory → learning loop + economics → intent + authority → company**

|     | Rung                                      | What it is                                        |
| --- | ----------------------------------------- | ------------------------------------------------- |
| 1   | **Model**                                 | a next-token function, no state                   |
| 2   | **Workflow** *(missing)*                  | code holds the control flow                       |
| 3   | **Agent**                                 | model holds the control flow                      |
| 4   | **Environment + verifier** *(missing)*    | sandbox, tests, a cheap oracle                    |
| 5   | **Harness**                               | context, tools, policy, budget                    |
| 6   | **Scheduler + spec format** *(missing)*   | work queue, machine-checkable acceptance criteria |
| 7   | **Software factory**                      | parallel agents, merge queue                      |
| 8   | **Learning loop + economics** *(missing)* | evals, cost per merged change                     |
| 9   | **Intent + authority** *(missing)*        | who decides, who is liable                        |
| 10  | **Autonomous company**                    | sets and funds its own goals                      |

**Model → Agent skips the workflow.** The difference is not smart against dumb. The difference is *who owns the control flow*. Most agent failures are workflows given to the model too early.

**Agent → Harness skips the environment and the verifier.** An agent depends on two things: the world it acts in, and the signal that tells it that it is wrong. Agents converge when a cheap oracle exists. Agents fail when no oracle exists, even with a strong model.

**Harness → Factory skips the scheduler and the spec format.** A factory is not "more agents". A factory is a durable queue plus a machine-readable work item. A ticket written for a human is not a spec. It has no criteria that a machine can check.

**Factory → Company skips two rungs.** A factory consumes specs. A company generates specs, and answers for them.

## The law

The whole ladder is one loop. The loop repeats at longer timescales: token (ms) → task (minutes) → session (hours) → change (days) → product (months).

**Every rung is missing the same three things at that rung's timescale: a verifier, a memory, and a delegated authority.**

## Invariants — hold these from the first commit

These are cheap on day one. They are very expensive to add on day four hundred.

1. **Everything is a trace.** Every model call, tool call, and decision appends to an append-only trajectory. There are no quick paths.
2. **All side effects go through the tool registry.** You cannot sandbox, meter, or audit code that touches the filesystem, the network, or the shell outside a registered tool.
3. **Every long operation is resumable.** Keep state on disk, not in a process.
4. **The harness boundary enforces the budgets** — tokens, dollars, and wall clock.
5. **Escalation to a human is a first-class outcome**, not an error. `NeedsHuman(reason)` is a valid return type.
6. **Config is a versioned file, not a flag.**
7. **Tenant and actor are on the primitive from commit one.** See Part 1.
8. **One event schema, everywhere.** Every observable thing is an instance of one versioned, typed event schema: a model chunk, a tool call, a retry, an approval, a diff, or an escalation. Stage 0 defines this schema. The trace is the persisted event stream. Every UI is a fold over the stream. Adapters normalize their output into the schema. Hooks subscribe to the stream. There is no second vocabulary. 

**The schema must be complete at stage 0**, because a field added later breaks every registered adapter and every stored trace. Completeness means: retries are events (they spend money and wall clock but emit no tool call), every event carries parent linkage for subagent attribution, and usage accounts separately for cache **writes** and cache **reads** — which are priced differently — as well as for reasoning tokens where a provider reports them at all. A schema missing these silently corrupts the cost numbers the business is sold on (Part 3).

The schema is now settled: see `docs/adr/0001`–`0008` for the decisions and Part 2 for the shape. An unreported field is `nil`, never `0` — Anthropic bills thinking tokens inside output tokens and reports no reasoning figure, so a zero there would be a confident lie rather than a measurement.

9. **Every mutation is idempotent.** Every mutating call carries a request key: task creation, trigger admission, and enrollment. An exact replay returns the original record. A reuse of the key with different input is a visible conflict. Machine-generated work uses deterministic keys in a reserved namespace. A crash or a lost response can never produce zero records or two records.

---

# Part 1 — The primitive

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

// Runtime is what Rust would call Ctx — renamed because context.Context
// is Go's cancellation plumbing and rides alongside as the first argument.
type Runtime struct {
    Env       Env       // window | process | worktree | sandbox | fleet | market
    Tools     ToolSet   // bounded action surface
    Procedure Procedure // compiled (workflow) | interpreted (skill)
    Memory    Memory    // episodic | semantic | procedural
    Verifier  Verifier  // Spec.Acceptance -> Evidence
    Meter     Meter     // consumption, live
    Identity  Identity  // who acts
    Trace     TraceSink // append-only, always
    Hooks     HookBus   // extensions attach here — observe | veto | mutate (Part 2)
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

`Hooks` is on the primitive for the same reason as `Tenant`. If you add an extension surface later, you must re-plumb every loop. Our harness will not build all software. Community skills, tools, and extensions must compose in. Thus the attachment point exists from commit one, although the extension host itself ships at stage 6.5.

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

Two more loop invariants are cheap now and structural later. **Errors are data.** Denied, unknown, failed, canceled, and skipped tool calls all return error-shaped results. The model can recover from these results. Thus the transcript stays structurally valid for the next provider call. **Budget exhaustion is also data.** When the meter denies a call, the denial enters the transcript as a recoverable result — it is not a process kill from outside. The agent reads "budget reached", summarizes its partial work, and returns `Exhausted` with the partial artifact, instead of dying mid-turn. The top-of-loop `meter.exhausted()` guard is the backstop; the denied call is the graceful path. **The commit is atomic.** An assistant message and all of its tool results enter the transcript together. No `tool_use` is ever persisted without its `tool_result`. Resume, replay, branching, and compaction all depend on these two invariants.

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

# Part 2 — Target architecture

## The six targets

1. **Autonomous control plane with a live dashboard.** The dashboard is a projection over the trace stream. It shows every task, worker, lease, dollar, and escalation in flight. It gives the operator controls to intervene.
2. **Daemons join from anywhere and pull the work that they can do.** Enrollment is outbound-only and uses a token. The scheduler matches work to capabilities.
3. **Daemons advertise their harness inventory.** The capability advertisement includes the installed harnesses and their versions.
4. **Eva can run any harness.** Eva, Claude Code, Codex, OpenCode, and the next tool to ship all run behind one adapter contract.
5. **Portable skills and defined protocols.** One skill source of truth compiles per harness. Tools interoperate over MCP. The task graph mediates each agent handoff.
6. **Community-extensible core.** Events and hooks are part of the harness contract. They are not an afterthought. Skills, tools, checks, commands, and UI compose in from the ecosystem. Anyone can express as an extension what we can express as an extension.

## Architecture in one paragraph

The control plane holds the task graph, the specs, the mandates, the scheduler, and the trace store. Daemons hold the compute, the environments, and the harnesses. A daemon dials out and holds a stream. The control plane leases a task to a daemon whose capabilities match the requirements of the spec. The daemon creates a sandboxed workspace. It invokes the selected harness through an adapter. It collects a candidate diff. It runs the verifier that the control plane defines against that diff. It returns an outcome with evidence. The dashboard is a read model. It folds the trace stream. **Nothing in this description changes between one laptop and a thousand workers.**

## The ownership boundary — the load-bearing decision

Eva supports third-party harnesses. Thus Eva is no longer *a* harness. Eva is the control plane that makes harnesses interchangeable. This works only if Eva never delegates some things.

| Eva owns — never delegated               | Harness owns — swappable             |
| ---------------------------------------- | ------------------------------------ |
| Task spec and acceptance criteria        | Prompting strategy                   |
| Workspace creation, snapshot, rollback   | Context assembly and compaction      |
| The verifier and what counts as evidence | Tool-calling loop and retry behavior |
| Trace schema and trace store             | Internal subagent decomposition      |
| Budget enforcement and the mandate       | Edit generation strategy             |
| Merge authority                          | —                                    |

**When a harness reports success, that report is an unverified claim.** The harness ran inside a sandbox that you created. It ran against criteria that you wrote. You run the checks again.

### The second ownership boundary — kernel vs. extension

The table above governs what Eva delegates to *foreign harnesses*. This table governs what Eva opens to *its own ecosystem*. The logic is the same. Eva never delegates some things.

| Kernel — never pluggable                      | Extension points — pluggable via published interfaces                      |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| Event schema and trace store                  | Providers (`Provider` interface: anthropic, openai-compat, local)          |
| Spec, budget, and mandate enforcement         | Harnesses (`Harness` interface — below)                                    |
| Verifier contract and what counts as evidence | Envs (`Env` interface)                                                     |
| Tenancy and identity                          | Tools (registry)                                                           |
| Scheduler and lease semantics                 | Skills and workflows                                                       |
| Permission/policy enforcement point           | **Hooks** — observe/veto/mutate at loop lifecycle points                   |
| Merge authority                               | **Verifier checks** — `RegisterCheck`: evidence-producing, so safe to open |
|                                               | **Frontends** — TUI, web, JSON: pure consumers of the event stream         |
|                                               | **Importers/exporters** — Linear, GitHub issues → spec                     |
|                                               | **Dashboard panels** — projections over the trace stream                   |

The rule is the same as in the harness table. Kernel concerns never run third-party code in-line. Everything else is an interface implementation or an event subscription. Hooks can **narrow** permissions. Hooks can never widen them.

**The payoff:** every harness faces the same spec, the same workspace, and the same oracle. Thus you can race the harnesses on identical tasks and score the results. The verifier picks the best of N, not your preference. After a few thousand tasks, these results become a routing table. The table shows which harness is better at migrations, at test-writing, and at refactors. No single-harness tool can build that data, and thus the data is a moat.

## Harness adapter contract

```go
type Harness interface {
    ID() HarnessID                                          // "claude-code@2.1", "eva@0.9"
    Probe(ctx context.Context) (Capabilities, error)        // static: installed? version?
    Run(ctx context.Context, job Job) (<-chan Event, error) // normalized events out
    Cancel(run RunID) error
}
// Capability is discovered TWICE and the per-run value wins. The static Probe
// answers "installed, which version". The Started event carries the run's actual
// capabilities, because they vary by configuration — bare mode, managed settings,
// a missing MCP server all change what a run can do. Feature-detect on the per-run
// value; never compare version strings to infer capability.

type Job struct {
    Spec      Spec        // Eva's spec, not the harness's
    Workspace string      // already sandboxed and snapshotted
    Budget    Budget      // enforced by wall clock + process kill, not trust
    Tools     ToolPolicy  // what the adapter permits through
    Skills    []SkillRef  // compiled to native format before launch
    MCP       []MCPServer // Eva's verifier, repo map, memory
}

// Event is THE platform event schema (invariant 8) — the same type Eva's own
// loop emits from stage 0. Adapters normalize foreign output into it;
// there is no adapter-only vocabulary.
//
// SETTLED. The reasoning for every line below is in docs/adr/0001-0008.
// This block is the shape; the ADRs are the argument. Do not re-derive it here.
const SchemaVersion = 1     // additive changes keep it; removals, retypes,
                            // renames, enum narrowings increment it (ADR 0006)

type Event struct {
    // Envelope: everything a projection needs to FOLD or FILTER (ADR 0001).
    ID      EventID
    Seq     uint64     // per-Session, assigned BY THE SINK at commit  (ADR 0008)
    WireSeq uint64     // per-connection, assigned by the producer     (ADR 0008)
    At      Timestamp  // monotonic + wall clock; stage 6 needs latency per step
    Version uint32     // the SchemaVersion this record was written under
    Kind    Kind       // closed set; an unrecognized kind arrives as Unknown
                       // and marks the run Degraded — never dropped (ADR 0002)
    Tenant  TenantID   // populated from commit one, before tenant two exists
    Actor   Identity
    Run     RunID
    Session SessionID
    Parent  *RunID     // the tool call that spawned this unit; nil on the main
                       // conversation. Without it a nested subagent's events
                       // cannot be attributed in the fold and the dashboard
                       // cannot attribute cost per task.

    // Payload: display-only detail. Sealed interface, so the closed kind set is
    // enforced by the compiler rather than by review (ADR 0005).
    Payload Payload
}

type Payload interface{ isPayload() }

// Started    { Capabilities Capabilities }   // per-run, and the per-run value wins
// Text       { Block int, Chunk string }     // coalesced by the sink (ADR 0004)
// ToolCall   { Name string, Args json.RawMessage, Redacted bool }
// ToolResult { Name string, Disposition Disposition, Bytes int }
//              Disposition from a closed set (ADR 0007): ok | denied | failed |
//              skipped | cancelled | unknown_tool | budget_denied. Each implies a
//              different recovery, so one boolean would make the model guess.
// Usage      { InputTokens, OutputTokens, CacheWriteTokens, CacheReadTokens uint64
//              ReasoningTokens, ServerToolTokens *uint64, USD *float64 }
//              cache WRITE and READ are priced differently, so one field cannot
//              compute cost. nil != 0: nil means the provider did not report it,
//              0 means none were used. USD is never an estimate. (ADR 0003)
// Retry      { Attempt, Max int, DelayMS int, ErrorClass string }
//              a retry spends money and wall clock but produces no ToolCall;
//              ErrorClass from a fixed set: rate_limit | overloaded |
//              auth_failed | server_error | other
// Edit       { Path string, Hunks int }
// NeedsHuman { Question string, Resume Cursor }  // may fire mid-tool-call
//              (§ Escalation). Resume is the position the answer re-enters at,
//              not the session it belongs to.
// Finished   { Claim Claim }   // a claim, not a verdict
// Degraded   { Missing []string }  // optional; presence IS the degraded flag —
//              e.g. plugin/mcp start errors. Absent when clean, so a CI gate
//              fails on a non-empty array without a separate boolean (rule 8).
// Unknown    { Kind string, Raw json.RawMessage }   // ADR 0002
```

### Capability matrix

The scheduler does not route a task to a harness that lacks a required capability.

| Capability          | Meaning                         | If absent                                                    |
| ------------------- | ------------------------------- | ------------------------------------------------------------ |
| `resume`            | continues an interrupted run    | restart from snapshot                                        |
| `cost_report`       | emits real token/dollar usage   | estimate from wall clock; excluded from precise cost reports |
| `structured_events` | machine-readable stream         | adapter scrapes; trace marked `degraded`                     |
| `tool_policy`       | honors external allowlist       | hard sandbox, egress denied, no secrets                      |
| `mcp`               | speaks MCP                      | verifier/repo-map exposed as shell shims                     |
| `subagents`         | internal parallel decomposition | decompose at task-graph level instead                        |
| `interrupt`         | clean cancel                    | process kill, workspace rollback                             |

**Design rule:** a missing capability degrades the run. It never blocks the platform. Every gap has a defined fallback. Eva flags degraded runs and excludes them from eval scoring.

### Conformance suite

Before registration, every adapter must do these things. It must emit all mandatory events. It must respect the budget kill. It must cancel cleanly. It must produce an applicable diff. It must never write outside the workspace. It must never exfiltrate a canary secret planted in the environment. An adapter that fails is registerable only at the `untrusted` tier. Run this suite each night against the upstream releases.

## Skills — one source, many dialects

```
skills/
  migrate-db/
    SKILL.md          # frontmatter: name, description, triggers, requires
    reference.md      # loaded on demand, not up front
    scripts/check.sh  # deterministic bits stay deterministic
```

```yaml
---
# portable core — the agentskills.io open standard; runs unmodified on any
# conforming tool (Claude Code, Cursor, …). Eva is a SUPERSET: conform, extend.
name: migrate-db
description: Add a reversible schema migration following repo conventions
license: Apache-2.0
compatibility: ">=0.9"
allowed-tools: [bash, mcp/eva-verifier]   # pre-approved ONLY for the invoking turn;
                                          # the grant clears on the next message
metadata: {}
# Eva extensions beyond the portable core
requires: [tools/bash, mcp/eva-verifier]  # additive: tools this skill needs
disallowed-tools: [ask_user_question]     # SUBTRACTIVE: remove tools while active —
                                          # an unattended daemon skill must be able to
                                          # drop the interactive tools, not merely omit
disable-model-invocation: true            # only a human may invoke (/migrate-db); the
                                          # model may never trigger it. Same control as
                                          # stage 9a's "autonomous admitters start
                                          # disabled" — belongs on any side-effecting skill
tier: semi                                # minimum worker trust tier
---
```

The compilation targets are Eva native, `SKILL.md`, `AGENTS.md` sections, and plain system-prompt injection. **The portable core (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`) is named explicitly, and the compiler fails closed on an unknown field — it does not drop it silently** (rule 13). Conforming to the open standard is a strategic freebie: every skill already written for another tool runs on Eva unmodified, so the skill format leads the ecosystem at zero authoring cost. The compiler loses data in one direction only. A skill must degrade to instructions when a harness has no skill mechanism. One expansion variable (`${SKILL_DIR}`) substitutes in both the body and the `allowed-tools` bash rule, so a bundled script stays pre-approved wherever the skill installs and the instruction and the rule cannot drift. Execution topology (which executor, forked or not) stays **out** of the skill file — that is what keeps a skill portable across harnesses; the executor is chosen by the profile.

**Skills are data.** A `SKILL.md` directory carries no code-execution risk more than what its `requires:` field grants. Thus community skills are the *cheapest* thing to accept, and the skill format leads the ecosystem. Extensions do run code. Extensions get the heavier machinery below.

## Extension system — events and hooks are the harness contract

Our harness will not build all software here, and we will not build all of it. The extension system lets community skills, tools, checks, and workflows compose in. They compose in without a fork of the core. The design rule comes from pi: **primitives, not features**. The core stays small. Capability arrives as packages.

### Hook surface

Hooks subscribe to the one event schema (invariant 8) at named lifecycle points. There are powers, in order of increasing trust. **Observe** reads the stream. **Veto** blocks with a reason. **Mutate** is not one generic power — it splits into two named, typed fields so the trace (and `attest/`) records *what class of thing* an extension changed: **`updatedInput`** rewrites tool arguments before execution, **`updatedResult`** rewrites the result before it reaches the model. A veto returns an explicit **decision** — `allow | deny | ask | defer` — where `defer` means "no opinion, run the normal flow". The abstain value is mandatory: on a frozen public API, a hook that returns nothing is otherwise ambiguous between "no opinion" and "the hook failed", and that ambiguity is permanent.

Injection uses one field, not one event: any event may carry **`additionalContext`** (text the model sees on its next request), so an extension injects at the point where it learned something rather than waiting for a separate callback.

The catalog is deliberately small — roughly a dozen points that map to loop events Eva already has, versioned (invariant 8). We do **not** chase a competitor's ~30-event surface; breadth on a frozen contract is a permanent maintenance tax (see Not-adopted, Part 5).

```
session_start(source: startup|resume|compact|fork) | session_end
before_agent_start            # inject context, adjust system prompt
tool_call                     # decision {allow|deny|ask|defer} + updatedInput
tool_result                   # updatedResult before it reaches the model
tool_batch                    # after a parallel group resolves, before the next
                              # model call — carries has_failures; the cheapest
                              # place to run an incremental verifier check
pre_compact(reason) | post_compact   # pre_compact may block, to pin context
                              # that must survive; post_compact observes
subagent_start | subagent_stop
permission                    # fires at the mandate boundary — custom approval flows
instructions_loaded           # which memory/rule files loaded and why — a
                              # tenant-isolation compliance seam
context                       # filter/reorder messages before each model call
before_provider_request | after_provider_response
outcome                       # observe Done | Failed | NeedsHuman | Exhausted
```

### Handler types — orthogonal to the runtime tiers

A runtime tier says how a hook is *transported* (compiled-in, subprocess, wasm — below). A handler type says what the hook *is*. The two are orthogonal; a subprocess transports, an `http` hook targets. Four types:

- **`command`** — a process reads the event as JSON on stdin, returns a typed response. The default.
- **`http`** — POST the event to a URL. This is how a tenant plugs an existing compliance service into every diff **without shipping code into Eva** — the strongest fit for the enterprise story.
- **`mcp_tool`** — call a tool on a connected MCP server. Reuses Eva's own MCP surface (verifier, repo map) as a hook target with no new wiring.
- **`model`** — the hook *is* a model call: a fast yes/no ("is this command safe?", "does this diff match the spec's intent?"), or a read-only subagent that verifies a condition before deciding. This is a **soft verifier** for what no deterministic check covers. It is budgeted and traced like any other unit, and its evidence is marked `degraded` — it may narrow a decision but **never blocks a merge** (only deterministic gates do, stage 8).

### Registrations

```go
type Extension interface {
    Manifest() Manifest                 // name, version, events-schema version, requested hooks
    Attach(host Host) error
}

// Host — what an extension may do:
//   On(event, handler)                        hooks above
//   RegisterTool(schema, fn)                  new LLM-callable tool
//   RegisterCommand(name, fn)                 slash command
//   RegisterCheck(name, fn)                   verifier check — the sleeper: compliance
//                                             scanners, license checks, org-specific
//                                             analysis. Evidence-producing, not
//                                             authority-holding, so safe to open. A
//                                             check may be a `model` handler (soft
//                                             verifier) — budgeted, traced, evidence
//                                             marked degraded; narrows, never merges.
//   RegisterMonitor(name, cmd)                background push channel: each stdout line
//                                             of a long-running command is delivered to
//                                             the running unit as a notification. The
//                                             loop is otherwise strictly pull; this is
//                                             how an unattended job learns CI went red
//                                             or its own deploy is failing, without
//                                             polling and without a new turn.
//   RegisterRenderer(kind, fn)                custom display for an event kind
```

### Runtime tiers — Go decides this for us

Go has no usable in-process dynamic loading. The `plugin` package is Linux-only and toolchain-locked. This forces the honest answer: process isolation.

| Tier            | Mechanism                                                        | Trust level    | Use                                          |
| --------------- | ---------------------------------------------------------------- | -------------- | -------------------------------------------- |
| **compiled-in** | Go interfaces, first-party features built as extensions          | ours           | plan mode, todo, permission UI — dogfooding  |
| **subprocess**  | go-plugin-style child process, gRPC over the event/hook protocol | user-installed | community default; full hook surface         |
| **wasm**        | wazero (pure Go, no CGO), capability-scoped imports              | untrusted      | repo-checked-in hooks, marketplace long tail |

Subprocess extensions speak the *same* protocol that the control plane speaks to daemons. There is one wire vocabulary. Thus a hook that works locally also works against a remote session. The wasm tier can ship after the subprocess tier. The host interface is identical.

### Packaging and distribution

An **eva package** bundles extensions, skills, workflows, and themes. The package is a git repo or a registry artifact. Its manifest pins the event-schema version that it was built against. The commands are `eva ext install <git-ref|name>`, `eva ext ls`, `eva ext rm`, and `eva ext init` (scaffold a package that loads on the next session with no marketplace or install step — the first-extension path must not require a git remote, or the ecosystem gets no contributors). **The registry pins each approved package to a commit SHA, never to a git ref.** A ref moves; a SHA does not. This is the difference between a registry and a supply-chain hole, and it costs nothing to do from the start. CI bumps the pin as the author pushes; a nightly sync from the review pipeline decouples approval from availability. A hosted marketplace is a later moat. pi runs one.

### Trust tiers — mirrors the worker tiers

| Source            | Default                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| user-installed    | full hook surface, user-approved at install                                                                                  |
| repo-checked-in   | **denied**; loads only after an explicit trust grant, wasm tier only, and never on workers holding secrets above `untrusted` |
| dashboard plugins | browser-side only, no daemon access (pi-web's restraint)                                                                     |

The `.eva/` directory of a cloned repo is untrusted content. It is in the same category as a fetched web page. It is a prompt-injection surface, not a convenience feature (see Risks).

### The dogfooding rule

**We build as an extension anything that can be an extension.** Plan mode, todo tracking, notifications, and the permission-prompt UI are all compiled-in extensions. They use the same `Host` interface that the community gets. If the hook API cannot express an Eva feature, the API is too weak. We find this out cheaply, in-house.

## Protocols — three axes, three answers

**Tools — MCP.** Eva exposes its verifier, repo map, memory, and task graph as MCP servers. Any harness that speaks MCP gets them with no bespoke work. This is the interoperability win.

**Control plane ↔ daemon — one bidirectional stream.** Use gRPC bidirectional streaming or WebSocket. Leases go down. Events go up. The worker connects outbound only.

The stream is **cursor-addressed**. Every event carries a monotonic per-connection sequence number (`Event.WireSeq`). Consumers acknowledge by cursor. A side that reconnects resumes from its last committed cursor, and the peer replays. The cursor advances only after a durable commit. Thus a dropped connection can never lose trace events. Lost events poison the eval suite (risk #3).

**`WireSeq` is not `Seq`** (ADR 0008). `WireSeq` is wire position, assigned by the producer. `Seq` is trace position, assigned by the sink at commit, per Session. They diverge by construction, because the sink coalesces many wire chunks into one trace event and appends an assistant message together with all of its tool results as one atomic write. The two meet at exactly one point: the sink's successful append, which is the only thing that may advance a cursor.

**Unit ↔ unit — the task graph mediates, not direct chat.** Unit A emits an artifact and evidence. The control plane routes them as input to the spec of Unit B. Every hop is budgeted, traced, replayable, and verified. Direct messaging exists only between a parent harness and its own subagents. It stays inside one budget and one trace.

> Free-form agent-to-agent chatter is the most common cause of unbounded spend in multi-agent systems. It is also the most common cause of failures that you cannot explain. A structured handoff costs a little expressiveness. It gives you the full debuggability of the platform.

### Escalation from inside a run — a design track

`NeedsHuman` is currently an outcome of a whole `Unit`. That is the wrong shape for one case the factory hits constantly: a tool (or an MCP server deep inside a tool call) needs a human answer *and must resume the same call with it*. No shipped harness solves this for a remote fleet — the human is never at the worker. So this is Eva's to design, not to adopt.

The path a question travels: it rises up the lease to the control plane, appears in the dashboard's **Attention** view ranked by cost of delay, and travels back down to a worker that is **still holding the lease and its deadline**. Two mechanisms are load-bearing and must be designed together, because they interact: the lease clock must *pause* (or extend) while a run is blocked on a human, or the escalation races the deadline and the task requeues under the operator's nose; and the answer must re-enter the exact call via the resume cursor, not restart the run. Emit `NeedsHuman{Question, Resume}` as a mid-stream event (not only a terminal outcome), hold the lease in a `blocked-on-human` state that does not count against the progress signal (below), and route the answer back on the same cursor-addressed stream.

**Falsifier:** if a harness ships an externally-usable elicitation-through-lease mechanism, adopt its shape instead. Until then, treat this as unexplored and over-invest.

## Enrollment — daemons join from anywhere

**The worker never listens, and the join token is never the runtime credential.**

There are three token tiers. Each tier is narrower and shorter-lived than the tier before it.

```
join token        ttl 10m,   single use,     claims: {role, tier, max_concurrency}
worker credential ttl 24h,   auto-rotating,  claims: {worker_id, capabilities, mandate}
lease token       ttl=lease, one task,       claims: {task_id, repo, env, budget}
```

The flow is: the operator mints a join token → the worker dials out over TLS and presents it → the control plane issues a rotating worker credential → each leased task runs under a lease token that ends with the lease.

The join token proves that *you were invited*. The worker credential proves *which worker you are*. The lease token proves *what you may do right now*. If an attacker takes one of them, the cost is a bounded window. Rotation matters more than length. A 24h credential that rotates each hour and refuses replayed predecessors detects theft. A 90-day static token does not detect theft.

**Local is not a special case.** `eva daemon` with no arguments starts an embedded control plane on loopback and enrolls automatically. There is one code path from day one. Thus you never find at stage 12 that remote workers use a different half of the system.

### Capabilities, not trust

The worker advertises what it can do. The control plane decides what it may do. Never let the self-report of a worker set its own scope.

```yaml
# worker advertises
capabilities:
  env: [container, worktree]
  harnesses: [eva@0.9, claude-code@2.1, codex@1.4]
  arch: arm64
  network: egress-restricted
  repos: [eva, api]

# control plane assigns — authoritative
tier: untrusted
mandate: builder-readonly
max_budget_usd: 2
secrets: none
```

| Tier        | Typical host               | May run                               | Secrets                   |
| ----------- | -------------------------- | ------------------------------------- | ------------------------- |
| `trusted`   | your workstation, colo box | any profile, prod-adjacent            | scoped, short-lived       |
| `semi`      | your VPC runners           | build, test, PR-open                  | per-task, at env boundary |
| `untrusted` | anyone's machine, CI       | sandboxed build + test only, no merge | never                     |

Untrusted workers return a diff and evidence. They never hold merge authority. Thus you can defend the use of compute from machines that you do not control.

### Scheduling as matching

A task requires `env=container, repo=api, harness=claude-code, tier>=semi` → find an eligible worker with budget headroom → issue a lease. Leases have deadlines. A missed heartbeat expires the lease. The scheduler then requeues the task and increments the attempt count. Idempotency keys on side effects prevent a double landing.

**Heartbeat is liveness, not progress.** A worker can heartbeat perfectly while making no progress at all — stalled on a loop, waiting on a dead dependency, spinning. So the worker also emits a distinct **progress signal** (events advancing, the meter moving), and the scheduler may reclaim a lease from a worker that is live-but-idle, not only one that has gone silent. A run blocked on a human escalation (see Part 2) is exempt — it is idle by design, and its `blocked-on-human` state does not count against the progress signal.

### Revocation

Every action carries this chain: lease token → worker credential → join token → operator and mandate. You can revoke at any level of that chain. The revocation takes effect within one heartbeat. `eva halt` broadcasts a drain. Abandoned leases roll back to the snapshot.

**Enrollment is mandate issuance.** Build it that way now. Then the governance requirements in Part 3 are mostly reporting.

## CLI surface

```
# control plane
eva control up --bind 0.0.0.0:7777
eva enroll create --tier semi --role builder --ttl 10m --uses 1
eva workers ls | evict <id>
eva enroll revoke <token-id>

# worker, anywhere
eva daemon --join https://cp.example.com --token eva_jt_...
eva daemon                      # local: embedded CP, auto-enrolled

# extensions
eva ext install <git-ref|name> | ls | rm
```

One command and one pasteable token, from anywhere. That is the ergonomic bar.

## The dashboard

The dashboard is not a database with a UI. It is a **projection**. It folds the trace stream into read models. You can rebuild these models from the start at any time.

| View          | Contents                                                                |
| ------------- | ----------------------------------------------------------------------- |
| **Now**       | active leases, worker, harness, task, elapsed, spend, live tail         |
| **Queue**     | backlog by priority, blocked-on, starved tasks                          |
| **Fleet**     | workers, tiers, capabilities, harness inventory, heartbeat, utilization |
| **Money**     | spend by task/profile/harness, cost per merged change, burn vs. cap     |
| **Attention** | escalation inbox — the only view a human must open daily                |
| **Quality**   | eval trend, pass@1 by harness, human-touch rate, revert rate            |

Ship a TUI (`eva top`) before the web app. It shows the same data. It has no authentication surface. It works over SSH. It also forces the projection layer to exist independently of any UI framework.

**The most important metric is human minutes per merged change.** It is the only number that tells you whether autonomy increases.

---

# Part 3 — Production platform

## Tenancy model

The control plane can be shared. **The data plane never can.**

| Concern                        | Isolation                                                                                                 | Why                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Task graph, specs, projections | shared DB, `tenant_id` on every row, enforced at the **query layer** (RLS or a non-bypassable repository) | cheap, data is small                                               |
| Traces and artifacts           | shared object store, tenant-prefixed keys, **per-tenant envelope encryption**                             | large; cheap to segregate by key; satisfies deletion               |
| **Execution**                  | **hard isolation, one tenant per VM, destroyed per task**                                                 | you are running model-generated code                               |
| Secrets                        | per-tenant vault namespace, separate KMS key                                                              | blast radius                                                       |
| Scheduling                     | per-tenant queues, weighted fair share                                                                    | one tenant's 500-task backlog must not starve another's urgent one |

**Application-layer tenant filtering is not isolation.** If a missing `WHERE tenant_id = ?` can leak data, you will ship that bug in the end. Bind the tenant to the connection, not to an argument.

## Execution isolation

You operate a code-execution service. The threat model is Modal or Fly, not a normal SaaS.

- Use a microVM (Firecracker) or gVisor. Do not use containers on a shared kernel.
- Start a fresh rootfs from a snapshot. Destroy it after the task. Never reuse a rootfs across tenants.
- Deny egress by default. Use a per-profile allowlist.
- Give no access to the cloud instance metadata. That is the classic SSRF-to-credentials path.
- Set hard caps on CPU, memory, disk, PIDs, and wall clock. The platform enforces these caps. The good behavior of the agent does not.
- Inject secrets at the env boundary as short-lived scoped credentials. Never use long-lived credentials. Never put a secret in a trace.

**Buy this layer first.** Put E2B, Modal, Daytona, or Fly Machines behind the existing `Env` interface, and ship. Your own microVM orchestration is a year of work, and no customer pays extra for it. The `Env` abstraction makes a later change of vendor a config change. Examine this decision again when compute becomes a material share of COGS.

**Warm pools:** the cold start controls the perceived latency. Pre-warm a pool for each popular image. Snapshot after the dependency install. Restore one instance for each task. Target less than 2 seconds to the first agent token.

## The three compute modes

All three run the same daemon binary, the same enrollment flow, the same stream.

**Managed sandboxes (default).** Eva hosts ephemeral microVMs. They autoscale. You bill them by the second. They need no setup. This is the self-serve product, and it gives most of your compute revenue.

**Registered fleet (BYO compute).** The customer runs the daemon in their VPC, their cluster, or on bare metal. This needs one command and a token. Their code never leaves their perimeter. This answers data residency. It gives access to internal git and staging with no tunnel into your cloud. It cuts your COGS to almost zero. It is often the fastest path into a regulated enterprise. Price it as control-plane seats plus task volume, not as compute.

**Local dev machine.** The same daemon runs on a laptop. Use it for "run this against my working tree" and for pre-commit evaluation.

### Networking, stated precisely

- **Enrollment and work delivery need no tunnel.** The daemon dials out over TLS. Hotel wifi, corporate NAT, and CI runners all work.
- **Tunnels are for the reverse direction.** They serve the UI terminal attach, the preview URLs for a dev server that the agent started, and interactive debugging. Multiplex a reverse channel over the existing stream, or run your own relay. Do not require the customer to install Tailscale for this. Tailscale is a dependency that fails in exactly the locked-down networks where you most want to work.
- **Tailscale or WireGuard is correct** when a *managed* sandbox must reach *customer-internal* resources. But prefer to move the worker into their network (registered fleet). Do not tunnel their network into your cloud. The worker in their network gives a smaller attack surface, better latency, and an easier security review.

## Security and compliance

| Module       | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authn/`     | email + OAuth self-serve; SAML/OIDC SSO and SCIM for enterprise                                                                                                                                                                                                                                                                                                                                                                                           |
| `authz/`     | org → workspace → project; roles: owner, admin, operator, reviewer, viewer; service accounts for CI                                                                                                                                                                                                                                                                                                                                                       |
| `secrets/`   | per-tenant vault namespace, envelope encryption, short-lived credential minting, rotation                                                                                                                                                                                                                                                                                                                                                                 |
| `redact/`    | **redaction at the trace sink, not after** — "written then scrubbed" is a breach with extra steps                                                                                                                                                                                                                                                                                                                                                         |
| `attest/`    | immutable signed action log: action → lease → credential → mandate → human grantor. Governance primitive and SOC2 evidence in one                                                                                                                                                                                                                                                                                                                         |
| `retain/`    | per-tenant retention, hard delete, full export                                                                                                                                                                                                                                                                                                                                                                                                            |
| `residency/` | region pinning for control-plane data and execution                                                                                                                                                                                                                                                                                                                                                                                                       |
| `trust/`     | trust grants for repo-checked-in packages, skills, hooks, and config; per-tenant policy on what repo content may execute where. **Per-tenant governors for the enterprise:** managed-only mode (reject all third-party hooks / MCP servers / permission rules), MCP allow/deny lists, a required version range, and a switch that rejects side-loaded config flags. **Version pinning applies to Eva's own harness as much as to foreign ones** (risk #4) |

**Compliance sequencing:** get SOC 2 Type I before the first enterprise deal. Get Type II within a year. Nobody gives an agent write access to their monorepo without it. With `attest/` you already have most of the evidence. Budget calendar time for this, not engineering time.

**The most dangerous failure mode is prompt injection that reaches merge authority.** Content in an issue, in a dependency README, or in a fetched page instructs the agent, and the change lands. There are four defenses. Never auto-merge changes to CI config, to auth code, or to dependency manifests. Treat all fetched content as untrusted data, and drop tool access for it. Risk-score every diff, and route a high-risk diff to a human, whatever the test status. Defend also at composition time: prompts label trusted instructions and conditions separately from untrusted observations, and they carry a standing instruction to revalidate the live state before a mutation (stage 9a).

## Billing and metering

Agents are not seats. Per-seat pricing collapses the moment a customer runs a hundred parallel tasks.

**Meter:** compute-seconds by sandbox class, model tokens by provider and model, tasks attempted, tasks merged, storage, human-review minutes.

**Meter from provider-reported usage, never from a client-side estimate.** A harness's self-reported `total_cost_usd` is an estimate and can differ from the actual bill; if Eva bills on it, the estimate is a liability. Meter from provider usage, reconcile against invoices, and mark any run whose cost is only an estimate as `degraded` — the same rule 8 that governs fabricated trace data. The token accounting the meter needs (reasoning tokens, cached-input tokens, per-retry spend) is already in the event schema by invariant 8.

**Charge:** a platform fee for each workspace (control plane, dashboard, policy, audit), plus usage. For registered-fleet customers, remove the compute component. That discount closes enterprise deals, and it costs you nothing.

**Customers demand these controls on day one:** hard spend caps for each workspace and each task, budget alerts, per-project attribution, and a visible estimate before a task runs.

**Sell on human minutes per merged change.** Do not sell on tokens, on tasks, or on seats.

## UI surface — build in this order

1. **Onboarding.** The user connects a git host with the GitHub or GitLab App, selects a harness, and runs a first task. This must take less than five minutes, or self-serve fails.
2. **Task view.** It shows the spec, the live event stream, the terminal attach, the diff review, the cost so far, and a cancel control. The user attaches and detaches from any device, and the task continues. Supervision is stateless. The daemon owns the session. This is pi-web's remote-first rule.
3. **Escalation inbox.** This is the one surface that a human must open each day. It ranks the items by the cost of delay. If this surface is correct, the product feels autonomous. If it is wrong, nothing else matters.
4. **Fleet.** It shows managed pool utilization, registered machines, the harness inventory of each worker, health, and token management.
5. **Queue and roadmap.** It shows the backlog, the priorities, the blocked tasks, and agent-proposed items that wait for approval.
6. **Money.** It shows spend by project, by harness, and by model, the cost for each merged change, and the burn against the caps.
7. **Quality.** It shows the eval trend, pass@1 by harness, the revert rate, and the human-touch rate.
8. **Admin.** It shows RBAC, SSO, policies, mandates, and audit log export.

## Deployment topology

```
region/
  api            stateless HTTP + WebSocket/gRPC terminators, horizontally scaled
  scheduler      leader-elected, leases + fair-share admission
  projector      folds the trace stream into read models
  relay          reverse tunnels for terminal attach and preview URLs
  postgres       tenants, task graph, leases, mandates, billing (RLS on)
  objectstore    traces, artifacts, snapshots (content-addressed, per-tenant keys)
  queue          durable work queue (Postgres-backed is fine well past 100 customers)
  sandboxpool    microVM fleet, warm pools per image
  vault          per-tenant secret namespaces
```

**Operational invariants:**
- You must be able to rebuild the projector from the trace stream at any time. State that the traces cannot reconstruct is a second source of truth and a permanent consistency bug.
- You must be able to restart the scheduler in mid-flight. Leases have deadlines. A restart expires nothing early, and it loses nothing.
- Every side effect carries an idempotency key. A requeue after a lease expiry will occur.
- Keep platform observability separate from the agent traces. Do not debug API latency inside the trajectory store.

---

# Part 4 — The build path

There are twenty stages. Each stage ships a working CLI, adds one primitive, and has an exit test that you can fail. **You may not start stage N+1 until the exit test of stage N passes.** A skipped stage costs five times as much to add later.

Each stage also declares its **in/out contract**. The contract shows what a user can type at that stage (the `eva >` lines) and what must come back (the `←` lines). If the demo block does not work, the stage is not done, whatever the code says.

## Phase I — Model to agent

### Stage 0: Wire

A model client with a good terminal.

```
events/       THE event schema: typed, versioned, cursor-numbered (invariant 8).
              SETTLED — see docs/adr/0001-0008. Sealed payload interface, closed
              kind set, Unknown preserved, envelope carries the fold keys.
trace/        the TraceSink interface + a JSONL implementation. Ships HERE, not at
              stage 6, because invariant 1 admits no quick paths and because the
              sink is what OWNS Seq: it assigns trace position at commit and
              appends an assistant message with all of its tool results as one
              atomic write. Stage 6 adds replay, the public-contract version
              freeze, and sink-side redaction — it does not add the sink.
provider/     Provider interface + anthropic impl, streaming, retry w/ backoff,
              token accounting — usage arrives split across message_start (input)
              and message_delta (output), so a Usage event accumulates before it
              emits (openai-compatible impl at stage 1 — local models, cheap
              eval runs; it is also the only provider that reports reasoning
              tokens, which is why the field is nullable)
config/       ~/.eva/config.toml, profiles, key resolution, model selection
session/      turn structure over the durable transcript; the Session is what
              resume, branch, and rewind later act on (see CONTEXT.md)
render/       streaming markdown to TTY, syntax highlight, spinner, cost line
              — a pure consumer of events/; the core never renders
cli/          repl, one-shot mode, print/JSON mode, slash command dispatch
```

```
eva > explain what this project does
  ← streamed markdown answer; cost line: $0.003 · 1.2k in / 340 out
eva -p "summarize this diff" --json
  ← the same turn as typed events on stdout, unrendered — proves the render
    boundary exists; CI and stage 1 consume this
eva > /model  /cost  /clear  /help
  ← switch model mid-session; per-turn and cumulative spend
```

**In:** prompt text, piped stdin, config, and an API key. **Out:** answers and typed events. There is no file access and there are no tools yet.

Define the `Unit` interface, the event schema, and the trace invariant here, before the model client. Include `Tenant` and `Actor` on `Spec` — and on the `Event` envelope, for the same reason. If you add tenancy later, you touch every table, query, cache key, object path, and trace record.

**Primitive:** context assembly and budget accounting.
**Exit test:** a multi-turn conversation keeps the correct history, streams the output, and shows the per-turn cost and the cumulative cost. Ctrl-C cancels in mid-stream and does not corrupt the session. `eva -p --json` emits the identical turn as typed events, with no TTY rendering in the output path. The base system prompt has a byte budget, and CI enforces it as a gate (owainlewis/neo's bar is ≤ 2 KiB). Thus context spend is a reviewed, versioned artifact from the first commit.

Five assertions come from the settled schema. Each one fails loudly if the sink is wrong. Stage 0 has no tools, so two of them are driven by constructed events rather than by a real turn:

- A `Usage` event on a cached turn reports cache **write** and cache **read** as separate non-zero figures, and `ReasoningTokens` is **absent** rather than `0` on an Anthropic turn.
- A synthetic unknown event kind survives a round-trip through the JSONL sink with its bytes intact, and the run carries `Degraded`. Eva's own loop cannot emit an unknown kind — that arrives from a foreign harness at stage 9c — so this one is driven by constructing the event.
- `kill -9` in mid-stream leaves the trace file parseable, holding no partial event and no partial turn group.
- The sink, handed a constructed turn group that contains tool results, appends it as one unit. The rule that no `tool_use` is ever persisted without its `tool_result` is therefore tested before stage 2 builds anything that depends on it.
- Trace `Seq` is dense and gapless per Session after a run that streamed thousands of text chunks — proving the sink assigned it and coalesced, rather than passing `WireSeq` through.

`Disposition` reaches only `budget_denied` at stage 0, because the other six values need tools. They get encoding coverage here and behavioural coverage at stage 2.

### Stage 1: Workflow

Do this stage before agents. A team that goes directly to agency gets a nondeterministic system. That system does a job that a 40-line pipeline does more reliably and ten times more cheaply.

```
prompt/       templates, partials, variable injection
schema/       JSON schema, validation, repair loop on invalid output
pipeline/     declarative DAG: step -> model -> validate -> next
```

```
git diff --staged | eva run commit-msg
  ← one conventional commit message; schema-valid first pass ≥95%
eva run review internal/auth/login.go
  ← structured findings: [{file, line, severity, claim}]
eva run release-notes.yaml --input CHANGELOG.md
  ← declarative DAG executes: step → model → validate → repair once → next
```

**In:** files, piped text, and pipeline YAML. **Out:** schema-validated structured artifacts. The code owns the control flow. The model fills the slots.

**Primitive:** structured output with a validation and repair loop.
**Exit test:** five canned pipelines give ≥95% first-pass schema validity across 100 runs. Each failure repairs within one retry.

### Stage 2: Tools and the loop

```
tools/        registry + JSON schemas: read_file, write_file, edit_file,
              list_dir, grep, bash, fetch
loop/         propose -> act -> observe; stop conditions, interrupt;
              emits events/, exposes the hook points (host ships at stage 6.5);
              max turns is a runaway fuse, not a work budget
sched/        parallel tool groups: the RUNTIME classifies parallel safety via
              an optional ParallelSafe(input) capability — never the model;
              unclassified tools fail closed to serial; serial calls are
              barriers; bounded concurrency; results commit in source order
              so the transcript stays deterministic; one failure does not
              cancel siblings
steer/        mid-turn user input lands after the current provider response and
              tool group complete structurally; unstarted calls become skipped
              results; nothing is orphaned
approval/     named permission modes: read-only | supervised | autonomous | plan
              (nerve's vocabulary — mandates, profiles, and worker tiers
              reference these later); per-tool ask | auto | deny as the
              override mechanism inside a mode; DETERMINISTIC rule language for
              bash — prefix rules over argument lists (a position may hold a
              union), most-restrictive-decision-wins, validated in CI
              (`eva policy check`). Linear shell chains split on && || ; | and
              each part evaluates independently; anything with a redirection,
              substitution, or variable is ONE opaque invocation, failed closed.
              A repo-checked-in profile may NARROW a mandate, never widen it.
              PROTECTED PATHS: writes to toolchain-bootstrap files (.git, .eva,
              .npmrc, .mcp.json, CI config, dependency manifests, shell rc) are
              never auto-approved and settings cannot pre-approve them — the
              safety check runs BEFORE allow rules. A write there is a
              delayed-action shell command; this is the enforcement for risk #2.
diff/         structured edits, dry-run preview, atomic apply
```

Modes are **capability selection** plus mandate gates. Capability selection decides which tool registry the agent gets. **The gate that decides allow/deny is deterministic and testable in CI — never a model classifier.** This is owainlewis/neo's lesson refined by shipped practice: a command classifier looks reassuring but it does not contain, because a user can wrap, alias, and substitute shell commands, and a classifier cannot be a CI gate (stage 8 already forbids non-deterministic merge gates; the same logic binds permissions). A classifier may sit **above** the deterministic gate as an advisory layer — a `model` hook (Part 2) or the `permission` hook — with one hard rule: **it may narrow, never widen, and never substitutes for the sandbox.** Containment belongs to `env/` (stage 4). The app layer selects the capabilities and enforces the mandates.

```
eva > rename UserSvc to UserService across this package
  ← parallel reads and greps, then serial edits; every write previewed, y/n
eva > run the tests and fix the first failure
  ← bash (approved) → edit → re-run; stops at green or the max-turns fuse
eva > /mode read-only
  ← takes effect before the next tool call; writes now denied
```

**In:** natural-language tasks against a real working tree. **Out:** multi-file changes, previewed and undoable, inside a named permission mode.

**Primitive:** bounded action surface and permissions.
**Exit test:** the agent completes a three-file refactor from start to end. You can preview and undo every write. Policy refuses `rm -rf /`; luck does not. A write to `.mcp.json` is refused even when an allow rule in a repo-checked-in profile would permit it — the protected-path check runs first. `echo x > $VAR` is treated as one opaque invocation and fails closed. `eva policy check` rejects a malformed rule set in CI. A change of a live session from autonomous to read-only takes effect before the next tool call. Two parallel-safe reads overlap, and you can show it. A write between them is a barrier. The results land in source order.
**Skip cost:** without `approval/` you can never run unattended. That stops stage 9 and every stage after it.

## Phase II — Agent to harness

### Stage 3: Context engine

```
context/
  repomap/      cheap structural index: symbols, imports, file sizes;
                LSP symbols where a server exists, grep as fallback (omp's lesson)
  rank/         relevance scoring for candidate files
  retrieve/     grep-first; embeddings only where grep fails
  compact/      summarize-and-continue, preserving task state; the split point
                never separates a tool_use from its tool_result AND never drops
                a standing constraint (extended safe-split rule) — but the real
                fix is that Spec.Constraints live outside the transcript, where
                compaction cannot reach them; compaction usage is metered even
                when the summary is unusable — the provider call was billable
  survives/     the explicit, TESTED "what survives compaction" contract: every
                element of Runtime has a defined post-compaction fate (project
                conventions re-inject from disk, path-scoped rules reload lazily,
                the skill LISTING is not re-injected — only invoked skills
                survive, Spec.Constraints are never touched). A task that loses
                its mandate or acceptance at compaction is a silent correctness bug
  project/      EVA.md conventions, .evaignore; path-scoped rules (paths:
                frontmatter) load a rule ONLY when the agent touches a matching
                file — progressive disclosure for standing instructions, so
                conventions for src/api/** cost no context on a docs-only task
```

```
eva > where is rate limiting actually enforced here?      # 500k-LOC monorepo
  ← repomap + grep-first retrieval; answer with file:line evidence
eva > implement the TODO in billing/invoice.go
  ← hours-long task; survives three compactions without losing the goal,
    the constraints, or what it already tried
```

**In:** big repos and long tasks. **Out:** evidence-grounded answers and edits that were impossible inside one context window.

**Primitive:** compaction. The agent survives past one window.
**Exit test:** the agent completes a task in a 500k-LOC repo. It survives three compactions. It does not lose the goal, the constraints, or the record of what it already tried. A stated boundary ("do not push") held in `Spec.Constraints` is still enforced after all three compactions — the survives-compaction contract is a table you can assert against, not a hope.

### Stage 4: Environment

```
env/
  workspace/    local dir | git worktree | container | remote VM | provisioned sandbox;
                create(info, env, from?) — the `from` parameter FORKS a workspace
                from another, i.e. fork at the ENV layer, not only the session
                layer (stage 7). Best-of-N harness racing (Part 2's moat) needs N
                workspaces from ONE snapshot, not N sessions sharing one workspace —
                so this primitive belongs here. target() returns {local dir} or
                {remote url} uniformly: rule 9 (one code path) expressed as a type.
  isolation/    declarative per-unit worktree: `isolation: worktree` on a profile/
                spec runs the unit in its own git worktree, auto-cleaned if it made
                no changes, with git redirects back into the main checkout blocked —
                the structured version of concurrent writable children
  snapshot/     cheap checkpoint and restore
  net/          egress allowlist per profile
  secrets/      injection at env boundary, never in context
```

The `Env` interface must abstract a **remotely provisioned** sandbox from the start. It must not abstract only a local directory. This is what later lets you put E2B or Firecracker in place with no change to the loop.

```
eva --env worktree > upgrade the ORM and see what breaks
  ← runs in an isolated worktree; the host tree is untouched
eva env snapshot   /   eva env restore <id>
  ← pre-run state back in one command
eva > (a deliberately destructive prompt)
  ← contained by the sandbox, not by the model's good manners
```

**In:** the same tasks, and also dangerous ones. **Out:** identical results in disposable environments, and a rollback with one command.

**Primitive:** isolation and reproducibility.
**Exit test:** a deliberately destructive run cannot touch the host, and one command restores the pre-run state.

### Stage 5: Verifier — the highest-leverage stage

Every stage after this one adds throughput. This stage adds quality.

```
verify/
  checks/       build, typecheck, lint, unit, integration, custom scripts;
                LSP diagnostics as a check type — the cheapest oracle for
                typed languages; community checks arrive via RegisterCheck
                (a check may be a `model` soft verifier — degraded, never merges)
  contract/     exit code + structured diagnostics -> fed back into loop
  budget/       per-check timeout, cache unchanged results
  remediate/    on a failed attempt with retries left, run Spec.Remediation (the
                compensating cleanup) BEFORE the next attempt, so a retried job
                never inherits a dirty environment — a half-written migration, a
                running process, a stale lock. In a factory that retries on
                another worker, that dirt is a correctness bug, not an inconvenience.
                Then apply Spec.RetryPolicy: keep the failure context, or reset
                history to initial. The choice is per-task, declared, never hardcoded.
spec/           acceptance criteria attached to a task, machine-checkable
```

```
eva > fix the flaky date parsing test
  spec.acceptance: ["go test ./internal/date/... passes", "lint clean"]
  ← the loop iterates against the checks; Done only when the verifier says
    so — the agent's own claim of success is not accepted
eva verify --spec task.yaml --workspace .
  ← standalone: evidence report + exit code, runnable against ANY diff,
    including a foreign harness's (stage 9c depends on this)
```

**In:** tasks with machine-checkable acceptance. **Out:** evidence, not claims.

**Build the verifier as a standalone contract that you can run externally. Do not build it as a function inside the loop.** This is what later lets Eva verify the work of a foreign harness. If you build it inline, you rewrite stages 5–8 when the adapters arrive.

**Primitive:** ground truth. The agent can be wrong cheaply and often.
**Exit test:** the measured pass@1 on a fixed 20-task set improves materially against stage 2 with the same model. If it does not improve, your diagnostics do not reach the loop.

### Stage 6: Memory and trace

```
trace/        the sink itself shipped at stage 0. This stage adds replay, the
              cost + latency + tokens fold per step, and sink-side redaction
memory/
  session/     compaction artifacts
  project/     learned facts: conventions, gotchas, where things live.
               STRUCTURE: a MEMORY.md index plus topic files; only the first
               ~200 lines / 25 KB of the index load at startup, topic files load
               on demand. The cap makes memory bounded-cost by construction and
               nudges the agent to keep the index short. Each file carries a
               modified timestamp so staleness is visible.
  procedural/  reusable playbooks
```

```
eva trace show <run-id>
  ← the full trajectory, replayable: every step with cost, latency, tokens
eva > (a task similar to last week's)
  ← measurably cheaper: project memory recalls conventions, gotchas, and
    where things live, instead of re-discovering them
```

**In:** past runs. **Out:** replay, and a second run that costs less than the first.

The trace is the persisted event stream from stage 0, written by the sink that stage 0 already built. This stage invents neither a schema nor a sink. It **makes the existing schema a versioned public contract**, because adapters and extensions will emit into it — which is the point at which `SchemaVersion` stops being ours to change freely (ADR 0006). Redaction occurs at the sink, inline; there is nothing to redact before stage 2 brings tools and stage 4 brings secrets, which is why it lands here rather than at stage 0.

**Exit test:** the second run of a similar task is measurably cheaper and faster. Compaction achieves a measured compression ratio on the fixture set (pigo's bar is 128k → 12k), and it loses no goal. If it does not, your memory is decoration.

### Stage 6.5: Extension host — events and hooks go public

This stage is here for two reasons. Hooks need the event stream (stage 6) to subscribe to. And you must declare the harness (stage 7) done *with* its extension surface, not add a surface to it later.

```
exthost/
  hooks/        the HookBus: ~12 versioned lifecycle points; observe | decision
                {allow|deny|ask|defer} | updatedInput | updatedResult;
                additionalContext on any event
  handlers/     command | http | mcp_tool | model — WHAT a hook is, orthogonal to
                the runtime tier (HOW it is transported)
  monitors/     background push channel (RegisterMonitor): stdout lines of a
                long-running command delivered to the running unit as notifications
  runtime/      compiled-in (first-party) + subprocess (gRPC, community);
                wasm tier (wazero) follows once the host interface is stable
  pkg/          package manifest, loader, event-schema version pinning, SHA pins
  trust/        trust gate: repo-local packages denied by default; per-tenant
                governors (managed-only, MCP allow/deny, version range)
firstparty/     plan mode, todo, permission-prompt UI, goal mode (standing
                objective: typed state, the model may only claim complete |
                blocked through one narrow tool, user owns pause/resume/clear)
                — built as extensions, dogfooding the same Host interface the
                community gets
```

```
eva ext install github.com/acme/eva-guard
  ← a third-party package: vetoes rm -rf via tool_call, adds /deploy,
    registers a license-check into the verifier
eva > /deploy staging
  ← the community command runs under the same budget, trace, and mandate
```

**In:** packages from the ecosystem. **Out:** new tools, commands, checks, and hooks. We wrote none of them.

**Primitive:** a public, versioned extension surface over the loop.
**Exit test:** a third party reproduces pi's permission-gate example. The extension vetoes `rm -rf` through `tool_call`, adds a `/deploy` command, and registers a custom verifier check. It installs as a package. It still works after a minor-version upgrade of Eva, and it needs no recompilation.
**Freeze rule:** freeze the hook API only after stage 8 uses it. The eval harness must itself consume hooks (`outcome`, `after_provider_response`). This proves that the surface is sufficient.

### Stage 7: Harness

```
harness/      profile = model + harness + tools + policy + budget + memory + verifier + env
subagent/     spawn child harness, narrowed toolset, own window, summarize up;
              typed modes as capability selection — work (writable, serial) |
              inspect (read-only registry, parallel-safe); unknown modes fail
              closed to the restricted set. UNATTENDED = NARROWER BY DEFAULT: a
              unit running in the daemon (no human present) resolves to a reduced
              built-in tool set unless its mandate explicitly widens it — the same
              definition yields fewer tools when it runs unattended. This is the
              posture that ties together disallowed-tools, disable-model-invocation,
              and protected paths: the factory's default is less capability, and the
              mandate is the only thing that grants more.
budget/       hard token/$/wallclock caps, graceful stop with partial results
resume/       durable session state; survive kill -9
branch/       fork a session from any checkpoint into a new session with
              preserved lineage — the primitive under best-of-N harness racing
              (Part 2's payoff) and stage 10's retry logic
rewind/       user-facing entry points over branch/ (interactive layer):
              restore-code | restore-conversation | restore-both as independent
              axes; summarize-from-here | summarize-up-to-here as aimed
              compaction. Durable resume/branch is the hard half and Eva already
              has it; these are named moves plus the honest limitation disclosure —
              checkpoints do NOT track bash-command file writes or subagent edits,
              so state that boundary rather than imply total reversibility
```

```toml
# ~/.eva/profiles/fixer.toml
harness = "eva"
model   = "claude-opus-4-8"
tools   = ["read_file", "edit_file", "grep", "bash:test/*"]
verify  = ["typecheck", "unit"]
env     = "worktree"
budget  = { usd = 2.00, minutes = 15, turns = 40 }
on_exhausted = "escalate"
```

Eva's own loop becomes the first implementation of the `Harness` interface.

```
eva --profile fixer.toml "fix the login redirect bug"
  ← runs under {$2, 15 min, 40 turns}; on exhaustion → escalates with
    partial work preserved
kill -9 <pid>;  eva resume
  ← continues from the last committed step; no duplicated side effects
eva branch <session>@12 --profile reviewer
  ← two branches from one checkpoint: shared prefix, divergent suffixes
eva > /goal make every test in this package pass
  ← standing objective (first-party extension): keeps working while idle;
    may only claim complete | blocked through the goal tool; /goal pause wins
```

**In:** profiles, budgets, and standing objectives. **Out:** a session that you can kill, fork, resume, and leave alone.

**Exit test:** kill the process during a task. `eva resume` continues from the last committed step, and it duplicates no side effects. Fork the killed session at step N into two branches with different profiles. Both branches complete. The traces show a shared prefix and divergent suffixes.

### Stage 8: Eval harness

Without this stage you cannot improve on purpose. You improve only by feel and by model upgrades.

```
eval/
  suite/        task fixtures, frozen repos, deterministic seeds, AND a frozen
                HARNESS CONFIGURATION. An eval must run in a bare/hermetic mode
                that skips auto-discovery of hooks, skills, plugins, MCP servers,
                and memory, and reads no ambient credentials — so two workers
                score the same fixture identically. Without this the suite
                silently measures the worker's installed extensions and memory,
                not the change; that is eval-suite pollution (risk #3) arriving
                through the one path the design must not leave open. Freezing the
                repo is not enough; freeze the harness too.
  score/        pass/fail + cost + turns + human-touch rate
  compare/      A/B two prompt, profile, or harness versions; diff trajectories
  gate/         CI check blocking merges that regress the suite; deterministic
                size budgets (prompt bytes, binary size) are the only
                performance regression gates — timings are informational,
                never CI gates, so the suite stays trustworthy instead of flaky
```

```
eva eval run --suite core-20
  ← pass@1, cost, turns, human-touch per task; trend against baseline
eva eval compare profiles/fixer-v1 profiles/fixer-v2
  ← A/B verdict with trajectory diffs
(in CI) a deliberately worsened prompt
  ← merge blocked
```

**In:** frozen task fixtures and two candidate configs. **Out:** verdicts instead of opinions.

**Exit test:** CI catches and blocks a prompt that you made worse on purpose.

This is the boundary between a tool and a system. Below this boundary, changes are guesses. Above it, changes are experiments.

## Phase III — Harness to factory

### Stage 9a: Work items and local scheduler

The critical artifact is the machine-readable spec:

```yaml
id: EVA-142
intent: "Rate-limit the /export endpoint to 10 req/min per org"
context: ["api/export.rs", "docs/rate-limits.md"]
acceptance:
  - "cargo test rate_limit::export passes"
  - "no p99 change on other endpoints in bench suite"
budget: { usd: 5, minutes: 30 }
risk: medium
```

```
task/         spec schema, importers (Linear, GitHub issues), validator;
              fan-out: one Run freezes a spec snapshot + complete target set
              at admission and creates one Job per target — independent
              failure, independent retry, Run state derived from its Jobs
queue/        durable, leases, retries, dead-letter, priority; triggered work
              commits a durable admission record BEFORE task creation, then
              creates-or-recovers the task and links it in one transaction
              (invariant 9 in practice)
scheduler/    N workers, one env each, budget-aware admission, fair share
daemon/       long-running supervisor, health, graceful drain
```

The task states are explicit and visible: `pending → blocked (with a reason — no silent starvation) → queued → preparing → running → terminal (succeeded | failed | cancelled | skipped)`.

Anything that admits work autonomously is created **disabled**. This includes schedules, issue triggers, and importers. A preview runs with no durable writes: no record, no counter, and no cursor. To enable it, the operator must confirm a statement of what will run, where it will run, and when it runs next.

Composed prompts carry **provenance labels**. They keep trusted operator instructions and trigger conditions (canonical fixed-order JSON) separate from untrusted observations. They also carry a standing instruction: revalidate the live state before any mutation, and stop if the trigger no longer matches. And bound everything. Every field has a numeric limit. When a value hits a limit, the system rejects it visibly. The system never prunes the dedup identity records.

```
eva task add tasks/EVA-142.yaml
  ← validated against the spec schema; queued; every state visible end to end
eva run-def find-bugs --repos api,web,billing
  ← one Run freezes the definition + target set: three Jobs, independent
    failure, independent retry
eva daemon
  ← the backlog drains overnight; morning: outcomes, evidence, spend
```

**In:** machine-readable specs and repo fleets. **Out:** unattended throughput with an audit trail.

**Exit test:** `eva daemon` clears a 20-task backlog overnight, with no attendant. Kill the daemon during a run and replay every API call. There are no duplicate tasks and no orphaned admission records.

### Stage 9b: Control plane and enrollment

```
control/      API, stream terminator, lease issuance
enroll/       three-tier tokens, rotation, revocation
identity/     scoped worker credentials, capability advertisement
attest/       signed non-repudiable action log
tenant/       RLS, per-tenant queues, authn/authz
```

Move `identity/` and `attest/` forward from stage 14. Enrollment *is* mandate issuance. These two modules are small when the only subject is a worker.

```
eva control up  &&  eva enroll create --tier semi --ttl 10m
  ← one pasteable token
(any machine, behind NAT)  eva daemon --join https://cp.example.com --token …
  ← worker online in the fleet view; revocable within one heartbeat
eva top
  ← live leases, workers, spend — the projection, in a terminal
```

**In:** a token. **Out:** a fleet.

**Exit test:** a laptop behind NAT and a VPC runner both enroll with one pasted token. Both take work. You can revoke both within one heartbeat. The tasks of two tenants never share a VM.

### Stage 9c: Harness adapters

```
adapter/      Harness interface implementations: claude-code, codex, opencode
conform/      the adapter conformance suite, run nightly against upstream
```

Build the Claude Code adapter first. It has the richest event stream. Thus it exercises the most of your normalization layer.

```
eva task run EVA-142 --harness claude-code
eva task run EVA-142 --race eva,claude-code,codex
  ← same spec, same workspace, same verifier; scored results per harness —
    the routing table starts accumulating
```

**In:** one spec and N harnesses. **Out:** verified, comparable outcomes.

**Exit test:** the same task runs on three harnesses in the same workspace against the same verifier, and the eval suite scores all three.

### Stage 9d: Skills and MCP

```
skill/        source format, compiler, per-harness targets
mcpserver/    verifier, repo map, memory, task graph exposed over MCP
```

```
eva skill install migrate-db
  ← compiled per harness: native, SKILL.md, or plain instructions
eva task run MIG-7 --harness codex
  ← the foreign harness follows the skill and uses eva's verifier and
    repo map over MCP
```

**In:** one skill source. **Out:** the same behavior under every registered harness.

**Exit test:** you author one skill one time, and it behaves correctly under all registered harnesses.

### Stage 10: Integration — the rung nobody builds

Eight agents produce eight branches. A naive factory fails here.

```
integrate/
  branch/       branch-per-task, PR with spec + trace link
  mergeq/       serialized landing, rebase-and-reverify before merge
  conflict/     detect overlapping edits at schedule time, not merge time
review/
  auto/         second-pass agent review against the spec
  route/        risk score decides: auto-merge | agent review | human eyes
```

Never auto-merge changes to CI config, to auth code, or to dependency manifests. This applies whatever the test status is.

Be honest about external side effects. You cannot promise exactly-once for the writes that the agent performs: comments, pushed branches, and opened PRs. A retry after the agent started requires an explicit **warned retry**. Every run carries stable `EVA_RUN_ID` and `EVA_JOB_ID` identifiers. Thus agents make branch names and markers safe for a retry.

```
eva mergeq status
  ← eight branches: conflicts detected at schedule time, rebase → reverify →
    land serially; a diff touching auth/ routes to a human despite green
eva task retry JOB-88
  ← warned retry: "the agent may already have opened a PR"; stable
    EVA_JOB_ID keeps branch names collision-free
```

**In:** eight finished branches. **Out:** a green main, and honesty about external side effects.

**Exit test:** eight parallel agents land eight changes on `main` in one session. There are no broken builds and no silent semantic conflicts.

Human review bandwidth is now the limit on the whole system. Every stage after this one is about how to spend that bandwidth well.

### Stage 11: Economics, dashboard, billing

```
meter/        cost per task, per merged change, per harness; attribution
policy/       org rules as code: prod access, spend caps, escalation thresholds
report/       throughput, pass rate, human-touch rate, $/merged change, trend;
              every metric computes over ONE declared cohort (tasks admitted
              in-window, post-filter); a retry never creates a new job, so it
              cannot inflate throughput; success rate excludes cancellations
              from the denominator
projector/    read models; TUI first, then web
billing/      usage events, invoicing, plan limits, hard caps
```

```
eva report --week
  ← merged changes, $/merged change, human-minutes/merged change, trend
eva top → Money
  ← burn vs cap, live; spend by task, profile, harness
```

**In:** the trace stream. **Out:** the two numbers that run the business.

**Exit test:** one command answers "what did the factory produce this week, at what cost, and how much human time did it consume."

### Stage 12: Continual learning

```
learn/
  mine/         cluster failures across traces, find repeated stalls
  distill/      recurring fixes -> playbooks and memory entries
  propose/      prompt/profile changes, gated by the eval suite
  route/        which harness for which task class, learned from outcomes
  tune/         optional distillation or fine-tuning on accepted trajectories
```

```
eva learn mine --since 30d
  ← clusters of repeated stalls and failures across traces
eva learn propose
  ← playbook + profile changes, each gated by the eval suite before adoption
```

**In:** accumulated traces. **Out:** a system that improves without a model upgrade.

**Exit test:** the eval suite improves week over week **with the model held constant**. That result proves that you built a system, and that you did not rent one.

## Phase IV — Factory to company

### Stage 13: Intent — the demand side

```
sense/        support tickets, error monitoring, usage analytics, interviews,
              dependency and competitor watch
synthesize/   cluster signal into problems, not features
plan/         propose specs with expected value; maintain a roadmap object
```

The role of the human changes from author to approver.

```
eva sense sync
  ← tickets, error monitors, usage analytics ingested as signal
eva plan review
  ← agent-proposed specs with expected value; approve, edit, or reject —
    the human is now the approver, not the author
```

**In:** the outside world. **Out:** a roadmap that writes itself and waits for signatures.

**Exit test:** across one month, the work items that the agent proposes do better than the items that humans author, measured on your own outcome metric.

### Stage 14: Authority and accountability

```
treasury/     spend authority tiers, payment rails, invoicing, reconciliation
mandate/      standing authority: what Eva may do unsupervised, thresholds for
              human signature, expiry and renewal of each grant
halt/         kill switch, drain, freeze — tested, not theoretical
surface/      customer-facing: support, status, SLA reporting
```

A human or a legal entity holds the liability. That entity grants Eva a **bounded, expiring mandate**. Eva operates freely inside the mandate. Eva escalates at the boundary. Every action is attributable to a mandate. Corrigibility is a property of the architecture. It is not a promise in a prompt.

**Design track — no prior art.** No shipped harness has an expiring mandate; managed settings are static configuration, not a bounded grant with an expiry and a grantor. That means this stage has no proven design to adopt, only one to invent. Over-invest, and carry a **falsifier**: if a harness ships a genuine bounded-expiring-authority grant, adopt its shape; until then treat the design as unexplored, not merely unbuilt. The same holds for stage 11's cost-per-merged-change and human-minutes-per-merged-change — no harness closes the loop to merged output, so those metric definitions are Eva's to get right, not to borrow.

```
eva mandate grant --scope "deps,tests,docs" --budget 200usd/wk --expires 90d
  ← standing authority, bounded and expiring; everything outside it escalates
eva halt
  ← broadcast drain; clean stop; nothing orphaned — tested, not theoretical
```

**In:** a signed mandate. **Out:** a week of operations with humans only at the thresholds.

**Exit test:** Eva runs a week of ordinary operations: sensing, planning, building, landing, reporting, and spending. Human input occurs only at the defined thresholds. Every action is traceable to a signed mandate. Then pull the kill switch and verify a clean stop with no orphaned state.

## Final repo shape

Use a `go.work` workspace. There is one module for each layer. Imports point one way. This is tau's rule, and the whole lesson is the boundary. The stage-numbered packages live *inside* these modules. The build path does not change. Only the ownership structure above it becomes explicit.

```
eva/                    # go.work
├── events/             # THE schema: events, trace records, versioning
│                       #   imports: nothing                        (stage 0)
├── core/               # Unit, Spec, Outcome, loop, budget, hooks (HookBus),
│   │                   # verifier contract, tool registry
│   │                   #   imports: events                         (stages 0-2, 5-6)
│   ├── prompt/ schema/ pipeline/                                 # stage 1
│   ├── tools/ loop/ approval/ diff/                              # stage 2
│   ├── context/ verify/ spec/                                    # stages 3, 5
│   ├── session/                                                  # stage 0
│   └── memory/                                                   # stage 6
├── trace/              # the JSONL sink: the TraceSink IMPLEMENTATION.
│                       # NOT inside core — the sink writes files, and core is
│                       # pure. core declares the interface; this satisfies it.
│                       #   imports: events, core                   (stage 0)
├── config/             # ~/.eva/config.toml, profiles, key resolution
│                       # NOT inside core — it reads files.
│                       #   imports: events, core                   (stage 0)
├── providers/          # Provider iface + anthropic, openai-compat, local
│                       #   imports: events, core                  (stages 0-1)
├── env/                # workspace, snapshot, net, secrets
│                       #   imports: events                        (stage 4)
├── exthost/            # hook bus host, subprocess + wasm runtimes, pkg loader,
│                       # trust gate; firstparty/ extensions
│                       #   imports: core                          (stage 6.5)
├── harness/            # profiles, subagent, resume, branch; Harness iface,
│   │                   # Eva's own impl, adapters, conformance
│   │                   #   imports: core, env, providers, exthost (stages 7, 9c)
│   ├── adapter/ conform/                                         # stage 9c
│   └── eval/                                                     # stage 8
├── cli/                # repl, TUI, render, print/JSON/RPC modes
│                       #   imports: harness — pure consumer of events/
│                       #   the core never renders                 (stage 0)
├── daemon/             # task, queue, scheduler, enroll, identity
│                       #   imports: harness                       (stages 9a-9b)
├── skill/              # source format, compiler, per-harness targets; mcpserver/
│                       #   imports: core                          (stage 9d)
└── control/            # control plane, tenant, attest, integrate, review,
    │                   # meter, policy, projector, billing, api
    │                   #   imports: events + the wire protocol    (stages 9b-14)
    ├── integrate/ review/                                        # stage 10
    ├── meter/ policy/ report/ projector/ billing/                # stage 11
    ├── learn/                                                    # stage 12
    ├── sense/ plan/                                              # stage 13
    └── treasury/ mandate/ halt/ surface/                         # stage 14
```

There are two rules, and CI enforces them with an import linter. `core` never imports UI, provider specifics, or OS and path specifics. Nothing imports a frontend.

**The rule decides the tree, not the other way round.** Anything that touches the filesystem, the network, or the terminal sits in a module *beside* `core`, never inside it — which is why `trace/` and `config/` are top-level above rather than children of `core/`. `core` declares the interface; the outer module implements it. There is no root module: `go.work` is the root. See `docs/adr/0010`, which is authoritative on the layout.

The linter is `depguard`, configured in `.golangci.yml` and run by `make lint`. Every rule is an **allow list in strict mode**, so the boundaries fail closed: an import nobody enumerated is rejected rather than quietly permitted. A new module needs an entry in `go.work` and a rule in `.golangci.yml`; a module with no rule falls through to a standard-library-only default, so a forgotten rule fails loudly.

---

# Part 5 — Sequencing rules

1. **Stages 0–2 take one weekend each.** Do not try to make them elegant.
2. **Over-invest in stage 5.** The verifier sets the ceiling for everything above it. Agents converge where a good oracle exists. Agents fail where no oracle exists, whatever the model.
3. **Stage 8 feels like overhead.** It is also the reason that stages 9–12 are possible at all.
4. **Stages 3, 6, and 7 can be shallow, and you can deepen them later. Stages 4, 5, 6.5, 8, and 10 cannot.** For those stages, shallow means that you rebuild them. A shallow stage 6.5 means that you rebuild it *and break the ecosystem*: a published hook API is a promise to other people's code.
5. **Do not build adapters before stage 8.** You can discover the adapter interface only after you know what a good harness needs. If you start pluralistic, you get the union of everyone's failure modes and the ability to fix none.
6. **Do not let the dashboard become the source of truth.** Traces are.
7. **Do not ship remote workers before the sandbox is real.** Stage 4 is a hard prerequisite for 9b.
8. **Do not normalize what a harness does not emit.** Fabricated cost data or trace data poisons the eval suite, the one instrument that you have. Mark it degraded and exclude it.
9. **Keep local and remote on one code path.** If local is a special case, half of your system stays untested until the day when you need it most.
10. **Rent the sandbox layer for the first year.** Your own microVM orchestration is a year of work, and no customer pays extra for it.
11. **Dogfood the hook API.** Build as an extension every Eva feature that an extension can express. If an extension cannot express it, correct the API, not the feature. And freeze the API only after stage 8 exercises it. This is the same logic as rule 5: you discover interfaces, you do not design them.
12. **A product concept must earn its place through operator behavior, not through speculative reuse** (factory's rule, learned when they shipped eight nouns and collapsed them to five). The operator-facing vocabulary stays small — spec, run, job, worker, mandate — and attempts, leases, and admission records stay implementation detail inside them.
13. **Fail closed, fail loud.** Workspace cleanup deletes only the work that is provably clean and published. It keeps dirty, failed, or uncertain work for inspection. A removed config key fails with migration guidance. The system never ignores it silently. When a value hits a bound, the system rejects it visibly. It never truncates silently.
14. **The docs are part of the factory.** Each design doc carries a status header (implemented | draft | superseded — do not implement) and a verification-basis commit. Each opinion carries a falsifier ("this changes if…"). The AGENTS.md file of the repo points agents at these docs and requires them to update the docs together with a behavior change. The workers of this factory are agents.

## Risks, ranked by how badly they end you

1. **Cross-tenant escape.** One breach ends the business. This is the one place where payment to a vendor is strictly correct.
2. **Prompt injection that reaches merge authority.** Assume that an attacker will try it. Defend at the merge boundary, not at the prompt. Config, skills, hooks, and extensions that are checked into a repo are untrusted content — the same category as a fetched web page. They load under the trust gate, at the wasm tier only, and never on a worker that holds secrets.
3. **Eval suite pollution.** If you lose the instrument, you lose the ability to know whether you improve.
4. **Harness dependency.** You depend on the CLIs of other people, and an upstream change breaks your adapters. Run the conformance suite each night, pin the version for each tenant, and keep Eva's own harness good enough to be a fallback for every task class.
5. **Margin compression.** Compute and tokens pass through with a thin markup. The margin is in the control plane, in the eval data, and in the routing intelligence. Price for that from the start.

## If you only get halfway

Stages 0–8 give a genuinely excellent coding agent, and they are a good place to stop. They are a very bad place to have skipped stage 5.
# Target architecture

> **Status: draft.** This describes what Eva will be, not what it is.
> Only stage 0 is built. Where this and an ADR in [`../adr/`](../adr/) disagree,
> the ADR wins. Verification basis: the tip of `main` on 2026-08-09.

What Eva owns and what it delegates, the harness adapter contract, the event
schema, the hook surface, the wire protocols, and the repository layout.

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

Eva supports third-party harnesses. So Eva is no longer *a* harness. Eva is the control plane that makes harnesses interchangeable. This works only if Eva never delegates some things.

| Eva owns — never delegated               | Harness owns — swappable             |
| ---------------------------------------- | ------------------------------------ |
| Task spec and acceptance criteria        | Prompting strategy                   |
| Workspace creation, snapshot, rollback   | Context assembly and compaction      |
| The verifier and what counts as evidence | Tool-calling loop and retry behaviour |
| Trace schema and trace store             | Internal subagent decomposition      |
| Budget enforcement and the mandate       | Edit generation strategy             |
| Merge authority                          | —                                    |

**When a harness reports success, that report is an unverified claim.** The harness ran inside a sandbox that you created. It ran against criteria that you wrote. You run the checks again.

### The second ownership boundary — kernel vs. extension

The table above governs what Eva delegates to *foreign harnesses*. This table governs what Eva opens to *its own ecosystem*. The logic is the same. Eva never delegates some things.

| Kernel — never pluggable                      | Extension points — pluggable through published interfaces                      |
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

**The payoff:** every harness faces the same spec, the same workspace, and the same oracle. So you can race the harnesses on identical tasks and score the results. The verifier picks the best of N, not your preference. After a few thousand tasks, these results become a routing table. The table shows which harness is better at migrations, at test-writing, and at refactors. No single-harness tool can build that data, and so the data is a moat.

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

// Started    { Intent string, Capabilities Capabilities }
//              capabilities are per-run, and the per-run value wins. Intent is
//              the Spec's, and it is what puts the prompt in the Trace: the
//              transcript is a fold over the stream, so a first message that
//              is not a record is a transcript no resume can rebuild (ADR 0011).
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
//              auth_failed | unreachable | server_error | no_such_model |
//              billing | other. It also rides on the Claim a failed Run
//              closes with, which is what a projection shows a person
//              instead of the provider's own words (ADR 0038).
// Edit       { Path string, Hunks int }
// NeedsHuman { Question string, Resume Cursor }  // may fire mid-tool-call
//              (§ Escalation). Resume is the position the answer re-enters at,
//              not the session it belongs to.
// Finished   { Claim Claim }   // a claim, not a verdict; a failed one
//              carries the ErrorClass beside its prose summary
// Degraded   { Missing []string }  // optional; presence IS the degraded flag —
//              e.g. plugin/mcp start errors. Absent when clean, so a CI gate
//              fails on a non-empty array without a separate boolean (rule 8).
// Unknown    { Kind string, Raw json.RawMessage }   // ADR 0002
```

### Capability matrix

The scheduler does not route a task to a harness that lacks a needed capability.

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

The compilation targets are Eva native, `SKILL.md`, `AGENTS.md` sections, and plain system-prompt injection. **The portable core is named explicitly: `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools`. The compiler fails closed on an unknown field, and never drops it silently** (rule 13). Conforming to the open standard is a strategic freebie. Every skill already written for another tool runs on Eva unmodified, so the skill format leads the ecosystem at zero authoring cost. The compiler loses data in one direction only. A skill must degrade to instructions when a harness has no skill mechanism. One expansion variable (`${SKILL_DIR}`) substitutes in both the body and the `allowed-tools` bash rule. So a bundled script stays pre-approved wherever the skill installs, and the instruction and the rule cannot drift. Execution topology — which executor, and forked or not — stays **out** of the skill file. That is what keeps a skill portable across harnesses; the profile chooses the executor.

**Skills are data.** A `SKILL.md` directory carries no code-execution risk more than what its `requires:` field grants. So community skills are the *cheapest* thing to accept, and the skill format leads the ecosystem. Extensions do run code. Extensions get the heavier machinery below.

## Extension system — events and hooks are the harness contract

Our harness will not build all software here, and we will not build all of it. The extension system lets community skills, tools, checks, and workflows compose in. They compose in without a fork of the core. The design rule comes from pi: **primitives, not features**. The core stays small. Capability arrives as packages.

### Hook surface

Hooks subscribe to the one event schema (invariant 8) at named lifecycle points. There are powers, in order of increasing trust. **Observe** reads the stream. **Veto** blocks with a reason. **Mutate** is not one generic power. It splits into two named, typed fields, so the trace (and `attest/`) records *what class of thing* an extension changed. **`updatedInput`** rewrites tool arguments before execution. **`updatedResult`** rewrites the result before it reaches the model. A veto returns an explicit **decision** — `allow | deny | ask | defer` — where `defer` means "no opinion, run the normal flow". The abstain value is mandatory. On a frozen public API, a hook that returns nothing is ambiguous between "no opinion" and "the hook failed", and that ambiguity is permanent.

Injection uses one field, not one event. Any event may carry **`additionalContext`**, which is text the model sees on its next request. So an extension injects at the point where it learned something, and waits for no separate callback.

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
- **`http`** — POST the event to a URL. This is how a tenant plugs an existing compliance service into every diff, **without shipping code into Eva**. It is the strongest fit for the enterprise story.
- **`mcp_tool`** — call a tool on a connected MCP server. Reuses Eva's own MCP surface (verifier, repo map) as a hook target with no new wiring.
- **`model`** — the hook *is* a model call. It is a fast yes/no: "is this command safe?", or "does this diff match the spec's intent?". It may also be a read-only subagent that checks a condition before deciding. This is a **soft verifier** for what no deterministic check covers. It is budgeted and traced like any other unit, and its evidence is marked `degraded`. It may narrow a decision, but it **never blocks a merge** — only deterministic gates do that (stage 8).

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

Subprocess extensions speak the *same* protocol that the control plane speaks to daemons. There is one wire vocabulary. So a hook that works locally also works against a remote session. The wasm tier can ship after the subprocess tier. The host interface is identical.

### Packaging and distribution

An **eva package** bundles extensions, skills, workflows, and themes. The package is a git repo or a registry artifact. Its manifest pins the event-schema version that it was built against. The commands are `eva ext install <git-ref|name>`, `eva ext ls`, `eva ext rm`, and `eva ext init`. The last one scaffolds a package that loads on the next session, with no marketplace and no install step. The first-extension path must not need a git remote, or the ecosystem gets no contributors. **The registry pins each approved package to a commit SHA, never to a git ref.** A ref moves; a SHA does not. This is the difference between a registry and a supply-chain hole, and it costs nothing to do from the start. CI bumps the pin as the author pushes; a nightly sync from the review pipeline decouples approval from availability. A hosted marketplace is a later moat. pi runs one.

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

The stream is **cursor-addressed**. Every event carries a monotonic per-connection sequence number (`Event.WireSeq`). Consumers acknowledge by cursor. A side that reconnects resumes from its last committed cursor, and the peer replays. The cursor advances only after a durable commit. So a dropped connection can never lose trace events. Lost events poison the eval suite (risk #3).

**`WireSeq` is not `Seq`** (ADR 0008). `WireSeq` is wire position, assigned by the producer. `Seq` is trace position, assigned by the sink at commit, per Session. They diverge by construction. The sink coalesces many wire chunks into one trace event. It also appends an assistant message with all of its tool results, as one atomic write. The two meet at exactly one point: the sink's successful append, which is the only thing that may advance a cursor.

**Unit ↔ unit — the task graph mediates, not direct chat.** Unit A emits an artifact and evidence. The control plane routes them as input to the spec of Unit B. Every hop is budgeted, traced, replayable, and verified. Direct messaging exists only between a parent harness and its own subagents. It stays inside one budget and one trace.

> Free-form agent-to-agent chatter is the most common cause of unbounded spend in multi-agent systems. It is also the most common cause of failures that you cannot explain. A structured handoff costs a little expressiveness. It gives you the full debuggability of the platform.

### Escalation from inside a run — a design track

`NeedsHuman` is currently an outcome of a whole `Unit`. That is the wrong shape for one case the factory hits constantly. A tool, or an MCP server deep inside a tool call, needs a human answer. It must then resume *the same call* with that answer. No shipped harness solves this for a remote fleet — the human is never at the worker. So this is Eva's to design, not to adopt.

A question travels in three steps. It rises up the lease to the control plane. It appears in the dashboard's **Attention** view, ranked by cost of delay. It travels back down to a worker that **still holds the lease and its deadline**.

Two mechanisms are load-bearing, and they must be designed together because they interact. The lease clock must *pause* or extend while a run is blocked on a human. Otherwise the escalation races the deadline, and the task requeues under the operator's nose. The answer must also re-enter the exact call on the resume cursor, and must not restart the run.

Three things follow. Emit `NeedsHuman{Question, Resume}` as a mid-stream event, not only as a terminal outcome. Hold the lease in a `blocked-on-human` state that does not count against the progress signal (below). Route the answer back on the same cursor-addressed stream.

**Falsifier:** if a harness ships an externally-usable elicitation-through-lease mechanism, adopt its shape instead. Until then, treat this as unexplored and over-invest.

## Enrollment — daemons join from anywhere

**The worker never listens, and the join token is never the runtime credential.**

There are three token tiers. Each tier is narrower and shorter-lived than the tier before it.

```
join token        ttl 10m,   single use,     claims: {role, tier, max_concurrency}
worker credential ttl 24h,   auto-rotating,  claims: {worker_id, capabilities, mandate}
lease token       ttl=lease, one task,       claims: {task_id, repo, env, budget}
```

The flow has four steps:

1. The operator mints a join token.
2. The worker dials out over TLS and presents it.
3. The control plane issues a rotating worker credential.
4. Each leased task runs under a lease token that ends with the lease.

The join token proves that *you were invited*. The worker credential proves *which worker you are*. The lease token proves *what you may do right now*. If an attacker takes one of them, the cost is a bounded window. Rotation matters more than length. A 24h credential that rotates each hour and refuses replayed predecessors detects theft. A 90-day static token does not detect theft.

**Local is not a special case.** `eva daemon` with no arguments starts an embedded control plane on loopback and enrolls automatically. There is one code path from day one. So you never find at stage 12 that remote workers use a different half of the system.

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

Untrusted workers return a diff and evidence. They never hold merge authority. So you can defend the use of compute from machines that you do not control.

### Scheduling as matching

A task needs `env=container, repo=api, harness=claude-code, tier>=semi` → find an eligible worker with budget headroom → issue a lease. Leases have deadlines. A missed heartbeat expires the lease. The scheduler then requeues the task and increments the attempt count. Idempotency keys on side effects stop a double landing.

**Heartbeat is liveness, not progress.** A worker can heartbeat perfectly while making no progress at all — stalled on a loop, waiting on a dead dependency, spinning. So the worker also emits a distinct **progress signal**: events advancing, and the meter moving. The scheduler may reclaim a lease from a worker that is live-but-idle, not only from one that has gone silent. A run blocked on a human escalation (see Part 2) is exempt. It is idle by design, and its `blocked-on-human` state does not count against the progress signal.

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

## Final repo shape

Use one module, with a directory under `internal/` for each layer. Imports point one way. This is tau's rule, and the whole lesson is the boundary. The stage-numbered packages live *inside* these layers. The build path does not change. Only the ownership structure above it becomes explicit.

```
eva/                    # go.mod; cmd/ for binaries, these layers under internal/
├── events/             # THE schema: events, trace records, versioning
│                       #   imports: stdlib only, nothing internal  (stage 0)
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
│                       #   UNTIL stage 7 there is no harness, so cli imports
│                       #   config, providers, and trace directly. Narrow it
│                       #   when harness lands; do not widen it further.
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

**The rule decides the tree, not the other way round.** Anything that touches the filesystem, the network, or the terminal sits in a layer *beside* `core`, never inside it. That is why `trace/` and `config/` are siblings above, rather than children of `core/`. `core` declares the interface; the outer layer implements it. See `docs/adr/0010` for the graph and `docs/adr/0021` for the packaging; together they are authoritative on the layout.

The linter is `depguard`, configured in `.golangci.yml` and run by `make lint`. Every rule is an **allow list in strict mode**, so the boundaries fail closed: an import nobody enumerated is rejected rather than quietly permitted. A new layer needs a rule in `.golangci.yml`; a layer with no rule falls through to a standard-library-only default, so a forgotten rule fails loudly.

---

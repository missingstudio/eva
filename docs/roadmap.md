# The build path

What Eva builds, in what order, and the test each step can fail.
[README.md](README.md) says what Eva is.

This document names the four extension points — **domain**, **slot**, **hook**,
and **broadcast** — on nearly every line. [context.md](context.md) defines them, and
[reference/architecture.md](reference/architecture.md) says how they work. Read
both before this.

**This is the only roadmap.** Phases I through IV build the factory. Phase V
builds its surfaces — the terminal, the web page, the desktop app, the phone,
and the machine and chat doors. Phase VI makes the control plane a product.
A surface stage adds no extension point and changes no exit test in Phases I
through IV, which is what makes the surfaces **lanes beside the spine** rather
than links in it. They are in this document anyway, because a plan split
across files is a plan nobody can sequence.

Two id spaces run through it. A **number** is a factory stage. A **letter** is
a surface or service stage: `C` terminal, `W` web, `D` desktop, `M` mobile,
`S` managed service.

**This document says what each stage is and what it has to prove. It does not
say what to build next.** Sequencing, the dependency order over both id
spaces, and the path every stage's work goes to live in one companion:
[plan.md](plan.md). Each stage below still declares what it builds on, because
that line is the source the plan folds over — but there is exactly one place
that reads all those lines and turns them into an order, and it is not here.

Each stage declares four things:

- **What it builds on** — the stage before it, and what changed to make this one
  possible.
- **The plugins it adds** — and which of the four points each one uses.
- **The in/out contract** — what a user can type (`eva >`) and what must come
  back (`←`). If the demo block does not work, the stage is not done, whatever
  the code says.
- **The exit test** — what fails when the stage is not finished.

## The shape, and one task through it

```
                       demand
        specs · issues · chat · signals
                  │ importers (9a) · senses (13)
┌─────────────────▼──────────────────────────────────┐
│ the factory                          Phases I–IV   │
│                                                    │
│  queue → scheduler → workspaces (worktree,         │
│                       snapshot-prepared)           │
│  the fleet: eva.harness.loop, and every foreign    │
│    harness, over one contract                      │
│  verifier → evidence          merge queue → main   │
│  trace ─ meter ─ bill                              │
└─────────────────┬──────────────────────────────────┘
                  │ the Session API — the only door
        ┌─────────▼─────────┐
        │  client-runtime   │  connection, reconnect, the Run protocol
        │  + session-view   │  the one fold: Trace → Blocks
        └─┬────┬────┬───┬───┘             Phase V
          │    │    │   │
   apps/cli    │    │   apps/mobile ← LAN · tailnet · relay (9b)
   C0–C4       │    │   M0–M5: notify · read · steer
               │    │
        apps/web    apps/desktop
        W0–W5       D0–D2: the same apps/web build in a window,
                    plus tray, notifications, launch at login

     machines and channels, beside the people:
       eva.api · eva api schema · chat channels
       eva serve --acp (9c) · eva.mcp.server (9d)

  posture, by config: local single-tenant | hosted multi-tenant   Phase VI
```

Three rules hold the drawing together, and they are the same three the exit
tests keep checking.

**Below the Session API line, the factory never knows which surface asked.**
Every action arrives through one contract, lands in the Trace identically, and
is attributed to an identity — a person, a device, a worker, a mandate — never
to a door.

**Above it, no surface owns client logic or a fold of its own.**

**Every surface is a client, including the first one.**

The proof that it is one program is a single task touching every door without
the Trace noticing anything unusual:

```
09:00  eva task add tasks/EVA-142.yaml            (terminal, 9a)
         ← validated, queued; admitted into a prepared workspace
09:02  the race runs on three harnesses           (the fleet, 9c)
         ← same Spec, same Verifier, three workspaces from one snapshot
09:40  browser: /session/EVA-142                  (W1)
         ← the Run streams; a permission request appears; answered (W2)
         ← the terminal, watching the same Session, retires its own prompt
13:05  the phone buzzes                           (M1)
         ← "EVA-142 blocked · migration needs a decision"  [Allow] [Deny]
13:07  steered from the phone                     (M3)
         ← one idempotent send; the Trace attributes it to the device
17:30  the merge queue lands the winner           (10)
         ← rebased, reverified, serialized; the diff touching auth/ had
           routed to human eyes, reviewed in the desktop app (D0, W4)
18:00  eva report --week                          (terminal, 11)
         ← merged changes, $/merged change, human-minutes/merged change
```

One Session, one Trace. The terminal admitted, the browser answered, the phone
unblocked, the desktop reviewed, the report priced. Nothing in the Trace says
five surfaces were involved — only five attributed identities.

## Phase I — Model to agent

### Stage 0: Wire — done

The kernel, the plugin SDK, the ACP-shaped event schema, and a model client with
a good terminal.

```
eva > explain what this project does
  ← streamed markdown answer; cost line: 1.2k in / 340 out · cost unreported
eva > /model  /cost  /clear  /help
  ← switch model mid-session; the session's spend on demand
```

**In:** typed prompts, config, and an API key. **Out:** answers on screen and
typed events in the trace. There is no file access and there are no tools yet.

**Primitive:** the plugin runtime — four extension points, and a kernel that
holds nothing else.

**Exit test:** the bare kernel boots on Bun and on Node with every plugin
disabled; disabling the trace plugin degrades instead of crashing; and swapping
the trace sink in a live process works with no restart. `verify` runs all three
as tests, and [toolchain.md](reference/toolchain.md) §5 names the part of the
first that no workflow proves.

**What every later stage may then assume:** a working plugin kernel, a sealed
event schema that carries an ACP session with no loss, a trace with a swappable
sink, one provider, and a terminal.

### Stage 1: Workflow — done

Every plugin below ships and the gate below passes, and the stage exits on
that gate. The measurement is built and stays unrun by decision: a full run
costs about $12 to $20 and 100 minutes, and a maintainer chose not to spend
it. So no first-pass rate is on the record, and the vendored cassettes still
hold synthetic streams —
[packages/exit-test](../packages/exit-test/README.md) is the build of it.

**Builds on stage 0:** the kernel, the schema, and an empty harness domain. A Workflow is that domain's first entry.

Do this stage before agents. A team that goes straight to agency gets a
nondeterministic system that does a job a 40-line Workflow does more reliably
and ten times more cheaply.

**Plugins**

| Plugin                    | Adds                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- |
| `eva.prompt`              | prompt domain: Templates, includes, Variables                                    |
| `eva.validator`           | slot `Validator`: judges a Candidate against a JSON Schema and names every Fault |
| `eva.workflow`            | harness domain entry: a declared list of Steps, step → model → validate → next   |
| `eva.provider.openai`     | hook `model.resolve`                                                             |
| `eva.provider.compatible` | OpenAI-compatible endpoints, local models                                        |

A Workflow is a **harness**. It is the first entry in the harness domain and
it has no agency at all. That is the point: the harness contract must hold for
something deterministic before it holds for something that reasons.

```
git diff --staged | eva run commit-msg
  ← one conventional commit message; schema-valid first pass ≥95%
eva run review src/auth/login.ts
  ← structured findings: [{file, line, severity, claim}]
eva run release-notes.yaml --input CHANGELOG.md
  ← a declared list of Steps: Step → model → validate → repair once → next
```

**In:** files, piped text, and Workflow YAML. **Out:** schema-validated
structured artifacts. The code owns the control flow. The model fills the slots.

**Primitive:** structured output with a validation and repair loop.

**Exit test:** `verdictFold` and `validityOf` over the vendored
traces equal the committed golden; every vendored cassette replays through the
real fixture — the Workflow harness, the Validator, the Repair — and folds to
that same golden, so trace, cassette and golden stay three projections of one
recording; a scripted Provider that answers invalid then valid produces exactly
one `verdict` per Candidate numbered 1 then 2; the same run with the Validator
slot empty reports `unchecked` and no rate at all; the verdict the measurement
exits on is one value a test asserts, thresholds and refusal share together;
and the demo block runs. All six run in `verify`.

**The measurement, which the stage does not wait on:** five canned Workflows
over 100 Runs each report first-pass validity aggregated over the 500
Candidates and a repair yield, and the runner exits non-zero below 95% and
90%. A Run that produced no Candidate is counted rather than dropped, and past
2% of the Runs no rate is reported at all — a thinned denominator would
flatter the figure. A maintainer runs it against one named model and reads the
ratios; no workflow runs it, because a full run costs about $12 to $20.
Aggregate rather than five thresholds: at a true 97% rate, five independent
per-Workflow thresholds fail about 31% of runs. It is a tool, not a condition:
nobody has run it, and the number it would print is not what Stage 1 exits
on.

### Stage 2: Tools and the loop

**Builds on stage 1:** schema validation and the repair loop. The tool domain arrives, and `eva.harness.loop` becomes the harness domain's second entry — the first one with agency.

**Plugins**

| Plugin             | Adds                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `eva.tool.read`    | tool domain                                                      |
| `eva.tool.edit`    | tool domain; emits `edit` payloads                               |
| `eva.tool.grep`    | tool domain                                                      |
| `eva.tool.glob`    | tool domain                                                      |
| `eva.tool.bash`    | tool domain; reads slot `Sandbox`                                |
| `eva.tool.web`     | tool domain                                                      |
| `eva.tool.policy`  | hook `tool.execute.before`: the deterministic gate               |
| `eva.fs`           | slot `FileSystem`: reads and writes under a root                 |
| `eva.shell`        | slot `Shell`: starts a process, streams its output               |
| `eva.sandbox.none` | slot `Sandbox`: the seam exists, with no containment yet         |
| `eva.harness.loop` | harness domain: Eva's own propose → act → observe loop           |
| `eva.sched`        | hook `tool.execute.before`: parallel-safety classification       |
| `eva.steer`        | hook `session.prompt.before`: mid-Run user input                 |
| `eva.approval`     | agent domain + hook: named permission modes                      |
| `eva.diff`         | slot `DiffApplier`: dry-run preview, atomic apply                |
| `eva.api`          | surface: the Session API's write half, over the socket W1 opened |

**The scheduler.** The runtime classifies parallel safety through an optional
`parallelSafe(input)` capability on a tool definition — never the model.
Unclassified tools fail closed to serial. Serial calls are barriers. Concurrency
is bounded. Results commit in source order so the transcript stays
deterministic. One failure does not cancel its siblings.

**A second surface, reached over a socket — and it arrives before this
stage.** `eva.api` re-exposes the Session API over a socket. Until a second
surface exists, two claims are untested: that every interface is a plugin,
and that Eva is remote-ready. It is not a second way of reaching Eva — it is
a second row in the `surface` domain, calling the same `SessionAPI` methods
`eva.tui` calls in-process, which is the proof that the contract holds at a
distance. **If local stays a special case, half the system goes untested
until the day it matters most** — and every surface built in between has to
be retrofitted.

That plugin used to sit in this stage's table. Its read half moved earlier,
to the web surface track's first stage, for a reason this stage would have
discovered anyway: a browser cannot call an in-process Session API, so a page
that watches has to bring a wire. What is left here is the write half —
`submit`, `cancel`, `answer`, and setting the model — which is exactly the
half that needs the permission gate this stage builds. So a second surface
already exists when this stage opens, and every tool, gate, and mode below is
exercised through two doors rather than one.

The same plugin makes two later things nearly free. Stage 9c's `eva serve
--acp` is a new transport over a contract that already exists. And the
control plane at 9b needs no new interface — a worker behind NAT drives the
same API a terminal does.

**Steering.** Mid-Run user input lands after the current provider response and
tool group complete structurally. Unstarted calls become skipped results.
Nothing is orphaned.

**Approval.** Named permission modes — `read-only`, `supervised`, `autonomous`,
`plan` — with per-tool overrides inside a mode. Modes are **capability
selection** plus mandate gates. Capability selection decides which tool registry
the agent sees, and that is a rebuild of the tool domain, not a filter at call
time.

**The gate is ACP's `requestPermission`, and it answers with ACP's four
options** — `allow_once`, `allow_always`, `reject_once`, `reject_always`. That
vocabulary is better than the `ask | auto | deny` we had, because it separates
the decision from how long it persists: `allow_always` is what writes a rule
into the profile, and `reject_always` is what a mandate does. Build the gate in
this shape now, and a foreign harness at stage 9c plugs into the gate that
already exists rather than getting one of its own. A mode change emits the
`mode` payload, so `/mode read-only` is a fact in the trace and not just a
change in behaviour.

**The gate that decides allow and deny is deterministic and testable in CI. It
is never a model classifier.** A classifier looks reassuring and does not
contain: a user can wrap, alias, and substitute shell commands. A classifier
also cannot be a CI gate. A classifier may sit **above** the deterministic gate
as an advisory hook. One rule binds it: **it may narrow, never widen, and it
never substitutes for the sandbox.**

The bash rule language is deterministic: prefix rules over argument lists, a
position may hold a union, most-restrictive-decision-wins, validated by `eva
policy check` in CI. Linear shell chains split on `&& || ; |` and each part
evaluates independently. Anything with a redirection, substitution, or variable
is **one opaque invocation**, failed closed.

**Protected paths.** Writes to toolchain-bootstrap files — `.git`, `.eva`,
`.npmrc`, `.mcp.json`, CI config, dependency manifests, shell rc — are never
auto-approved, and settings cannot pre-approve them. The safety check runs
**before** allow rules. A write there is a delayed-action shell command.

Because the gate is a hook and hooks run in registration order with
most-restrictive-wins, a repo-checked-in profile may **narrow** a mandate and
never widen it. That is a property of the hook contract, not a special case.

**A hook that dies fails toward its boundary's safe side.** This stage brings
the first hooks that decide rather than observe, so it is where the failure
rule lands, and the two kinds need opposite rules. A hook at an **observing**
boundary — trace decoration, usage counting — that dies is reported and
skipped: a broken observer must never end a Run. A hook at a **deciding**
boundary — `tool.execute.before`, the gate itself — that dies is a denial: a
gate that fails open because a policy plugin threw is not a gate. The boundary
declares which it is, because only the caller of the hooks knows what they
decide. Stage 0's four provider hooks are all observers, which is why the rule
waits here rather than shipping against zero deciders.

```
eva > rename UserSvc to UserService across this package
  ← parallel reads and greps, then serial edits; every write previewed, y/n
eva > run the tests and fix the first failure
  ← bash (approved) → edit → re-run; stops at green or the max-steps fuse
eva > /mode read-only
  ← the tool domain rebuilds; writes denied before the next tool call
```

**In:** natural-language tasks against a real working tree. **Out:** multi-file
changes, previewed and undoable, inside a named permission mode.

**Primitive:** a bounded action surface and permissions.

**Exit test:** the agent completes a three-file refactor end to end. You can
preview and undo every write. Policy refuses `rm -rf /`; luck does not. A write
to `.mcp.json` is refused even when an allow rule in a repo profile would allow
it. `echo x > $VAR` is one opaque invocation and fails closed. `eva policy
check` rejects a malformed rule set in CI. Changing a live session from
`autonomous` to `read-only` takes effect before the next tool call. Two
parallel-safe reads overlap and you can show it. A write between them is a
barrier. Results land in source order. A policy hook that throws denies its
tool call; an observing hook that throws is reported and the Run continues.

**Skip cost:** without `eva.approval` you can never run unattended. That stops
stage 9 and everything after it.

## Phase II — Agent to harness

### Stage 3: Context engine

**Builds on stage 2:** a loop that calls tools. It now survives past one context window, and the compaction hook is the seam that lets a plugin decide how.

**Plugins**

| Plugin           | Adds                                                            |
| ---------------- | --------------------------------------------------------------- |
| `eva.repomap`    | slot `RepoMap`: symbols, imports, file sizes; LSP where present |
| `eva.retrieve`   | slot `Retriever`: grep-first; embeddings only where grep fails  |
| `eva.compaction` | hook `session.compact`                                          |
| `eva.project`    | transforms from `EVA.md`; path-scoped rules                     |

`eva.project` re-registers `session.prompt.before`, which stage 2 introduced for
steering. Registering into a hook that already exists is ordinary; this stage
adds only `session.compact` and `session.prompt.after`.

**Compaction.** The split point never separates a `tool_call` from its
`tool_result`, and never drops a standing constraint. The real fix is that
`Spec.constraints` live **outside the transcript**, where compaction cannot
reach them. Compaction usage is metered even when the summary is unusable — the
provider call was billable.

**The survives-compaction contract.** Every element of the runtime has a defined
post-compaction fate, and it is a table you assert against, not a hope:

| Element             | Fate after compaction                     |
| ------------------- | ----------------------------------------- |
| `Spec.constraints`  | never touched; they are not in the window |
| project conventions | re-injected from disk                     |
| path-scoped rules   | reloaded lazily on next matching touch    |
| the skill listing   | not re-injected                           |
| invoked skills      | survive                                   |
| tool results        | summarized, never split from their call   |

**Path-scoped rules.** A `paths:` frontmatter key loads a rule only when the
agent touches a matching file. Progressive disclosure for standing
instructions: conventions for `src/api/**` cost no context on a docs-only task.

```
eva > where is rate limiting actually enforced here?      # 500k-LOC monorepo
  ← repomap + grep-first retrieval; answer with file:line evidence
eva > implement the TODO in billing/invoice.ts
  ← hours-long task; survives three compactions without losing the goal,
    the constraints, or what it already tried
```

**In:** big repos and long tasks. **Out:** evidence-grounded answers and edits
that were impossible inside one context window.

**Primitive:** compaction. The agent survives past one window.

**Exit test:** the agent completes a task in a 500k-LOC repo and survives three
compactions. It loses neither the goal, the constraints, nor the record of what
it already tried. A stated boundary — "do not push" — held in
`Spec.constraints` is still enforced after all three.

### Stage 4: Environment

**Builds on stage 2:** tools that touch a real tree. They now run inside a boundary, and that boundary is ACP's client half — the same one a foreign harness will use at stage 9c.

**Plugins**

| Plugin                   | Adds                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `eva.workspace`          | slot `Workspace`: local dir, worktree, container, remote VM           |
| `eva.workspace.worktree` | workspace driver: git worktree per unit                               |
| `eva.sandbox.local`      | slot `Sandbox`: replaces `eva.sandbox.none` with real containment     |
| `eva.snapshot`           | slot `Snapshot`: checkpoint and restore; prepared repo-profile images |
| `eva.net`                | hook `tool.execute.before`: egress allowlist per profile              |
| `eva.secrets`            | injection at the env boundary, never into context                     |

**Fork at the environment layer.** `Workspace.create(info, env, from?)` — the
`from` parameter forks a workspace from another. Best-of-N harness racing needs
N workspaces from **one snapshot**, not N sessions sharing one workspace, so
this primitive belongs here and not at stage 7. `Workspace.target()` returns
`{ localDir }` or `{ remoteUrl }` uniformly: one code path, expressed as a type.

The field ships this as a headline feature — several harnesses side by side,
each in its own worktree, results compared and the winner merged. That is
stage 4's fork primitive plus stage 9c's race, and it is the reason the two
must not be collapsed.

**Declarative isolation.** `isolation: worktree` on a profile or spec runs the
unit in its own git worktree, auto-cleaned when it made no changes, with git
redirects back into the main checkout blocked. Port allocation across parallel
worktrees is the Workspace's problem, not the user's: two checkouts of one
project must not fight over one dev-server port.

**A snapshot is two things.** The first is a checkpoint: pre-run state,
restored in one command, recorded with the trace position it was taken at, so
a restore brings back the tree and the conversation together. The second is a
prepared environment: a repo-profile image with dependencies already
installed, so the stage 9a backlog pays environment setup once per profile and
never per task. The field ships exactly this shape — a profile publishes
versions, a version materializes a snapshot — and the overnight backlog is the
reason to copy it.

**This stage completes ACP's client half, and it is where containment actually
comes from.** `FileSystem` becomes `readTextFile` and `writeTextFile`; `Shell`
and `Sandbox` become `createTerminal` and its lifecycle — output, wait-for-exit,
kill, release. Build them in that shape and Eva's own loop starts using the
exact path a foreign harness may use at stage 9c.

Be precise about what that buys. A harness that calls the client half gets its
edits recorded; a harness that uses its own file tools does not, and **the
protocol cannot make it**. A leading native ACP agent calls `requestPermission`,
and from the filesystem half only one display-only `writeTextFile` that renders
a diff — no reads, no terminals — verified in its source, against v1.
So the guarantee that a foreign harness cannot escape does **not** come from ACP.
It comes from `Workspace` and `Sandbox`: a process confined to a worktree is
confined whether or not it ever asks Eva for a file handle. The field's
orchestrators reach for the worktree for exactly this reason.

That is why this stage matters more than it looks. Containment is a property of
the boundary built here, and `--race` at stage 9c is only a fair comparison
because this stage exists.

The `Workspace` slot must abstract a **remotely provisioned** sandbox from the
first commit, not only a local directory. That is what later lets E2B or
Firecracker drop in with no change to the loop.

```
eva --env worktree > upgrade the ORM and see what breaks
  ← runs in an isolated worktree; the host tree is untouched
eva env snapshot   /   eva env restore <id>
  ← pre-run state back in one command
eva > (a deliberately destructive prompt)
  ← contained by the sandbox, not by the model's good manners
```

**In:** the same tasks, and dangerous ones too. **Out:** identical results in
disposable environments, and a one-command rollback.

**Primitive:** isolation and reproducibility.

**Exit test:** a deliberately destructive run cannot touch the host, and one
command restores the pre-run state. A workspace forked with `from` produces a
byte-identical tree. A workspace created from a prepared snapshot starts with
its dependencies already installed and pays no setup.

### Stage 5: Verifier — the highest-use stage

**Builds on stage 4:** a disposable workspace to be wrong in. The check domain turns a claim into evidence, and it is a domain so that a third party can add a check without an API for it.

Every stage after this one adds throughput. This stage adds quality.

**Plugins**

| Plugin              | Adds                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `eva.verify`        | **check domain** + slot `Verifier`                                  |
| `eva.check.build`   | check domain: build, typecheck, lint, unit, integration             |
| `eva.check.lsp`     | check domain: LSP diagnostics — the cheapest oracle for typed code  |
| `eva.check.browser` | check domain: drives a page for UI acceptance; keeps the screenshot |
| `eva.remediate`     | hook `run.retry.before`: runs `Spec.remediation` before retry       |

**The check domain is why stage 6.5 shrank.** A community check is a plugin that
writes to the check domain. There is no `RegisterCheck` API to design, because
the domain already is that API. A check may be a soft model verifier — it is
marked degraded and it never merges.

**Acceptance criteria may name a page.** A spec that says "the export page
rate-limits visibly" needs a browser check, not a unit test.
`eva.check.browser` drives the page — map, click, diff, screenshot — and keeps
the screenshot as evidence, because stage 10 attaches it to the PR. The field
already ships an off-the-shelf filler for exactly this check.

**Remediation.** On a failed attempt with retries left, run `Spec.remediation` —
the compensating cleanup — **before** the next attempt, so a retried job never
inherits a dirty environment: a half-written migration, a running process, a
stale lock. In a factory that retries on another worker, that dirt is a
correctness bug and not an inconvenience. Then apply `Spec.retryPolicy`: keep
the failure context, or reset history to initial. The choice is per-task,
declared, never hardcoded.

**Build the verifier as a standalone contract you can run externally. Do not
build it as a function inside the loop.** This is what later lets Eva check the
work of a foreign harness. Build it inline and you rewrite stages 5 through 9c
when the adapters arrive.

```
eva > fix the flaky date parsing test
  spec.acceptance: ["bun test src/date passes", "lint clean"]
  ← the loop iterates against the checks; Done only when the verifier says so.
    The agent's own claim of success is not accepted.
eva verify --spec task.yaml --workspace .
  ← standalone: evidence report + exit code, runnable against ANY diff,
    including a foreign harness's
```

**In:** tasks with machine-checkable acceptance. **Out:** evidence, not claims.

**Primitive:** ground truth. The agent can be wrong cheaply and often.

**Exit test:** measured pass@1 on a fixed 20-task set improves materially
against stage 2 with the same model. If it does not improve, your diagnostics do
not reach the loop. `eva verify` scores a diff produced by something that is not
Eva.

### Stage 6: Memory and trace

**Builds on stage 0:** the sink that has been recording since the first commit. This stage adds replay, the cost fold, redaction, and memory — and freezes the schema.

**Plugins**

| Plugin                  | Adds                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `eva.trace.replay`      | command domain: `eva trace show`, the cost fold per step          |
| `eva.trace.redact`      | hook `trace.commit.before`: sink-side redaction                   |
| `eva.trace.publish`     | command domain: a finished Run becomes a readable, resumable page |
| `eva.memory.project`    | slot `Memory`: learned facts, conventions, gotchas                |
| `eva.memory.procedural` | memory domain: reusable playbooks                                 |

The sink shipped at stage 0. This stage adds replay, the cost/latency/token fold
per step, and redaction. It invents neither a schema nor a sink. It **makes the
existing schema a versioned public contract**, because adapters and third-party
plugins emit into it. That is the point where `schemaVersion` stops being ours
to change freely. Redaction lands here rather than at stage 0 because there is
nothing to redact before stage 2 brings tools and stage 4 brings secrets.

**The trace wants to be an artifact.** A finished Run can publish as a page a
colleague reads — summary, conversation, tool activity, diff — and resumes in
a session of their own. Nothing leaves the machine except on an explicit
share, and redaction runs before anything does. The field proves both halves
are wanted.

**Project memory structure.** A `MEMORY.md` index plus topic files. Only the
first ~200 lines or 25 KB of the index load at startup; topic files load on
demand. The cap makes memory bounded-cost by construction and nudges the agent
to keep the index short. Each file carries a modified timestamp so staleness is
visible.

```
eva trace show <run-id>
  ← the full trace, replayable: every step with cost, latency, tokens
eva > (a task similar to last week's)
  ← measurably cheaper: project memory recalls conventions and where things
    live, instead of re-discovering them
```

**In:** past runs. **Out:** replay, and a second run that costs less than the
first.

**Exit test:** the second run of a similar task is measurably cheaper and
faster. Compaction achieves a measured compression ratio on the fixture set
(128k → 12k is the bar) and loses no goal. If it does not, your memory is
decoration.

### Stage 6.5: Extension distribution — third parties, trust, and isolation

**Builds on stage 0:** an extension surface that already exists and that every plugin since has used. This stage adds only where a plugin comes from, why to trust it, and how to contain it.

The extension **surface** shipped at stage 0. This stage does not invent it.
This stage answers three questions the surface does not: where does a plugin
come from, why should we run it, and what happens when it misbehaves.

**Packages**

```
plugins/registry/    bundle manifest, profile resolution, SHA pins,
                     event-schema version pinning
plugins/trust/       the trust gate: repo-local plugins denied by default;
                     per-tenant governors (managed-only, allow/deny, version range)
plugins/host-remote/ out-of-process plugins: the host half and the client half
```

**Out-of-process plugins.** A plugin that runs in Eva's process can crash Eva. A
third-party plugin should not be able to. One surveyed harness ships **dual-half
packages**: a host half that owns a sandbox lifecycle and an invoke-handler
table, and a client half that runs on the far side — there, an in-process
`node:vm` sandbox and a browser page, not a separate OS process. Eva borrows the
split and moves the boundary: the client half runs in its own process, which is
the part this stage has to prove. The `Plugin` contract does not change — the
client half implements the same `define({ id, effect })`, and the host half
proxies the `PluginContext` across the boundary.

**This constrains the SDK now, not at 6.5.** Every domain draft and hook context
must be serializable, or it can never cross a process boundary. Review that
property when you add an extension point, not when you get here.

**First-party plugins prove the surface.** Plan mode, todo, the permission
prompt UI, and goal mode are all plugins built on the same `PluginContext` a
third party gets. Goal mode: a standing objective with typed state, where the
model may claim `complete` or `blocked` only through one narrow tool, and the
user owns pause, resume, and clear.

```
eva plugin add github:acme/eva-plugin-guard#<sha>
  ← installs untrusted; prints the build it skipped; asks for confirmation
eva > /deploy staging
  ← the community command runs under the same budget, trace, and mandate
```

**In:** packages from the ecosystem. **Out:** new tools, commands, checks, and
hooks that we did not write.

**Primitive:** a trusted, versioned, isolatable distribution channel over an
extension surface that already exists.

**Exit test:** a third party ships a plugin that vetoes `rm -rf` through
`tool.execute.before`, adds a `/deploy` command, and registers a check into the
check domain. It installs as a package. It still works after a minor-version
upgrade of Eva with no recompilation. Run the same plugin out-of-process: kill
its process mid-run, and Eva reports a `degraded` payload naming the lost plugin
and continues.

### Stage 7: Harness profiles

**Builds on stage 2's loop and stage 4's workspace.** The loop becomes a host plugin, and a profile composes harness, model, tools, policy, budget, and environment into one named thing.

**Plugins**

| Plugin         | Adds                                                          |
| -------------- | ------------------------------------------------------------- |
| `eva.profile`  | agent domain: model + harness + tools + policy + budget + env |
| `eva.agents`   | agent domain: the built-in agent definitions                  |
| `eva.subagent` | tool domain: spawn a child harness with a narrowed toolset    |
| `eva.resume`   | slot `SessionStore` gains durable resume                      |
| `eva.branch`   | command domain: fork a session from any checkpoint            |
| `eva.rewind`   | command domain: user-facing entry points over branch          |

The harness domain has existed since stage 0. This stage adds the **profile** —
the named composition that decides which harness answers, with what, under what
limits.

**`eva.harness.loop` implements ACP's agent half here.** Not a simplified
version of it, and not a special in-process interface: the same
`createSession`, `loadSession`, `forkSession`, `resumeSession`, `prompt`,
`cancel`, and `updates` a foreign harness implements. The transport is direct
calls instead of JSON-RPC, and nothing else differs.

That is what makes this stage's session verbs fall out rather than get built
twice. `eva branch` is `forkSession`. `eva resume` is `resumeSession`, returning
`resumed | rejected | undetectable`. `/mode` is `setMode`. `/model` mid-session
is `setSessionConfigOption` with the `model` category — **not** `setModel`,
which the protocol removed. Steering is `send(message, "next-step")` into the
inbox. Build them against the protocol and stage 9c inherits every one of them
for free; build them as bespoke Eva verbs and stage 9c re-implements all of them
per adapter.

Of these, only `forkSession` still rests on a draft method. The rest are settled
in v1 — [reference/architecture.md](reference/architecture.md) carries the table
and the version it was checked against.

**The loop also becomes a host plugin here.** Up to now `eva.harness.loop` has
been one plugin. This stage splits its internals — context assembly, compaction,
the system prompt, the tool-call scheduler, the retry policy, and the steering
inbox — into plugins it hosts, each filling an extension point only the loop
exposes. [reference/architecture.md](reference/architecture.md) has the full
list and the mechanics of host-scoped points.

Do it at this stage rather than earlier because a profile is the first thing
that needs to vary any of them, and do it rather than never because a harness
that is one opaque plugin can only be replaced, never adjusted.

```yaml
# ~/.eva/profiles/fixer/eva.config.yaml
agent:
  fixer:
    harness: eva.harness.loop
    model: anthropic/claude-opus-4-8
    tools: [read, edit, grep, "bash:test/*"]
    verify: [typecheck, unit]
    env: worktree
    budget: { usd: 2.0, minutes: 15, steps: 40 }
    onExhausted: escalate
```

**Subagents are capability selection.** Typed modes: `work` (writable, serial)
and `inspect` (read-only registry, parallel-safe). Unknown modes fail closed to
the restricted set.

**Unattended means narrower by default.** A unit running in the daemon with no
human present resolves to a reduced built-in tool set unless its mandate
explicitly widens it. The same profile yields fewer tools when it runs
unattended. This is the posture that ties together disallowed tools, disabled
model invocation, and protected paths: the factory's default is less capability,
and the mandate is the only thing that grants more.

**A fork or a resume records its lineage.** The new Run carries what it came
from — the session and the checkpoint — as a fact in the trace. Provenance
survives any number of branches, and a surface can always answer where a Run
came from.

**Rewind is honest.** `restore-code`, `restore-conversation`, and
`restore-both` are independent axes. `summarize-from-here` and
`summarize-up-to-here` are aimed compaction. Checkpoints do **not** track
bash-command file writes or subagent edits. State that boundary rather than
imply total reversibility.

```
eva --profile fixer "fix the login redirect bug"
  ← runs under {$2, 15 min, 40 steps}; on exhaustion → escalates with
    partial work preserved
kill -9 <pid>;  eva resume
  ← continues from the last committed step; no duplicated side effects
eva branch <session>@12 --profile reviewer
  ← two branches from one checkpoint: shared prefix, divergent suffixes
eva > /goal make every test in this package pass
  ← standing objective; may only claim complete | blocked through the goal tool
```

**In:** profiles, budgets, and standing objectives. **Out:** a session you can
kill, fork, resume, and leave alone.

**Exit test:** kill the process during a task. `eva resume` continues from the
last committed step and duplicates no side effects. Fork the killed session at
step N into two branches with different profiles. Both complete. The traces show
a shared prefix, divergent suffixes, and the checkpoint each branch forked from.

### Stage 8: Eval harness

**Builds on stage 5's verifier and stage 7's profiles.** An explicit plugin list — the same mechanism as stage 0's bare-kernel boot — is what makes a run hermetic.

Without this stage you cannot improve on purpose. You improve only by feel and
by model upgrades.

**Plugins**

| Plugin             | Adds                                                      |
| ------------------ | --------------------------------------------------------- |
| `eva.eval`         | command domain + harness domain entry: the suite runner   |
| `eva.eval.score`   | pass/fail, cost, steps, human-touch rate                  |
| `eva.eval.compare` | A/B two prompt, profile, or harness versions; diff traces |
| `eva.eval.gate`    | CI check blocking merges that regress the suite           |

**Freeze the harness, not only the repo.** An eval must run in a hermetic mode
that skips auto-discovery of plugins, hooks, skills, MCP servers, and memory,
and reads no ambient credentials, so two workers score the same fixture
identically. Otherwise the suite silently measures the worker's installed
plugins and memory rather than the change. That is eval-suite pollution, and in
a plugin-first system it arrives through the one path the design must not leave
open.

Plugin-first makes the fix trivial, and it is the same mechanism as the stage 0
exit test: **the eval runs with an explicit plugin list, not a discovered one.**

```yaml
plugins: [{ id: "*", disabled: true }, eva.trace, eva.harness.loop, eva.tool.read]
```

**Deterministic size budgets — prompt bytes, binary size — are the only
performance regression gates.** Timings are informational and never CI gates, so
the suite stays trustworthy instead of flaky.

```
eva eval run --suite core-20
  ← pass@1, cost, steps, human-touch per task; trend against baseline
eva eval compare profiles/fixer-v1 profiles/fixer-v2
  ← A/B verdict with trace diffs
(in CI) a deliberately worsened prompt
  ← merge blocked
```

**In:** frozen task fixtures and two candidate configs. **Out:** verdicts
instead of opinions.

**Exit test:** CI catches and blocks a prompt you made worse on purpose. The
same fixture scores identically on two machines with different plugins
installed.

This is the boundary between a tool and a system. Below it, changes are guesses.
Above it, changes are experiments.

## Phase III — Harness to factory

### Stage 9a: Work items and local scheduler

**Builds on stage 7:** a session you can kill, fork, and resume. Unattended throughput needs nothing more from the loop, only a queue and a supervisor around it.

The critical artifact is the machine-readable spec:

```yaml
id: EVA-142
intent: "Rate-limit the /export endpoint to 10 req/min per org"
context: ["src/api/export.ts", "docs/rate-limits.md"]
acceptance:
  - "bun test rate-limit/export passes"
  - "no p99 change on other endpoints in bench suite"
budget: { usd: 5, minutes: 30 }
risk: medium
```

**Plugins**

| Plugin            | Adds                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `eva.task`        | slot `TaskStore`: spec schema, validator, fan-out                 |
| `eva.task.import` | importer domain: Linear, GitHub issues                            |
| `eva.queue`       | slot `Queue`: durable, leases, retries, dead-letter, priority     |
| `eva.scheduler`   | slot `Scheduler`: N workers, one env each, budget-aware admission |
| `eva.daemon`      | surface: long-running supervisor, health, graceful drain          |

**Fan-out.** One Run freezes a spec snapshot and the complete target set at
admission, then creates one Job per target — independent failure, independent
retry, Run state derived from its Jobs.

**Admission is into a prepared workspace.** Where a repo profile names a
stage 4 snapshot, a Job starts with dependencies already installed. The
backlog pays environment setup once per profile, never per task — a factory
that pays it per task loses the overnight race.

**Triggered work** commits a durable admission record **before** task creation,
then creates-or-recovers the task and links it in one transaction.

Task states are explicit and visible: `pending → blocked (with a reason — no
silent starvation) → queued → preparing → running → terminal (succeeded |
failed | cancelled | skipped)`.

**Anything that admits work autonomously is created disabled.** Schedules, issue
triggers, importers. A preview runs with no durable writes: no record, no
counter, no cursor. To enable it, the operator confirms a statement of what will
run, where, and when next.

**Composed prompts carry provenance labels.** Trusted operator instructions and
trigger conditions (canonical fixed-order JSON) stay separate from untrusted
observations, and carry a standing instruction: revalidate live state before any
mutation, and stop if the trigger no longer matches. Bound everything: every
field has a numeric limit, and a value that hits a limit is rejected visibly.
Never prune the dedup identity records.

```
eva task add tasks/EVA-142.yaml
  ← validated against the spec schema; queued; every state visible end to end
eva run-def find-bugs --repos api,web,billing
  ← one Run freezes definition + target set: three Jobs, independent retry
eva daemon
  ← the backlog drains overnight; morning: outcomes, evidence, spend
```

**In:** machine-readable specs and repo fleets. **Out:** unattended throughput
with an audit trail.

**Exit test:** `eva daemon` clears a 20-task backlog overnight with no
attendant. Kill the daemon mid-run and replay every API call. There are no
duplicate tasks and no orphaned admission records.

### Stage 9b: Control plane and enrollment

**Builds on stage 9a:** a daemon that drains a backlog. It now joins a fleet, and enrollment is where mandate issuance starts.

**Plugins**

| Plugin         | Adds                                                     |
| -------------- | -------------------------------------------------------- |
| `eva.control`  | surface: API, stream terminator, lease issuance          |
| `eva.enroll`   | three-tier tokens, rotation, revocation                  |
| `eva.identity` | slot `Identity`: scoped worker credentials, capabilities |
| `eva.attest`   | hook `trace.commit.before`: signed non-repudiable log    |
| `eva.tenant`   | row-level security, per-tenant queues, authn and authz   |

Move `eva.identity` and `eva.attest` forward from stage 14. Enrollment **is**
mandate issuance. Both modules are small while the only subject is a worker.

**Every control-plane method names the scope it requires.** A token carries
scopes, not a role, and a client gets exactly the methods its scopes name.
That is what lets a later device tier be one tier wider instead of a second
permission system.

**A scoped credential is good; an absent one is better.** Where a provider
allows it, a broker signs on the worker's behalf and the secret never enters
the environment at all — the field's strongest stance, adopted whole.
Injection at the env boundary (stage 4) is the floor, not the goal.

**Fleet truth is decided before the fleet grows.** Workers are authoritative
for what physically exists on them. The control plane projects; it never
reconciles the world toward a record — except deletion, where a tombstone is
the durable intent, swept when the worker returns. Cancellation is best-effort
across planes: a kill is a request, and the trace records what actually
stopped. The field wrote these rules as ADRs first; Eva writes its own into
`docs/adr/` when this stage starts.

```
eva control up  &&  eva enroll create --tier semi --ttl 10m
  ← one pasteable token
(any machine, behind NAT)  eva daemon --join https://cp.example.com --token …
  ← worker online in the fleet view; revocable within one heartbeat
eva top
  ← needs-attention first, each blocked Run with its reason; then leases,
    workers, spend — derived from the trace, never self-reported
```

**In:** a token. **Out:** a fleet.

**Exit test:** a laptop behind NAT and a VPC runner both enroll with one pasted
token. Both take work. You can revoke both within one heartbeat. Two tenants'
tasks never share a VM.

### Stage 9c: Harness adapters — the multi-harness stage

**Builds on stages 0, 2, 4, and 7 together.** The contract, the permission gate, the client half, and Eva's own implementation of the agent half all already exist. This stage adds implementations, not interfaces.

This is where Eva stops being a harness and starts being a factory. **The
harness subscriptions you already pay for become workers in the same fleet,
under the same spec, the same verifier, the same trace, and the same bill.**

**Plugins**

| Plugin                 | Adds                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `eva.harness.acp`      | harness domain: **the ACP runtime, for any ACP agent**          |
| `eva.harness.<vendor>` | thin extension per fleet member: launch, auth, capability probe |
| `eva.harness.conform`  | check domain: the adapter conformance suite, run nightly        |
| `eva.serve.acp`        | surface: `eva serve --acp` — Eva **as** an ACP agent            |
| `eva.race`             | command domain: run one spec on N harnesses, score each         |

**An adapter may be a host plugin too.** Some fleet members have plugin
ecosystems of their own. An adapter for one of them may expose those as
host-scoped extension points, so the foreign harness's plugins keep working
under Eva. Eva does not flatten another system's extensibility into one opaque
row — that is the same rule stage 7 applied to Eva's own loop, pointed outward.

#### There is no new contract in this stage

This is the payoff of adopting ACP at stage 0. The harness contract is already
written, already implemented by `eva.harness.loop`, and already exercised by
Eva against itself.
Stage 9c adds no interface. It adds **implementations of an interface that
exists**, and the operational reality of driving somebody else's process.

**None of the fleet needs a bespoke adapter.** Every fleet member either
implements the agent half natively or has an ACP bridge maintained under the
protocol's own organisation, and the rest of the field presents as ACP agents
too — the survey's field notes carry the per-vendor evidence, with SDK versions
and checked dates. So by our own rule — a bespoke adapter dies when its vendor
ships ACP — every one of these is `eva.harness.acp` plus a launcher entry, and
the bespoke-adapter count is zero.

**Drive the SDK or the app-server, never the CLI.** A CLI's stdout is a product
surface that changes without notice; an SDK and an app-server are contracts. The
maintained bridges target the latter for exactly this reason, and where Eva
writes its own path it does the same.

**Build `eva.harness.acp` first**, not a vendor bridge. It is the cheapest
possible second harness — the protocol is already in `packages/acp/` from
stage 0 — and it proves the contract really is the protocol rather than an
Eva-flavoured variant of it. Build the richest-event-stream bridge second,
because it will find whatever the protocol does not cover.

**One ACP runtime, plus thin per-vendor extensions.** Not one adapter that
covers everything — that is the optimistic version and the field disproves it.
The field's production orchestrators run a first-class ACP runtime and still
carry vendor extensions beside it, with env-gated CLI probes beside those.
Budget for the same:
a shared runtime that does the protocol, and small per-vendor modules for launch
arguments, auth quirks, and capability probing. The extension is where a vendor
differs; it is never a second contract.

The anatomy of that extension is settled, because the field wrote it twice
independently. A launcher entry is a descriptor: an install spec, a credential
probe, a readiness verdict, a launch template, and a docs URL. A vendor module
is at most four hooks: spawn arguments, auth probing, permission mapping, and
transport. The descriptor answers availability and launchability without ever
starting a session, and an extension that needs more than the descriptor and
the four hooks is becoming a second contract; stop it there.

**A bespoke adapter's job is to present as ACP.** It translates a CLI's output
into ACP session updates and answers ACP client calls. It does not define its
own shape. When that CLI ships native ACP support, the bespoke adapter is
deleted and `eva.harness.acp` takes over with no change above it.

#### Eva as an agent, not only as a client

`eva serve --acp` exposes `eva.harness.loop` over stdio JSON-RPC as an ACP
agent. Any ACP client — an editor, an orchestrator, another Eva — can then
drive Eva the same way it drives any other agent.

This costs almost nothing — the agent half is already implemented from stage 7,
and this plugin is a transport — and it changes what Eva is. Adopting the
protocol makes Eva **adoptable**, not only adopting. Ship it in this stage while
the protocol work is loaded, not as a later idea.

#### Capability negotiation, and the honesty rule

No two harnesses support the same things. The survey's widest orchestrator
supports about twenty backends and its adapter fields carry the scars:
reasoning effort is honored by a handful of them and silently ignored by the
rest; extra CLI arguments are honored only by backends that opt in; some
backends need the system prompt inline while others read it from an
instructions file on disk, each under its own name.

ACP already has the mechanism: `initialize` negotiates `AgentCapabilities` and
`ClientCapabilities` in both directions, as optional booleans and capability
objects. Eva's rules on
top of it, all supported by stage 0's payload union:

- A capability an adapter cannot support is **absent** from its declared
  capabilities, and the loop degrades rather than fails. `eva branch` against a
  harness with no `sessionCapabilities.fork` reports `degraded` naming the
  capability — it does not fail, and it does not silently do nothing.
- Output Eva cannot translate becomes `unknown`, with the original kind
  preserved. We never drop an event.
- A capability requested and silently not applied emits `degraded` naming it.
- **An adapter never invents a payload.**
- Whether a session's context can be **re-seated on a different harness** is
  itself a declared capability. The fallback — replay the trace into a fresh
  session — always exists; an adapter that can hand off better says so.

The silent case is the common one, and negotiated capabilities are what turn
silence into a recorded fact.

`eva harness list` publishes the result as a matrix: per-harness capabilities,
measured by probes and the conformance suite, each with the date it was
checked. Measured, never assumed — the field maintains this document by hand;
Eva generates it.

#### Resume is the hard part

The field notes are unambiguous: resume is where multi-harness breaks.

| Fact                                    | What Eva must do                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| A resume can be **rejected**            | Detect it and fall back to a fresh session                                   |
| Rejection can be **undetectable**       | Declare per adapter which one it is. `false` is not evidence of success      |
| A fresh fallback loses history          | Emit a continuity notice — but only when the surface actually lost something |
| Not every failure needs a fresh session | Network, rate limit, quota, 5xx, and auth keep the session pointer           |

Eva's `ResumeResult` — `resumed | rejected | undetectable` — is defined in
[reference/architecture.md](reference/architecture.md). What belongs here is the
work: every adapter has to decide which of the three it can honestly report, and
the fresh-session fallback is written once, provider-agnostically, not per
adapter.

#### Timeouts are plural

One timeout number is wrong. These answer different questions and move
independently:

| Timeout               | Question it answers                      |
| --------------------- | ---------------------------------------- |
| `wallClock`           | has this run exceeded its hard deadline? |
| `firstTurnNoProgress` | did the harness ever start producing?    |
| `semanticInactivity`  | has a running Run gone quiet?            |
| `idleWatchdog`        | have we seen no message at all?          |
| `handshake`           | did the startup RPC complete?            |

A zero wall clock means no deadline: a session that keeps emitting events is
never killed merely for running long. Liveness belongs to the inactivity
watchdogs.

#### Cost comes from the provider

The schema settled this: provider-reported cost in integer ticks, keyed by
model. The work in this stage is finding where each harness reports it — some do
not report it at all, and a `degraded` marker is the correct answer there.

```
eva task run EVA-142 --harness <vendor>
eva task run EVA-142 --race eva,<vendor-a>,<vendor-b>
  ← same spec, same verifier, one workspace forked three ways;
    scored results per harness — the routing table starts accumulating
eva harness list
  ← the capability matrix: installed harnesses, detected versions, measured
    capabilities, each with a checked date
eva serve --acp
  ← Eva's own loop, as an ACP agent, for any client that speaks it
```

**In:** one spec and N harnesses. **Out:** verified, comparable outcomes.

**Exit test:** five things.

1. The same task runs on three harnesses, each in its own workspace forked from
   one snapshot, against the same verifier, and the eval suite scores all three.
2. Every one of the three ran under Eva's permission gate and inside Eva's
   workspace boundary. The traces prove the first: each has `tool_call` payloads
   with a recorded permission outcome. The sandbox proves the second: no harness
   touched a path outside its worktree, whether or not it asked Eva for the
   file. Separately, `eva harness list` reports **per harness** whether it
   routes reads and writes through the client half — that number varies by
   harness, it is measured rather than assumed, and a harness that scores low
   still races.
3. Kill one mid-run. The other two finish, and the trace names what was lost.
4. Resume a foreign harness's session, have the resume rejected, and watch Eva fall
   back to a fresh session with a continuity notice and no duplicated side
   effects.
5. `eva serve --acp` drives Eva's own loop from a second Eva instance running
   `eva.harness.acp`. Eva on both ends of the protocol is the cheapest proof
   that the contract is symmetric and complete.

The conformance suite's fixtures are captured live adapter traces. It replays
them nightly against upstream and fails when a vendor drifts, before a user
sees it. Per adapter it emits a written gap report: every claim with a source
reference and a review date, closed gaps kept in a closed section.

Point 2 is the one that justifies the whole stage. Without it, `--race` is three
harnesses under three different sets of rules, and the scores mean nothing. Note
that its two halves are earned in different places: the permission gate comes
from the protocol, and the boundary comes from stage 4. Neither alone is enough.

### Stage 9d: Skills and MCP

**Builds on stage 9c:** foreign harnesses under one contract. They now use Eva's verifier, repo map, and memory, which is the inversion that makes stage 9c pay.

**Plugins**

| Plugin           | Adds                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `eva.skill`      | skill domain: source format, compiler, per-harness targets             |
| `eva.mcp.client` | tool domain: MCP servers become tools                                  |
| `eva.mcp.server` | surface: verifier, repo map, memory, task graph, coordination over MCP |

One skill source compiles to each harness's native format: a vendor's skill
package, a `SKILL.md`, or plain instructions for a harness with no skill
concept. The
compiler targets are a domain, so a new harness adds a target without touching
the compiler.

`eva.mcp.server` is what lets a foreign harness use **Eva's** verifier, repo
map, and memory. That is the inversion that makes stage 9c pay: the foreign
harness does the work, and Eva supplies the ground truth.

The task graph carries the coordination tools. An agent can wait until another
agent is genuinely blocked — a synchronization primitive, not a poll of the
trace — so multi-agent work coordinates without busy-waiting. The blocked
state it waits on is the one stage 9a made first-class.

```
eva skill install migrate-db
  ← compiled per harness: native, SKILL.md, or plain instructions
eva task run MIG-7 --harness <vendor>
  ← the foreign harness follows the skill and uses Eva's verifier and
    repo map over MCP
```

**In:** one skill source. **Out:** the same behaviour under every registered
harness.

**Exit test:** you author one skill once, and it behaves correctly under all
registered harnesses.

### Stage 10: Integration — the rung nobody builds

**Builds on stage 9:** parallel unattended output. Eight branches now have to land, and that is a different problem from producing them.

Eight agents produce eight branches. A naive factory fails here.

**Plugins**

| Plugin             | Adds                                                          |
| ------------------ | ------------------------------------------------------------- |
| `eva.integrate`    | branch-per-task, PR with spec, trace link, and evidence       |
| `eva.mergeq`       | slot `MergeQueue`: serialized landing, rebase-and-reverify    |
| `eva.conflict`     | detect overlapping edits **at schedule time**, not merge time |
| `eva.review.auto`  | harness domain: second-pass review against the spec           |
| `eva.review.route` | risk score decides: auto-merge, agent review, or human eyes   |

**Never auto-merge changes to CI config, to auth code, or to dependency
manifests.** This holds whatever the test status is.

**The PR carries evidence a human can read.** The verifier's report is
attached with its human-legible artifacts — the test output, the screenshot a
browser check took at stage 5. A reviewer the risk score routes to should
never have to reconstruct why the work is believed done.

**Be honest about external side effects.** You cannot promise exactly-once for
writes the agent performs: comments, pushed branches, opened PRs. A retry after
the agent started needs an explicit **warned retry**. Every run carries stable
`EVA_RUN_ID` and `EVA_JOB_ID`, so agents make branch names and markers
retry-safe.

```
eva mergeq status
  ← eight branches: conflicts detected at schedule time, rebase → reverify →
    land serially; a diff touching auth/ routes to a human despite green
eva task retry JOB-88
  ← warned retry: "the agent may already have opened a PR"; stable
    EVA_JOB_ID keeps branch names collision-free
```

**In:** eight finished branches. **Out:** a green main, and honesty about
external side effects.

**Exit test:** eight parallel agents land eight changes on `main` in one
session, with no broken builds and no silent semantic conflicts.

Human review bandwidth is now the limit on the whole system. Every stage after
this is about how to spend that bandwidth well.

### Stage 11: Economics, dashboard, billing

**Builds on stage 6's trace and stage 9c's per-harness attribution.** You cannot price harnesses apart without both.

**Plugins**

| Plugin           | Adds                                                                           |
| ---------------- | ------------------------------------------------------------------------------ |
| `eva.meter`      | cost per task, per merged change, **per harness**; attribution                 |
| `eva.gateway`    | optional filler at the provider seam: meters the harnesses that report no cost |
| `eva.policy.org` | org rules as code: prod access, spend caps, escalation                         |
| `eva.report`     | throughput, pass rate, human-touch rate, $/merged change, trend                |
| `eva.projector`  | read models; TUI first, then web                                               |
| `eva.billing`    | usage events, invoicing, plan limits, hard caps                                |

**Every metric computes over one declared cohort** — tasks admitted in-window,
post-filter. A retry never creates a new job, so it cannot inflate throughput.
Success rate excludes cancellations from the denominator.

Per-harness attribution is what makes stage 12's routing possible: you cannot
learn which harness to use for which task class if you cannot price them apart.

**The web interface is not built here.** `eva.web` used to sit in the table
above, which would have made a browser wait for the economics stage. It
belongs to the web surface track, whose first stage has no prerequisite past
stage 0 — so by the time this stage runs, the page already exists, and this
stage adds read models to it instead of inventing it. What stays here is the
money: the meter, the attribution, and the two numbers that run the
business.

**Provider-reported cost stays the rule, and `degraded` stays the honest
gap.** For a harness that never reports, the one honest alternative is a
metering gateway: route its model traffic through `eva.gateway` and meter at
the gateway, to the tick. It is optional and per-harness — a filler, never a
requirement.

```
eva report --week
  ← merged changes, $/merged change, human-minutes/merged change, trend
eva top → Money
  ← burn vs cap, live; spend by task, profile, harness
```

**In:** the trace stream. **Out:** the two numbers that run the business.

**Exit test:** one command answers "what did the factory produce this week, at
what cost, and how much human time did it consume."

### Stage 12: Continual learning

**Builds on stage 8's eval suite and stage 11's attribution.** Routing stops being a guess and becomes a measurement.

**Plugins**

| Plugin              | Adds                                                          |
| ------------------- | ------------------------------------------------------------- |
| `eva.learn.mine`    | cluster failures across traces, find repeated stalls          |
| `eva.learn.distill` | recurring fixes → playbooks and memory entries                |
| `eva.learn.propose` | prompt and profile changes, gated by the eval suite           |
| `eva.learn.route`   | **which harness for which task class**, learned from outcomes |
| `eva.learn.tune`    | optional distillation on accepted traces                      |

`eva.learn.route` is the payoff of stages 9c and 11 together. The routing table
stops being a guess and becomes a measurement. It measures at the task
boundary — outcome, cost, and wall clock per Job — and never attributes below
what the harness reports: a harness may route models internally, and an
attribution that pretends to see through it is fiction.

```
eva learn mine --since 30d
  ← clusters of repeated stalls and failures across traces
eva learn propose
  ← playbook + profile changes, each gated by the eval suite before adoption
```

**In:** accumulated traces. **Out:** a system that improves without a model
upgrade.

**Exit test:** the eval suite improves week over week **with the model held
constant**. That result proves you built a system and did not rent one.

## Phase IV — Factory to company

### Stage 13: Intent — the demand side

**Builds on stage 9a's spec format.** The specs now arrive from outside instead of from a person.

**Plugins**

| Plugin           | Adds                                                         |
| ---------------- | ------------------------------------------------------------ |
| `eva.sense`      | signal domain: tickets, error monitoring, usage analytics    |
| `eva.synthesize` | cluster signal into problems, not features                   |
| `eva.plan`       | propose specs with expected value; maintain a roadmap object |

The role of the human changes from author to approver.

```
eva sense sync
  ← tickets, error monitors, usage analytics ingested as signal
eva plan review
  ← agent-proposed specs with expected value; approve, edit, or reject
```

**In:** the outside world. **Out:** a roadmap that writes itself and waits for
signatures.

**Exit test:** across one month, the work items the agent proposes do better than
the items humans author, measured on your own outcome metric.

### Stage 14: Authority and accountability

**Builds on everything.** A mandate is only meaningful when the thing it bounds can already sense, plan, build, land, report, and spend.

**Plugins**

| Plugin         | Adds                                                            |
| -------------- | --------------------------------------------------------------- |
| `eva.treasury` | spend authority tiers, payment rails, invoicing, reconciliation |
| `eva.mandate`  | standing authority: scope, thresholds, expiry, renewal          |
| `eva.halt`     | kill switch, drain, freeze — tested, not theoretical            |
| `eva.support`  | customer-facing: support, status, SLA reporting                 |

A human or a legal entity holds the liability. That entity grants Eva a
**bounded, expiring mandate**. Eva operates freely inside it and escalates at the
boundary. Every action is attributable to a mandate. Corrigibility is a property
of the architecture and not a promise in a prompt.

**Design track — no prior art.** No shipped harness has an expiring mandate.
Managed settings are static configuration, not a bounded grant with an expiry
and a grantor. This stage has no proven design to adopt, only one to invent.
Over-invest, and carry a **falsifier**: if a harness ships a genuine
bounded-expiring-authority grant, adopt its shape. Until then, treat the design
as unexplored rather than merely unbuilt. The same holds for stage 11's
cost-per-merged-change and human-minutes-per-merged-change. No harness closes
the loop to merged output, so those metric definitions are Eva's to get right
and not to borrow.

```
eva mandate grant --scope "deps,tests,docs" --budget 200usd/wk --expires 90d
  ← standing authority, bounded and expiring; everything outside it escalates
eva halt
  ← broadcast drain; clean stop; nothing orphaned — tested, not theoretical
```

**In:** a signed mandate. **Out:** a week of operations with humans only at the
thresholds.

**Exit test:** Eva runs a week of ordinary operations — sensing, planning,
building, landing, reporting, spending — with human input only at the defined
thresholds, and every action traceable to a signed mandate. Then pull the kill
switch and check for a clean stop with no orphaned state.

## Phase V — The surfaces

A surface is a plugin that ships an interface a person or a program drives Eva
through. The stages above build the factory; these build its doors. They add
no extension point, and they change no exit test above — which is what makes
them lanes rather than links in the spine.

Four rules hold for every one of them, and each is an exit test below.

**Every surface is a client, including the first one.** A surface calls the
Session API through a Client and reaches Eva no other way. The terminal has
no privileged path today and never gains one. This is the decision that
cannot be retrofitted cheaply: a surface that reaches past the contract makes
the contract stop being the contract, and every later surface inherits a gap
it cannot close.

**No surface owns client logic.** `packages/client-runtime` holds connection,
auth, reconnect by Cursor, the Run protocol, and the supervisor that survives
a phone's network. A reconnect rule written inside an app is a defect in the
runtime, not a file in the app.

**There is one fold.** `packages/session-view` folds a Transcript into
**Blocks** — words, reasoning, a tool call with its Disposition and permission
outcome, a result, a diff, an image, and `unknown`. Every renderer maps Blocks
to its own primitives and decides nothing else. Two folds would disagree about
what a Run did, and a person comparing two screens would find it.

**A surface may render less than another; it may never know more.** A
renderer that cannot draw a Block draws its `unknown` form and says so — the
same degradation rule the harness seam uses, pointed at renderers.

### The terminal — C0 through C4

`apps/cli`, `plugins/tui`, `plugins/print`, `packages/tui`,
`packages/tui-core`. The terminal is the **reference** surface: every
capability reaches a person here first, because a terminal costs no build step
and no window. If a factory capability lands in the browser first, the
terminal becomes the degraded surface and "every interface is a plugin over
one Session API" stops being load-bearing.

**C0 — the Console. Done.** Stage 0's terminal and stage 1's verbs. Two folds
decide everything it does: one says what the screen shows, the other says what
the loop does next. The Surface performs what they decide and holds neither.

**C1 — the terminal grows a second dimension.** Builds on stage 2. A Run now
does things, and the terminal has to show what it did without becoming a
window manager. The permission prompt is an **Overlay**, not a line, because a
decision that scrolls away is a decision nobody made. Every write is previewed
in the width available with the whole diff reachable. `/mode` rebuilds the tool
domain and records the `mode` payload, so every attached surface agrees about
what the Run may do next.

```
eva > rename UserSvc to UserService across this package
  ← parallel reads, then serial edits; each write previewed, y/n
eva > /mode read-only
  ← the tool domain rebuilds; the status line says so; writes denied
```

**Exit test:** every Disposition renders distinguishably, and a tool call in
flight is visibly different from one that finished. A permission prompt cannot
scroll out of view. `--print` on a tool-using Run writes the answer to stdout
and the activity to stderr, so a pipe is never poisoned.

**C2 — `eva top`.** Builds on stages 9a–9b, and on W3's fold. This is where
the terminal stops showing one Session. Needs-attention leads: blocked with
its reason, then Questions waiting on a person, then running, then done —
derived from the Trace, never self-reported. Triage is one key, with guards:
not in a text field, not over a modal, not on a repeat.

Three distinctions carry the screen. Queued while its worker is reachable is
waiting its turn; queued while its worker is gone means nobody is coming, and
a screen that renders them the same way is a defect. An unreported Cost is an
em dash and never a zero. A working directory never renders raw — not in a
tooltip, not in a label — because screenshots and screen shares leak what a
screen draws.

```
eva top
  ← needs attention (2): EVA-142 blocked · migration needs a decision
                          EVA-151 asked · may I force-push?
    running (5) · queued (11, one stranded: worker offline) · done (17)
    spend: $4.12 of $20.00 today
```

**Exit test:** clear stage 9a's twenty-task backlog and conduct the whole
morning review in the terminal. `eva top` and the web fleet page order the
fleet identically, because they call one fold. Kill a worker and its queued
Runs read as stranded within one heartbeat. A screen that keeps its own
counter is a defect.

**C3 — the terminal reviews and lands.** Builds on C2 and stages 9c–10. The
diff screen is narrower than the page's and shows the same evidence: which
checks ran, what they said, what the race scored, what a browser check kept.
An approval records what was displayed, here exactly as in a browser. `eva
harness list` prints the capability matrix with the date each row was measured
— a table is a thing a terminal is good at.

**Exit test:** approve a change routed to human eyes from the terminal; the
Trace holds the approval, the evidence displayed, and the landing, shaped
identically to a browser approval. A change touching a protected path cannot
be approved from here either.

**C4 — the terminal as a program's surface.** Builds on C1. **Stdout belongs
to the caller**: in any machine mode the answer goes to stdout and everything
else to stderr, as a test rather than a habit. `eva api schema` prints the
Session API and the Event schema as versioned JSON Schema, so a program that
wants to be a surface reads the contract instead of guessing, and a version
skew becomes a negotiation instead of a crash. Eva's rule for foreign
harnesses — drive the SDK or the app-server, never the CLI — points inward
too: `eva.api` and `eva api schema` exist so nobody parses Eva's terminal
output.

**Exit test:** every verb that answers has a machine mode whose stdout is
exactly its answer, asserted per verb. `eva api schema` validates the payloads
a real Run produces. A capability absent from the printed schema is absent
from `eva.api`, checked in CI.

### The web page — W0 through W5

```
packages/session-view/     the Trace → Blocks fold; no renderer, no plugin
plugins/api/               eva.api  — the Session API over a socket
plugins/web/               eva.web  — the surface row; serves the built assets
apps/web/                  the application: React 19, Vite, TanStack Router
```

**The stack, and why.** React 19 because the terminal is already React through
`@opentui/react`, so hooks over `client-runtime` are shared and only the
primitives differ. Vite through `vite-plus`, the repo's toolchain. TanStack
Router for typed routes with no server runtime to deploy. Effect's React atom
bindings, because `client-runtime` is Effect Streams. HTTP for calls and SSE
for `watch`, because `watch` is one-way and SSE's `Last-Event-ID` is the
Cursor with a standard name. Styling is whatever `packages/brand` fixes,
because the terminal palette and the page share one brand or they are two
products. Rejected: a server-rendered framework, because
the page is static assets served by the binary and an SSR runtime would be a
second deployment; a second UI library for the desktop, because the desktop
renders this build.

**One application, both postures.** Single-tenant and multi-tenant are the
same `apps/web` build; posture is config at serve time, never a build variant.
`eva.web` serves assets it did not build, so disabling it removes a row from a
domain and nothing else.

**W0 — the client runtime. Done.** Every non-visual client concern in one
package, with the terminal and the print path as its two consumers — which is
what proved the cut. Six plans landed.

**W1 — the wire and the page that watches.** Builds on W0 and stage 0's Trace.
Ships four things: `packages/session-view` (the fold, moved out of
`packages/tui`, which produces flat `Line { text }` a browser cannot use);
`plugins/api` with the **read half** of the Session API — `list`, `attach`,
`watch`, `model.get` — over HTTP and SSE, plus its `Transport` filler;
`plugins/web` serving the built assets from the artifact; and `apps/web` as a
read-only page.

The write half is W2's, because a page that takes no input cannot use it and a
wire nobody calls is a wire nobody tested. Three fillers, one interface, no
rewrite: W0's local filler proved the shape, W1's HTTP filler proves the shape
was right, stage 2 completes the surface. If the seam does not survive its
second filler, that is the finding, and it is cheaper here than at stage 2.

Reading is progressive — Header, then the committed fold, then the live tail —
and a replay past its bound is answered with a fresh fold. Diffs are
recomputed from the record on the client, so a wrong server projection is
visible instead of authoritative. A local page binds to loopback; a non-local
bind is **refused** until stage 9b issues tokens, rather than served
unauthenticated.

```
eva serve --web
  ← http://127.0.0.1:7777 · the Session you started in the terminal,
    streaming live; refresh costs a repaint, not a replay
eva serve --web --host 0.0.0.0
  ← refused: a non-local bind needs a token, and tokens arrive at 9b
```

**Exit test:** watch a terminal-started Session in the browser, kill the
browser mid-Run, reopen — it converges by Cursor with no gap and no duplicate.
Disable `eva.web` and nothing else degrades. The terminal and the page render
one transcript from **one fold**. The count of Session API calls in `apps/web`
that do not go through `client-runtime` is zero, or W0 was not done.

**W2 — the page that prompts.** Builds on W1 and stage 2. `plugins/api` gains
the write half — `submit`, `cancel`, `answer`, `model.set` — and `plugins/web`
implements the `Frontend`, so `ask` reaches a browser. A whole Session becomes
possible there: prompt, answer a permission request, steer, switch models.

Two surfaces at once is the case to get right. A permission request is one
Question with one Resolution; the first answer resolves it and the second
surface retires its prompt. Sends carry a client-minted id, so a retried send
after a flaky reconnect is one Run. A non-interactive caller declares
`interactive: false` and the gate turns its `ask` into `reject_once` rather
than hanging.

**Exit test:** start a Session in the terminal, answer its permission request
in the browser, finish it in the terminal — the Trace shows one Session and
nothing says two surfaces were involved. Answer the same request from both at
once and exactly one Resolution is recorded.

**W3 — the fleet view.** Builds on W2 and stages 9a–9b, and it is one piece of
work with C2. The front page is an attention queue, not a Session list, over
the fold in `session-view`. It reads one derived collection and each row
selects its own slice, so a fleet where twenty Runs are moving repaints twenty
rows and not the page. Everything C2 refuses to say, this refuses too:
stranded is not queued, absent is not zero, no raw paths. Anything that
declines to admit work names its reason from a closed set — a silent no-op is
never acceptable, and a reason never reveals the existence of something the
reader may not see.

**Exit test:** conduct stage 9a's entire morning review — outcomes, evidence,
blockers, spend — without opening a terminal. `eva top` and the page order the
same fleet identically.

**W4 — review and landing.** Builds on W3 and stages 9c–10, one piece of work
with C3. **Eva reviews inside Eva**: the evidence a reviewer needs is the
Verifier's — check output, the screenshot a browser check kept at stage 5 —
and it lives in Eva's Trace, so linking out to a forge is not available to us
the way it is to an orchestrator that has no verifier. The race scoreboard is
per harness, with each score beside the Cost that produced it, and a harness
that reports no Cost shows Degraded and still races.

**Exit test:** a change routed to human eyes by stage 10's risk score is
reviewed and approved in the browser, and the approval, the evidence actually
displayed, and the landing are all in the Trace. A diff touching a protected
path cannot be approved from this page at all.

**W5 — the page that outlives the machine.** Builds on W1's renderer and stage
6's `eva.trace.publish`. A route, a frozen fold, and the redaction stage 6
already runs. The field ships this first because publishing is its product;
Eva ships it fifth because Eva's reader is the operator of their own factory
and the value is the live Session. The renderer is the same either way, so the
ordering costs nothing.

**Exit test:** publish a Run and open it with no credentials — it renders from
the frozen fold with nothing redaction should have removed. A Block that
renders on the live page and not the published one is a defect.

### The desktop app — D0 through D2

`apps/desktop`, with the Rust shell crate at `apps/desktop/src-tauri`. No
plugin and no package: the shell registers nothing, which is the point. One
rule is its spine: **the shell stays thin.** It
starts Eva single-tenant and renders the same `apps/web` build a browser gets,
adding only what a browser cannot. Every exit test enforces the rule, because
a shell that grows logic becomes a second product and then the browser is the
degraded surface.

**The shell is Tauri, and the reasoning is narrow.** A shell wants Electron
when its main process runs real logic — terminals, SSH, a database, child
agent processes — because those are Node-native and can share the project's
own TypeScript. **Eva's shell runs none of that**: the daemon owns Sessions,
terminals, and harness children, so the shell needs a window, a tray, an OS
notification, a URL scheme, and the ability to start and stop one child
process. That buys three things. A small artifact, instead of shipping a
Chromium and a Node beside the Bun-compiled binary. No second JavaScript
runtime in a release path that already reasons carefully about what one binary
can read at run time. And a shell that **cannot** cheat, because with no Node
APIs and no Eva packages in its main process, "the shell holds no Session
logic" is enforced by the toolchain instead of by review.

The cost, stated: Tauri renders in the platform webview, so `apps/web` must
work in three engines rather than one. That is exactly why shells that hold
logic choose one Chromium. **The falsifier:** if `apps/web` needs a
Chromium-only capability, the shell swaps to Electron — and that swap is cheap
precisely because the shell is thin, which every exit test below protects.

**D0 — the window.** Builds on W2. Launch is the whole feature: double-click
and Eva is running. The shell spawns the `eva` binary as a child on loopback
with a token generated per launch, and points the webview at it — the same
`eva serve --web` a person could run by hand, started by a window instead of a
shell. If a daemon is already running it **joins** instead of starting a
second one, and quitting then leaves it running. The webview loads from the
shell's own scheme and the sidecar accepts that origin alone, so a page in the
user's browser cannot reach it. Local and remote are one connection type with
two values, so the same window can attach to a daemon on another machine —
that falls out of `client-runtime` and costs the shell a text field.

**Exit test:** diff the desktop surface against a browser on loopback — no
feature exists in one and not the other. Delete every file in `apps/desktop`
except the shell and the app still builds. A Session API call inside the shell
is a defect, and so is an Eva package in its dependency list. Kill the shell
mid-Run and the Run continues; reopen and it converges by Cursor.

**D1 — what a browser cannot do.** Builds on D0. The tray with the blocked
count, native notifications, launch at login, `eva://` links, the dock badge —
and nothing else. These consume Broadcasts the kernel already emits and write
nothing the Trace does not already hold: **a tray that keeps its own state is
a defect**, because then two things count what needs attention and they will
disagree. Every notification carries a Cursor, so clicking one opens the exact
moment rather than "the app". One notification per Event, deduplicated by the
Event and not by a timer, and only while the window is unfocused. A permission
request arrives as a question answerable without opening the window, through
the same gate the browser and the terminal use.

**Exit test:** with the window closed, a blocked Run reaches the notification
center with its reason and a permission request arrives as an answerable
question. No notification fires twice for one Event. Clicking any of them
opens the window at the exact Cursor. Every count the tray and dock show is
derived from the Trace.

**D2 — the channel.** Builds on D0. The desktop artifacts come out of the same
workflows that ship the CLI, with the same provenance discipline — one more
channel, never a second pipeline. A windowed app also closes the notarization
gap [reference/ci-cd.md](reference/ci-cd.md) names, because Gatekeeper leaves
no honest way to ship a double-clickable app without it. An update never loses
a running Session: the work lives in the daemon, so relaunching reattaches by
Cursor, and where the shell started the sidecar the swap waits for a step
boundary. Two channels from the start — stable and pre-release — because
retrofitting one is worse. **Version skew is normal, not exceptional**: a
shell and a daemon update independently, especially when the shell joined a
daemon it did not start, so the mismatch is surfaced with the one correct
action and the wire negotiates capabilities rather than rejecting the
connection.

**Exit test:** install from a fresh download on a clean machine with no
warnings. Update in place mid-Run and reattach with nothing lost. Checksums
and provenance verify the way the CLI's do. Run a shell against a
deliberately older daemon: the window names the skew, and every capability the
daemon lacks degrades visibly instead of failing.

### The phone — M0 through M5

`apps/mobile`, one Expo codebase where iOS and Android are platform layers,
over `packages/client-runtime` and `packages/session-view`. Two plugins come
with it: `eva.enroll` for device grants and `eva.notify` for push. The app
renders its own components — a phone is not a narrow browser — but holds no
client logic and no fold of its own.

**The scope is a companion, not a pocket IDE:** notify, read, steer.

**Reachability is a ladder, not a feature**, and this is the correction that
moves the phone most of a year earlier than an earlier draft of the plan had
it. A phone and a laptop on the same wifi need no relay; a tailnet covers most
of the rest; a relay is the third rung. So **M0 through M4 need W1's wire and
nothing from the factory past stage 2**, and the control plane arrives at M5.
A tailnet is not a special case — it is an endpoint that happens to be
reachable, never a transport.

**M0 — the supervisor, and a phone that can reach a laptop.** Builds on W1.
The supervisor is headless and ships before any pixels. Four rules, all
belonging to `client-runtime` and not to an app: subscribe before you read, or
an Event published during the fold lands in the gap; the supervisor is the
only retry owner, or two loops make one thundering reconnect; offline waits
cost no retries, or a phone in a tunnel exhausts its budget before a pipe
exists; a cache never overwrites newer live data. Two more the field learned
on phones: on foreground **probe** the live subscription rather than
reconnecting, and keep a separate path for a real OS suspension — four seconds
backgrounded and an hour asleep are different problems.

A capability is a narrow interface and there are several — connectivity,
wakeups, persistence, token storage — each answered by a platform, so the type
system proves nothing terminal-shaped leaked in.

A **device grant** — `eva.enroll` — is a Credential with scopes: read, steer,
notify, never work admission — with an expiry and revocation. Two carriers, one grant: a QR
for a device in the room, a short device code for one at a distance. The
end-to-end encryption keys exchange here, which is what makes a later relay
carry ciphertext rather than promise to, and it means pairing is authenticated
from the first commit rather than after the first incident. Stage 9b's
three-tier enrollment is this machinery one tier wider.

**Exit test:** the four supervisor rules are each asserted by a test that
fails without them, driven by W0's droppable transport. A device pairs by QR
and reads a Session over a LAN; its scopes refuse a write it is not allowed;
revoking it blinds it within one heartbeat. **Nothing in `apps/mobile` exists
yet** — M0 is provable with no app at all, which is the point.

**M1 — notify.** Builds on M0, and adds `eva.notify`. The smallest surface
with the highest value. **The machine composes the notification** — not the relay and not a vendor —
which follows from a rule Eva already holds: the Trace is local truth and
nothing leaves the machine except on an explicit share. A relay that cannot
read the Trace cannot write a notification about it, so what crosses one is
ciphertext plus a content-free wake. Notifications are **actionable**: Allow
and Deny as buttons under versioned category identifiers, so an app a release
behind still recognizes them. Answering a permission request from a lock
screen is the entire reason the phone exists. Every notification carries a
Cursor and a machine, because a person with two machines paired is the normal
case. APNs and FCM together — parity debt starts accruing on the first
release. One notification per Event, deduplicated across a reconnect that
replays.

```
(overnight) the phone buzzes twice
  ← "EVA-142 blocked · migration needs a decision"   [Allow] [Deny]
  ← "backlog done · 17 of 20, 2 blocked, 1 failed"
```

**Exit test:** run stage 9a's overnight backlog with the lid closed — every
block reaches the phone with its reason, no notification fires twice for one
Event including across a reconnect, a permission request is answered from the
notification without opening the app, and the same run delivers to an iOS and
an Android device.

**M2 — read.** Builds on M1 and W1's fold. W3's attention queue rendered for a
hand. Reading is progressive because a phone is the worst case for it: Header,
then the committed fold, then the tail; transcripts page; diffs load per file;
the replay bound keeps a phone that slept through an hour of Trace from asking
for all of it. **Budget the text-rendering cost deliberately here** — the field
paid it twice, once in five native modules and once in a patch farm around
embedded web views — because discovering it during M3 is how the track stalls.

**Exit test:** conduct one complete morning review on the phone and find
nothing that needed a laptop to understand. A Session with a long Trace opens
in bounded time on a cold start.

**M3 — steer.** Builds on M2 and stage 2's gate. Answer permission requests,
reply to a blocked Run, send a next-Run steer, approve at review thresholds —
scoped by the M0 grant, so a phone never admits new autonomous work and a
refusal is a scope error a person can read. **Every send is idempotent and
there is an outbox**: a tap composed on a train commits locally, sends when
there is a pipe, and is one action in the Trace however many times the radio
retried. Same client-minted id as W2; the phone is where it earns its keep.

**Exit test:** answer a permission request on flaky cellular with three
retried taps — the Run receives exactly one answer, attributed to the device.
Compose a steer offline and it lands once. Try to admit work and get a scope
refusal with a reason, not a silent no-op.

**M4 — the shells.** Builds on M3. iOS and Android builds, store presence,
over-the-air updates behind a pinned native runtime. The work is network
honesty, and skew is designed for rather than discovered.

**Exit test:** airplane mode mid-Run for ten minutes, then reconnect —
convergence by Cursor with no gap, no duplicate, no full replay. Switch wifi
to cellular mid-stream and the Session never notices.

**M5 — the distant daemon.** Builds on M4 and stage 9b. The device tier joins
the fleet's enrollment and the control plane relays between a device and a
daemon behind NAT. **The relay carries ciphertext it cannot read and composes
nothing.** Where a hosted posture must display something about a Run, it shows
a **redacted projection** the daemon published on purpose — truncated titles, a
phase from a closed set, a sanitized link, signed by the machine that sent it.
Never the Trace.

**Exit test:** a phone on cellular streams a Session from a laptop behind NAT.
Read the relay's stored and forwarded traffic — none of it is plaintext, and
nothing in it would let the relay compose a notification.

### The machine and chat surfaces

These are surfaces too, and they are the cheapest ones Eva can have.

| Surface           | What it is                                                    | Arrives |
| ----------------- | ------------------------------------------------------------- | ------- |
| `eva.api`         | the Session API on a socket — a script or CI job is a Surface | W1 · W2 |
| `eva api schema`  | the contract, printable and versioned                         | C4      |
| chat channels     | Slack, Telegram, Discord, email as surface rows               | W1 · W2 |
| `eva serve --acp` | Eva's own loop as an ACP agent, for any client                | 9c      |
| `eva.mcp.server`  | Eva's Verifier, repo map, and memory, for a foreign harness   | 9d      |

**The chat channel is the surface this plan nearly missed.** One surveyed
project's first user interface was Telegram, Discord, Lark, and email — two
months before its web app and four before its desktop. Another takes a task
from Slack and answers with a tested pull request. A chat surface is a row in
the surface domain that reads messages and writes Notes; it needs no store
review, no push infrastructure, and no window. It can report the moment W1's
read half exists and take work when W2's write half does, and it shares a
bridge layer with stage 9a's importer domain — the same connection pointed
inward instead of outward. **It is a phone client the user already installed**,
which makes it the honest fallback if the mobile track slips, and worth
building even when it does not.

## Phase VI — The managed service

S1 through S5 make the control plane a product. One artifact, two postures:
**local** is single-tenant, complete, with no account and no ceremony, and it
is never a demo tier; **hosted** is multi-tenant, the same binary on any
cloud. The rule that keeps both one codebase: **every infra service fills a
Slot Eva already has** — the sandbox service fills stage 4's `Workspace` and
`Sandbox`, the token service fills the provider seam, the integration service
fills stage 9a's importers and 9b's credential store. Locally you fill the
same Slots with your own Docker, your own keys, your own forge app. A plugin
above a Slot cannot tell who filled it, which is the same no-privileged-
position rule Eva's own harness lives under. Tenancy is therefore a posture,
not a fork: single-tenant local is the multi-tenant code with one tenant row.

**S1 — one command, two postures.** Builds on 9a–9b. A compose file and `eva
control up`: fresh cloud machine to accepting workers in one command, and a
laptop default of single-tenant loopback with zero config. Upgrades in place
keep the queue, leases, and admission records. Cloud provisioning lives in a
separate Terraform or Pulumi repository that consumes released artifacts and
never builds from source or reaches into Eva's internals. **Exit test:** fresh
VM to first enrolled worker in under ten minutes; upgrade mid-backlog with no
lost tasks, no duplicate admissions, and no re-enrolment; the two postures
differ by one flag and `eva config show` says which is active and why.

**S2 — tenant-shaped everything.** Builds on S1 and 9b's `eva.tenant`, and
adds `eva.export`. Export is the honesty test of tenancy: one tenant's complete state — Specs, Traces,
evidence, config — as an archive that imports into a local single-tenant
install and resumes there. The exit door leads home. Per-tenant budgets are
enforced at admission, not discovered at invoice. **Exit test:** two tenants on
one control plane, provably isolated in every query, queue, Trace, and budget;
export one, import it on a laptop, resume its work, and the neighbour never
noticed.

**S3 — the infra services.** Builds on S2, stage 4's Slots, and 9b's
credential store, and adds three plugins that fill Slots an earlier stage
declared: `eva.svc.sandbox`, `eva.svc.tokens`, and `eva.svc.integrations`.
Sandboxes as profiles publishing versions that materialize prepared
snapshots, per tenant; a metered gateway at the provider seam, which is stage
11's fallback made a product; brokered integrations whose secrets never enter
a sandbox. Each optional per tenant, each with a named local equivalent.
**Exit test:** run one Workflow three ways — all Slots local, all hosted, and
mixed — and diff the Traces. They are identical except the filler names and
the meter events. A plugin that can tell the difference is a defect.

**S4 — metering to money.** Builds on S3 and stage 11. One invoice per tenant
across the control service and every attached service, every line derivable
from the Trace. **Exit test:** reconcile a month's invoice to the tick; a
retry inflates nothing, a cancelled task bills its spend and no more, a hard
cap halts admission before the overage exists.

**S5 — operate it like you sell it.** Builds on S4, and adds `eva.halt`. Drilled backup and restore
with a measured restore time, a status surface generated from the same Trace,
and stage 14's kill switch scoped to one tenant. **Exit test:** a game day —
recreate the hosted environment from the infra repository alone, restore from
backup inside the written objective, drain and halt one tenant with zero
effect on its neighbours, and the status page told the truth throughout.

**The decision this phase defers.** S1 through S5 are worth building even if
no hosted Eva ever takes a customer — they are what "self-hostable" means said
honestly, and 9b's tenancy and 11's billing require most of it anyway. What
they buy is a free option. On the day stage 11's numbers say the offering
carries its weight, launching is an operational act rather than an engineering
project. That go/no-go is written down with those numbers in it, and until then
the answer is no by default. Whatever launches, the local single-tenant
posture stays complete: "everything works on your laptop" is the trust that
sells the hosted half.

## The five ways this plan fails

Named so they can be watched for, each one observed in the field.

1. **A surface that reaches past the Session API.** The contract stops being
   the contract, and every other surface inherits a gap it cannot close.
2. **Two folds.** A terminal fold and a web fold will disagree about what a
   Run did, and a user comparing two screens will find it first.
3. **A shell that grows logic.** The desktop becomes a second product and the
   browser becomes the degraded surface.
4. **A phone-shaped rule inside the phone app.** Reconnect, backoff, and the
   outbox belong to `client-runtime`, where the browser and the terminal get
   them too.
5. **A relay that can read the Trace.** Once it can, it will be asked to
   compose something, and the privacy claim becomes a policy instead of a
   property.

## The extension points, by stage

Every domain, slot, hook, and broadcast, and the stage that introduces it. A
stage may not add an extension point it does not itself use. A domain's
`<name>.updated` topic is derived from the domain table, so it arrives with the
domain and is listed on the same stage.

| Stage | Domains added                                                         | Slots added                                                | Hooks added                                                                             | Broadcasts added                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | catalog, command, theme, keymap, agent, harness, integration, surface | Recorder, TraceSink, SessionStore, CredentialStore, Budget | `model.resolve`, `provider.request.before`, `provider.response.after`, `provider.retry` | `plugin.added`, `plugin.removed`, `plugin.failed`, `config.changed`, `session.started`, `run.opened`, `run.finished`, `slot.filled`, `slot.emptied`, and `<name>.updated` for each domain |
| 1     | prompt                                                                | Validator                                                  | —                                                                                       | `prompt.updated`                                                                                                                                                                          |
| 2     | tool                                                                  | Sandbox, FileSystem, Shell, DiffApplier                    | `tool.resolve`, `tool.execute.before`, `tool.execute.after`, `session.prompt.before`    | `tool.updated`                                                                                                                                                                            |
| 3     | —                                                                     | RepoMap, Retriever                                         | `session.compact`, `session.prompt.after`                                               | —                                                                                                                                                                                         |
| 4     | workspace                                                             | Workspace, Snapshot                                        | —                                                                                       | `workspace.updated`                                                                                                                                                                       |
| 5     | check                                                                 | Verifier                                                   | `run.retry.before`                                                                      | `check.updated`                                                                                                                                                                           |
| 6     | memory                                                                | Memory                                                     | `trace.commit.before`                                                                   | `memory.updated`                                                                                                                                                                          |
| 6.5   | —                                                                     | —                                                          | —                                                                                       | —                                                                                                                                                                                         |
| 7     | —                                                                     | —                                                          | `harness.prompt.before`, `harness.prompt.after`                                         | —                                                                                                                                                                                         |
| 8     | —                                                                     | —                                                          | —                                                                                       | —                                                                                                                                                                                         |
| 9a    | importer                                                              | TaskStore, Queue, Scheduler                                | —                                                                                       | `importer.updated`                                                                                                                                                                        |
| 9b    | —                                                                     | Identity                                                   | —                                                                                       | —                                                                                                                                                                                         |
| 9c    | —                                                                     | —                                                          | `harness.request`, `harness.resume.rejected`                                            | —                                                                                                                                                                                         |
| 9d    | skill                                                                 | —                                                          | —                                                                                       | `skill.updated`                                                                                                                                                                           |
| 10    | —                                                                     | MergeQueue                                                 | —                                                                                       | —                                                                                                                                                                                         |
| 11    | —                                                                     | —                                                          | —                                                                                       | —                                                                                                                                                                                         |
| 12    | —                                                                     | —                                                          | —                                                                                       | —                                                                                                                                                                                         |
| 13    | signal                                                                | —                                                          | —                                                                                       | `signal.updated`                                                                                                                                                                          |
| 14    | —                                                                     | —                                                          | —                                                                                       | —                                                                                                                                                                                         |

**Phase V has no row in this table, and that is the point.** Every surface
stage — five terminal, six web, three desktop, six mobile, and the machine and
chat doors — registers into the `surface` domain that stage 0 shipped, calls
the `SessionAPI` that stage 0 defined, and implements the `Frontend` contract
that stage 0 declared. Four surfaces, twenty-odd stages, and not one new
extension point. If Phase V had needed one, the claim that every interface is
a plugin would have been false since stage 0.

The same holds for Phase VI: an infra service fills a Slot an earlier stage
already declared, so a hosted `Workspace` and a local one are one Slot with
two fillers.

Stage 6.5 adds nothing to this table for the same reason. It ships trust,
distribution, and isolation for a surface that is already complete. Three
empty regions in one table are the whole argument for going plugin-first.

## References

- Architecture: [reference/architecture.md](reference/architecture.md)
- Writing a plugin: [reference/writing-plugins.md](reference/writing-plugins.md)
- Toolchain and CI: [reference/toolchain.md](reference/toolchain.md)
- Decision records: `docs/adr/` — gitignored, local to a checkout
- Product: [product.md](product.md)
- Plans in flight: [../plans](../plans) — W1 is the next one written
- Field evidence for Phase V — twenty-five harnesses read for what they did
  about interfaces, and in what order — lives in the survey directory beside
  this repository, not in it. This document owns the plan; that one owns the
  receipts.
- The Go tree — removed from this repository and readable in history. `f28a445`
  is the commit that removed it, so `git show f28a445^:docs/adr/<file>` reads any
  of its 62 records.

# The build path

What Eva builds, in what order, and the test each step can fail.
[README.md](README.md) says what Eva is.

This document names the four extension points — **domain**, **slot**, **hook**,
and **broadcast** — on nearly every line. [context.md](context.md) defines them, and
[reference/architecture.md](reference/architecture.md) says how they work. Read
both before this.

Each stage declares four things:

- **What it builds on** — the stage before it, and what changed to make this one
  possible.
- **The plugins it adds** — and which of the four points each one uses.
- **The in/out contract** — what a user can type (`eva >`) and what must come
  back (`←`). If the demo block does not work, the stage is not done, whatever
  the code says.
- **The exit test** — what fails when the stage is not finished.

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

### Stage 1: Workflow — built, the measurement unrun

Every plugin below ships and the gate below passes. What is left is the
measured half: the vendored cassettes hold synthetic streams, so the stage
exits on the first recording against the pinned model at or above the line —
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

**Exit test, the gate:** `verdictFold` and `validityOf` over the vendored
traces equal the committed golden; every vendored cassette replays through the
real fixture — the Workflow harness, the Validator, the Repair — and folds to
that same golden, so trace, cassette and golden stay three projections of one
recording; a scripted Provider that answers invalid then valid produces exactly
one `verdict` per Candidate numbered 1 then 2; the same run with the Validator
slot empty reports `unchecked` and no rate at all; the verdict the measurement
exits on is one value a test asserts, thresholds and refusal share together;
and the demo block runs. All six run in `verify`.

**Exit test, the measurement:** five canned Workflows over 100 Runs each give
≥95% first-pass validity aggregated over the 500 Candidates, with a repair
yield of ≥90%. A Run that produced no Candidate is counted rather than dropped,
and past 2% of the Runs no rate is reported at all — a thinned denominator
would flatter the figure the stage exits on. A maintainer runs it against one
named model and reads the ratios; no workflow runs it, because a full run costs
about $12 to $20. Aggregate rather than five thresholds: at a true 97% rate,
five independent per-Workflow thresholds fail about 31% of runs.

### Stage 2: Tools and the loop

**Builds on stage 1:** schema validation and the repair loop. The tool domain arrives, and `eva.harness.loop` becomes the harness domain's second entry — the first one with agency.

**Plugins**

| Plugin             | Adds                                                       |
| ------------------ | ---------------------------------------------------------- |
| `eva.tool.read`    | tool domain                                                |
| `eva.tool.edit`    | tool domain; emits `edit` payloads                         |
| `eva.tool.grep`    | tool domain                                                |
| `eva.tool.glob`    | tool domain                                                |
| `eva.tool.bash`    | tool domain; reads slot `Sandbox`                          |
| `eva.tool.web`     | tool domain                                                |
| `eva.tool.policy`  | hook `tool.execute.before`: the deterministic gate         |
| `eva.fs`           | slot `FileSystem`: reads and writes under a root           |
| `eva.shell`        | slot `Shell`: starts a process, streams its output         |
| `eva.sandbox.none` | slot `Sandbox`: the seam exists, with no containment yet   |
| `eva.harness.loop` | harness domain: Eva's own propose → act → observe loop     |
| `eva.sched`        | hook `tool.execute.before`: parallel-safety classification |
| `eva.steer`        | hook `session.prompt.before`: mid-Run user input           |
| `eva.approval`     | agent domain + hook: named permission modes                |
| `eva.diff`         | slot `DiffApplier`: dry-run preview, atomic apply          |
| `eva.api`          | surface: the session API over HTTP and stdio               |

**The scheduler.** The runtime classifies parallel safety through an optional
`parallelSafe(input)` capability on a tool definition — never the model.
Unclassified tools fail closed to serial. Serial calls are barriers. Concurrency
is bounded. Results commit in source order so the transcript stays
deterministic. One failure does not cancel its siblings.

**A second surface, reached over a socket, this early on purpose.** `eva.api`
re-exposes the Session API over HTTP and stdio. Until now Eva has exactly one
interface reached exactly one way, so two claims are untested: that every
interface is a plugin, and that Eva is remote-ready.

Both are settled here or not at all. `eva.api` is not a second way of reaching
Eva — it is a second row in the `surface` domain, calling the same `SessionAPI`
methods `eva.tui` calls in-process, which is the proof that the contract holds
at a distance. **If local stays a special case past this stage, half the system
goes untested until the day it matters most** — and every surface built in
between has to be retrofitted.

It also makes two later things nearly free. Stage 9c's `eva serve --acp` is a
new transport over a contract that already exists. And the managed service at
9b needs no new interface — a worker behind NAT drives the same API a terminal
does.

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
waits here rather than shipping against zero deciders
([plans/kernel-contracts.md](../plans/kernel-contracts.md) holds the review
that found it).

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

| Plugin                   | Adds                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `eva.workspace`          | slot `Workspace`: local dir, worktree, container, remote VM       |
| `eva.workspace.worktree` | workspace driver: git worktree per unit                           |
| `eva.sandbox.local`      | slot `Sandbox`: replaces `eva.sandbox.none` with real containment |
| `eva.snapshot`           | slot `Snapshot`: cheap checkpoint and restore                     |
| `eva.net`                | hook `tool.execute.before`: egress allowlist per profile          |
| `eva.secrets`            | injection at the env boundary, never into context                 |

**Fork at the environment layer.** `Workspace.create(info, env, from?)` — the
`from` parameter forks a workspace from another. Best-of-N harness racing needs
N workspaces from **one snapshot**, not N sessions sharing one workspace, so
this primitive belongs here and not at stage 7. `Workspace.target()` returns
`{ localDir }` or `{ remoteUrl }` uniformly: one code path, expressed as a type.

Orca ships this as its headline feature — Codex, Claude Code, OpenCode, and Pi
side by side, each in its own worktree, results compared and the winner merged.
That is stage 4's fork primitive plus stage 9c's race, and it is the reason the
two must not be collapsed.

**Declarative isolation.** `isolation: worktree` on a profile or spec runs the
unit in its own git worktree, auto-cleaned when it made no changes, with git
redirects back into the main checkout blocked.

**This stage completes ACP's client half, and it is where containment actually
comes from.** `FileSystem` becomes `readTextFile` and `writeTextFile`; `Shell`
and `Sandbox` become `createTerminal` and its lifecycle — output, wait-for-exit,
kill, release. Build them in that shape and Eva's own loop starts using the
exact path a foreign harness may use at stage 9c.

Be precise about what that buys. A harness that calls the client half gets its
edits recorded; a harness that uses its own file tools does not, and **the
protocol cannot make it**. OpenCode's ACP agent calls `requestPermission`, and
from the filesystem half only one display-only `writeTextFile` that renders a
diff — no reads, no terminals — verified in its source, against v1 (SDK 0.21.0).
So the guarantee that a foreign harness cannot escape does **not** come from ACP.
It comes from `Workspace` and `Sandbox`: a process confined to a worktree is
confined whether or not it ever asks Eva for a file handle. Multica and Orca
both reach for the worktree for exactly this reason.

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
byte-identical tree.

### Stage 5: Verifier — the highest-use stage

**Builds on stage 4:** a disposable workspace to be wrong in. The check domain turns a claim into evidence, and it is a domain so that a third party can add a check without an API for it.

Every stage after this one adds throughput. This stage adds quality.

**Plugins**

| Plugin            | Adds                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `eva.verify`      | **check domain** + slot `Verifier`                                 |
| `eva.check.build` | check domain: build, typecheck, lint, unit, integration            |
| `eva.check.lsp`   | check domain: LSP diagnostics — the cheapest oracle for typed code |
| `eva.remediate`   | hook `run.retry.before`: runs `Spec.remediation` before retry      |

**The check domain is why stage 6.5 shrank.** A community check is a plugin that
writes to the check domain. There is no `RegisterCheck` API to design, because
the domain already is that API. A check may be a soft model verifier — it is
marked degraded and it never merges.

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

| Plugin                  | Adds                                                     |
| ----------------------- | -------------------------------------------------------- |
| `eva.trace.replay`      | command domain: `eva trace show`, the cost fold per step |
| `eva.trace.redact`      | hook `trace.commit.before`: sink-side redaction          |
| `eva.memory.project`    | slot `Memory`: learned facts, conventions, gotchas       |
| `eva.memory.procedural` | memory domain: reusable playbooks                        |

The sink shipped at stage 0. This stage adds replay, the cost/latency/token fold
per step, and redaction. It invents neither a schema nor a sink. It **makes the
existing schema a versioned public contract**, because adapters and third-party
plugins emit into it. That is the point where `schemaVersion` stops being ours
to change freely. Redaction lands here rather than at stage 0 because there is
nothing to redact before stage 2 brings tools and stage 4 brings secrets.

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
third-party plugin should not be able to. DeepSeek Harness ships **dual-half
packages**: a host half that owns a sandbox lifecycle and an invoke-handler
table, and a client half that runs on the far side — in its case an in-process
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
a shared prefix and divergent suffixes.

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

```
eva control up  &&  eva enroll create --tier semi --ttl 10m
  ← one pasteable token
(any machine, behind NAT)  eva daemon --join https://cp.example.com --token …
  ← worker online in the fleet view; revocable within one heartbeat
eva top
  ← live leases, workers, spend — the projection, in a terminal
```

**In:** a token. **Out:** a fleet.

**Exit test:** a laptop behind NAT and a VPC runner both enroll with one pasted
token. Both take work. You can revoke both within one heartbeat. Two tenants'
tasks never share a VM.

### Stage 9c: Harness adapters — the multi-harness stage

**Builds on stages 0, 2, 4, and 7 together.** The contract, the permission gate, the client half, and Eva's own implementation of the agent half all already exist. This stage adds implementations, not interfaces.

This is where Eva stops being a harness and starts being a factory. **Your
Claude Code, Codex, and OpenCode subscriptions become workers in the same fleet,
under the same spec, the same verifier, the same trace, and the same bill.**

**Plugins**

| Plugin                 | Adds                                                     |
| ---------------------- | -------------------------------------------------------- |
| `eva.harness.acp`      | harness domain: **the ACP runtime, for any ACP agent**   |
| `eva.harness.claude`   | thin extension: launch, auth, capability probe           |
| `eva.harness.codex`    | thin extension over the Codex App Server                 |
| `eva.harness.deepseek` | thin extension: launch and auth over its ACP server      |
| `eva.harness.conform`  | check domain: the adapter conformance suite, run nightly |
| `eva.serve.acp`        | surface: `eva serve --acp` — Eva **as** an ACP agent     |
| `eva.race`             | command domain: run one spec on N harnesses, score each  |

**An adapter may be a host plugin too.** OpenCode and DeepSeek Harness have
plugin ecosystems of their own. An adapter for one of them may expose those as
host-scoped extension points, so a DeepSeek Harness plugin keeps working under
Eva. Eva does not flatten another system's extensibility into one opaque row —
that is the same rule stage 7 applied to Eva's own loop, pointed outward.

#### There is no new contract in this stage

This is the payoff of adopting ACP at stage 0. The harness contract is already
written, already implemented by `eva.harness.loop`, and already exercised by
Eva against itself.
Stage 9c adds no interface. It adds **implementations of an interface that
exists**, and the operational reality of driving somebody else's process.

**None of the fleet needs a bespoke adapter.** OpenCode ships `opencode acp`
today, implementing the agent half natively against `@agentclientprotocol/sdk`
(pinned 0.21.0, checked 2026-08-14). Claude and Codex each have an ACP bridge
maintained under the protocol's own organisation — one built on the Claude Agent
SDK, one on the Codex App Server. Gemini CLI, Copilot, Cursor and Pi all present
as ACP agents too. And DeepSeek Harness ships `@deepseek-ai/dsh-acp` — an
automation-only ACP server over stdio JSON-RPC, pinned to SDK 0.25.1 — so by our
own rule — a bespoke adapter dies when its vendor ships ACP — every one of these
is `eva.harness.acp` plus a launcher entry, and the bespoke-adapter count is
zero.

**Drive the SDK or the app-server, never the CLI.** A CLI's stdout is a product
surface that changes without notice; an SDK and an app-server are contracts. The
maintained bridges target the latter for exactly this reason, and where Eva
writes its own path it does the same.

**Build `eva.harness.acp` first**, not Claude. It is the cheapest possible
second harness — the protocol is already in `packages/acp/` from stage 0 — and
it proves the contract really is the protocol rather than an Eva-flavoured
variant of it. Build the Claude bridge second, because it has the richest event
stream and will find whatever the protocol does not cover.

**One ACP runtime, plus thin per-vendor extensions.** Not one adapter that
covers everything — that is the optimistic version and the field disproves it.
T3 Code runs a first-class ACP runtime and still carries vendor extensions for
Cursor and xAI — Grok rides the xAI one — with env-gated CLI probes beside
them. Budget for the same:
a shared runtime that does the protocol, and small per-vendor modules for launch
arguments, auth quirks, and capability probing. The extension is where a vendor
differs; it is never a second contract.

**A bespoke adapter's job is to present as ACP.** It translates a CLI's output
into ACP session updates and answers ACP client calls. It does not define its
own shape. When that CLI ships native ACP support, the bespoke adapter is
deleted and `eva.harness.acp` takes over with no change above it.

#### Eva as an agent, not only as a client

`eva serve --acp` exposes `eva.harness.loop` over stdio JSON-RPC as an ACP
agent. Zed, Orca, Mux, and T3 Code can then drive Eva the same way they drive
any other agent.

This costs almost nothing — the agent half is already implemented from stage 7,
and this plugin is a transport — and it changes what Eva is. Adopting the
protocol makes Eva **adoptable**, not only adopting. Ship it in this stage while
the protocol work is loaded, not as a later idea.

#### Capability negotiation, and the honesty rule

No two harnesses support the same things. Multica supports 21 backends and its
adapter fields carry the scars: reasoning effort is honored by exactly six of
them and silently ignored by the rest; extra CLI arguments are honored only by
backends that opt in; some backends need the system prompt inline while others
read it from `CLAUDE.md`, `AGENTS.md`, or `QWEN.md` on disk.

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

The silent case is the common one, and negotiated capabilities are what turn
silence into a recorded fact.

#### Resume is the hard part

Multica's field notes are unambiguous: resume is where multi-harness breaks.

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
eva task run EVA-142 --harness claude
eva task run EVA-142 --race eva,claude,codex
  ← same spec, same verifier, one workspace forked three ways;
    scored results per harness — the routing table starts accumulating
eva harness list
  ← installed harnesses, detected versions, negotiated capabilities
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
4. Resume a Claude Code session, have the resume rejected, and watch Eva fall
   back to a fresh session with a continuity notice and no duplicated side
   effects.
5. `eva serve --acp` drives Eva's own loop from a second Eva instance running
   `eva.harness.acp`. Eva on both ends of the protocol is the cheapest proof
   that the contract is symmetric and complete.

The conformance suite runs nightly against upstream and fails when a CLI changes
its output format.

Point 2 is the one that justifies the whole stage. Without it, `--race` is three
harnesses under three different sets of rules, and the scores mean nothing. Note
that its two halves are earned in different places: the permission gate comes
from the protocol, and the boundary comes from stage 4. Neither alone is enough.

### Stage 9d: Skills and MCP

**Builds on stage 9c:** foreign harnesses under one contract. They now use Eva's verifier, repo map, and memory, which is the inversion that makes stage 9c pay.

**Plugins**

| Plugin           | Adds                                                       |
| ---------------- | ---------------------------------------------------------- |
| `eva.skill`      | skill domain: source format, compiler, per-harness targets |
| `eva.mcp.client` | tool domain: MCP servers become tools                      |
| `eva.mcp.server` | surface: verifier, repo map, memory, task graph over MCP   |

One skill source compiles to each harness's native format: a Claude Code skill,
a `SKILL.md`, or plain instructions for a harness with no skill concept. The
compiler targets are a domain, so a new harness adds a target without touching
the compiler.

`eva.mcp.server` is what lets a foreign harness use **Eva's** verifier, repo
map, and memory. That is the inversion that makes stage 9c pay: the foreign
harness does the work, and Eva supplies the ground truth.

```
eva skill install migrate-db
  ← compiled per harness: native, SKILL.md, or plain instructions
eva task run MIG-7 --harness codex
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
| `eva.integrate`    | branch-per-task, PR with spec and trace link                  |
| `eva.mergeq`       | slot `MergeQueue`: serialized landing, rebase-and-reverify    |
| `eva.conflict`     | detect overlapping edits **at schedule time**, not merge time |
| `eva.review.auto`  | harness domain: second-pass review against the spec           |
| `eva.review.route` | risk score decides: auto-merge, agent review, or human eyes   |

**Never auto-merge changes to CI config, to auth code, or to dependency
manifests.** This holds whatever the test status is.

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

| Plugin           | Adds                                                            |
| ---------------- | --------------------------------------------------------------- |
| `eva.meter`      | cost per task, per merged change, **per harness**; attribution  |
| `eva.policy.org` | org rules as code: prod access, spend caps, escalation          |
| `eva.report`     | throughput, pass rate, human-touch rate, $/merged change, trend |
| `eva.projector`  | read models; TUI first, then web                                |
| `eva.web`        | surface: the web interface, served from the binary              |
| `eva.billing`    | usage events, invoicing, plan limits, hard caps                 |

**Every metric computes over one declared cohort** — tasks admitted in-window,
post-filter. A retry never creates a new job, so it cannot inflate throughput.
Success rate excludes cancellations from the denominator.

Per-harness attribution is what makes stage 12's routing possible: you cannot
learn which harness to use for which task class if you cannot price them apart.

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
stops being a guess and becomes a measurement.

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

Stage 6.5 adds nothing to this table on purpose. It ships trust, distribution,
and isolation for a surface that is already complete. That row being empty is
the whole argument for going plugin-first.

## What we borrowed for multi-harness

| Idea                                                                                   | Source           |
| -------------------------------------------------------------------------------------- | ---------------- |
| **The harness contract is ACP, not one we invent**                                     | ACP              |
| The agent asks the client for filesystem, terminal, and permission                     | ACP              |
| Bilateral capability negotiation as optional booleans                                  | ACP              |
| `_meta` and `ext` carry our own concepts without forking the schema                    | ACP              |
| Four permission options, splitting decision from persistence                           | ACP              |
| A production ACP implementation in Effect to read                                      | T3 Code          |
| ACP as a first-class runtime with thin per-vendor extensions                           | T3 Code          |
| Adapter as a record with many live instances, not a service key                        | T3 Code          |
| Session-oriented adapter contract, not a one-shot answer                               | T3 Code          |
| The agent as a live handle with an inbox, not a function                               | DeepSeek Harness |
| `send(message, next-turn \| next-step)` steering — Eva renames the first to `next-run` | DeepSeek Harness |
| `whenIdle` and `runMaintenance` for non-Run work                                       | DeepSeek Harness |
| Resume rejection, and rejection that is undetectable                                   | Multica          |
| Plural, semantic timeouts                                                              | Multica          |
| Provider-reported cost in integer units                                                | Multica          |
| Usage keyed by model, because a Run spans models                                       | Multica          |
| Per-field capability degradation, never failure                                        | Multica          |
| Worktree per agent; fan one prompt across N; merge the winner                          | Orca             |
| Agents as teammates on a board, reporting and blocking                                 | Multica          |
| "Works with your subscriptions" as the product claim                                   | T3 Code          |

## References

- Architecture: [reference/architecture.md](reference/architecture.md)
- Writing a plugin: [reference/writing-plugins.md](reference/writing-plugins.md)
- Toolchain and CI: [reference/toolchain.md](reference/toolchain.md)
- Decisions: [decisions.md](decisions.md)
- Product: [product.md](product.md)
- The Go tree — removed from this repository and readable in history. `f28a445`
  is the commit that removed it, so `git show f28a445^:docs/adr/<file>` reads any
  of its 62 records.

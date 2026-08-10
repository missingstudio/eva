# The build path

> **Status: draft.** This describes what Eva will be, not what it is.
> Only stage 0 is built. Where this and an ADR in [`adr/`](adr/) disagree,
> the ADR wins. Verification basis: the tip of `main` on 2026-08-09.

Nineteen stages. Each ships a working CLI, adds one primitive, and has an exit
test it can fail. You may not start stage N+1 until stage N's exit test passes.

There are nineteen stages. Each stage ships a working CLI, adds one primitive, and has an exit test that you can fail. **You may not start stage N+1 until the exit test of stage N passes.** A skipped stage costs five times as much to add later.

Each stage also declares its **in/out contract**. The contract shows what a user can type at that stage (the `eva >` lines) and what must come back (the `←` lines). If the demo block does not work, the stage is not done, whatever the code says.

## Phase I — Model to agent

### Stage 0: Wire

A model client with a good terminal.

```
go.mod        the module, plus the Makefile and .golangci.yml that gate it.
              `make check` = fmt, build, vet, lint, test across every package.
              Ships FIRST, as the prefactor: every later ticket then lands
              against checks that already run. See docs/adr/0021.

events/       LAYER. THE event schema: typed, versioned, sequence-numbered
              (invariant 8). SETTLED — see docs/adr/0001-0008. Sealed payload
              interface, closed kind set, Unknown preserved, envelope carries
              the fold keys. Standard library only.
core/         LAYER. Unit, Spec, Outcome, and the interfaces the outer layers
              implement — including the TraceSink INTERFACE. Also session/:
              the durable transcript, and the thing resume, branch, and rewind
              later act on (see CONTEXT.md). Pure: no
              filesystem, no network, no terminal. Imports events only.
trace/        LAYER, beside core rather than inside it, because the sink writes
              files and core is pure. The JSONL IMPLEMENTATION of core's
              TraceSink. Ships HERE, not at stage 6, because invariant 1 admits
              no quick paths and because the sink is what OWNS Seq: it assigns
              trace position at commit and appends an assistant message with all
              of its tool results as one atomic write. Stage 6 adds replay, the
              public-contract version freeze, and sink-side redaction — it does
              not add the sink.
providers/    LAYER. Provider interface + anthropic impl, streaming, retry w/
              backoff, token accounting — usage arrives split across
              message_start (input) and message_delta (output), so a Usage event
              accumulates before it emits (openai-compatible impl at stage 1 —
              local models, cheap eval runs; it is also the only provider that
              reports reasoning tokens, which is why the field is nullable)
config/       LAYER, beside core because it reads files. ~/.eva/config.toml,
              profiles, key resolution, model selection. TOML, decoded strictly
              (docs/adr/0009).
render/       LAYER. Records in, strings out: streaming markdown, syntax
              highlight, the cost line. It imports events only, and it can reach
              no Provider, Session, or Trace.
cli/          LAYER, the frontend and the top of the graph. The console, slash
              command dispatch, and the wiring. A pure consumer of events/; the
              core never renders. Nothing imports cli.
```

```
eva > explain what this project does
  ← streamed markdown answer; cost line: 1.2k in / 340 out · cost unreported
eva > /model  /cost  /clear  /help
  ← switch model mid-session; the session's spend on demand
```

**In:** typed prompts, config, and an API key. **Out:** answers on screen and typed events in the Trace. There is no file access and there are no tools yet.

Define the `Unit` interface, the event schema, and the trace invariant here, before the model client. Include `Tenant` and `Actor` on `Spec` — and on the `Event` envelope, for the same reason. If you add tenancy later, you touch every table, query, cache key, object path, and trace record.

**Primitive:** context assembly and budget accounting.
**Exit test:** a multi-turn conversation keeps the correct history, streams the output, and shows the per-turn cost and the cumulative cost. Ctrl-C cancels in mid-stream and does not corrupt the session. The base system prompt has a byte budget, and CI enforces it as a gate (owainlewis/neo's bar is ≤ 2 KiB). So context spend is a reviewed, versioned artifact from the first commit.

**One clause of this exit test was withdrawn**, so it did not pass as written. The clause asked for `eva -p --json`, emitting the identical turn as typed events with no TTY rendering. Half of it stands: `eva -p <prompt>` answers one turn onto stdout, and exits non-zero when the turn failed. The machine-readable half is the Trace instead, and ADR 0011 holds the reasoning.

One assertion went with it: colour downsampling per terminal. It was read off stdout, and it cannot be read off a screen redrawn in place. The render boundary is unchanged, and the linter still enforces it. The process-level tests still drive a real process, type keys into the console, and assert on the Trace.

Five assertions come from the settled schema. Each one fails loudly if the sink is wrong. Stage 0 has no tools, so two of them are driven by constructed events rather than by a real turn:

- A `Usage` event on a cached turn reports cache **write** and cache **read** as separate non-zero figures. On an Anthropic turn, `ReasoningTokens` is **absent** rather than `0`.
- A synthetic unknown event kind survives a round-trip through the JSONL sink with its bytes intact, and the run carries `Degraded`. Eva's own loop cannot emit an unknown kind; that arrives from a foreign harness at stage 9c. So a constructed event drives this one.
- `kill -9` in mid-stream leaves the trace file parseable, holding no partial event and no partial turn group.
- The sink, handed a constructed turn group that contains tool results, appends it as one unit. The rule that no `tool_use` is ever persisted without its `tool_result` is tested before stage 2 builds anything that depends on it.
- Trace `Seq` is dense and gapless per Session, after a run that streamed thousands of text chunks. This proves the sink assigned it and coalesced, rather than passing `WireSeq` through.

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

Modes are **capability selection** plus mandate gates. Capability selection decides which tool registry the agent gets. **The gate that decides allow/deny is deterministic and testable in CI — never a model classifier.** This is owainlewis/neo's lesson, refined by shipped practice. A command classifier looks reassuring, but it does not contain: a user can wrap, alias, and substitute shell commands. A classifier also cannot be a CI gate. Stage 8 already forbids non-deterministic merge gates, and the same logic binds permissions. A classifier may sit **above** the deterministic gate as an advisory layer — a `model` hook (Part 2), or the `permission` hook. One hard rule binds it: **it may narrow, never widen, and it never substitutes for the sandbox.** Containment belongs to `env/` (stage 4). The app layer selects the capabilities and enforces the mandates.

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
**Exit test:** the agent completes a three-file refactor from start to end. You can preview and undo every write. Policy refuses `rm -rf /`; luck does not. A write to `.mcp.json` is refused even when an allow rule in a repo-checked-in profile would allow it — the protected-path check runs first. `echo x > $VAR` is treated as one opaque invocation and fails closed. `eva policy check` rejects a malformed rule set in CI. A change of a live session from autonomous to read-only takes effect before the next tool call. Two parallel-safe reads overlap, and you can show it. A write between them is a barrier. The results land in source order.
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
**Exit test:** the agent completes a task in a 500k-LOC repo. It survives three compactions. It does not lose the goal, the constraints, or the record of what it already tried. A stated boundary ("do not push") held in `Spec.Constraints` is still enforced after all three compactions. The survives-compaction contract is a table you can assert against, not a hope.

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

### Stage 5: Verifier — the highest-use stage

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

**Build the verifier as a standalone contract that you can run externally. Do not build it as a function inside the loop.** This is what later lets Eva check the work of a foreign harness. If you build it inline, you rewrite stages 5–8 when the adapters arrive.

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
  ← the full Trace, replayable: every step with cost, latency, tokens
eva > (a task similar to last week's)
  ← measurably cheaper: project memory recalls conventions, gotchas, and
    where things live, instead of re-discovering them
```

**In:** past runs. **Out:** replay, and a second run that costs less than the first.

The trace is the persisted event stream from stage 0, written by the sink that stage 0 already built. This stage invents neither a schema nor a sink. It **makes the existing schema a versioned public contract**, because adapters and extensions will emit into it. That is the point at which `SchemaVersion` stops being ours to change freely (ADR 0006). Redaction occurs at the sink, inline. There is nothing to redact before stage 2 brings tools and stage 4 brings secrets. That is why redaction lands here rather than at stage 0.

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
**Freeze rule:** freeze the hook API only after stage 8 uses it. The eval harness must itself consume hooks (`outcome`, `after_provider_response`). This proves that the surface is enough.

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
  compare/      A/B two prompt, profile, or harness versions; diff Traces
  gate/         CI check blocking merges that regress the suite; deterministic
                size budgets (prompt bytes, binary size) are the only
                performance regression gates — timings are informational,
                never CI gates, so the suite stays trustworthy instead of flaky
```

```
eva eval run --suite core-20
  ← pass@1, cost, turns, human-touch per task; trend against baseline
eva eval compare profiles/fixer-v1 profiles/fixer-v2
  ← A/B verdict with Trace diffs
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

Build the Claude Code adapter first. It has the richest event stream. So it exercises the most of your normalization layer.

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

**In:** one skill source. **Out:** the same behaviour under every registered harness.

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

Be honest about external side effects. You cannot promise exactly-once for the writes that the agent performs: comments, pushed branches, and opened PRs. A retry after the agent started needs an explicit **warned retry**. Every run carries stable `EVA_RUN_ID` and `EVA_JOB_ID` identifiers. So agents make branch names and markers safe for a retry.

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
  tune/         optional distillation or fine-tuning on accepted Traces
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

**Exit test:** across one month, the work items the agent proposes do better than the items humans author. Measure on your own outcome metric.

### Stage 14: Authority and accountability

```
treasury/     spend authority tiers, payment rails, invoicing, reconciliation
mandate/      standing authority: what Eva may do unsupervised, thresholds for
              human signature, expiry and renewal of each grant
halt/         kill switch, drain, freeze — tested, not theoretical
surface/      customer-facing: support, status, SLA reporting
```

A human or a legal entity holds the liability. That entity grants Eva a **bounded, expiring mandate**. Eva operates freely inside the mandate. Eva escalates at the boundary. Every action is attributable to a mandate. Corrigibility is a property of the architecture. It is not a promise in a prompt.

**Design track — no prior art.** No shipped harness has an expiring mandate; managed settings are static configuration, not a bounded grant with an expiry and a grantor. That means this stage has no proven design to adopt, only one to invent. Over-invest, and carry a **falsifier**. If a harness ships a genuine bounded-expiring-authority grant, adopt its shape. Until then, treat the design as unexplored, not merely unbuilt. The same holds for stage 11's cost-per-merged-change and human-minutes-per-merged-change. No harness closes the loop to merged output, so those metric definitions are Eva's to get right, not to borrow.

```
eva mandate grant --scope "deps,tests,docs" --budget 200usd/wk --expires 90d
  ← standing authority, bounded and expiring; everything outside it escalates
eva halt
  ← broadcast drain; clean stop; nothing orphaned — tested, not theoretical
```

**In:** a signed mandate. **Out:** a week of operations with humans only at the thresholds.

**Exit test:** Eva runs a week of ordinary operations: sensing, planning, building, landing, reporting, and spending. Human input occurs only at the defined thresholds. Every action is traceable to a signed mandate. Then pull the kill switch and check for a clean stop with no orphaned state.

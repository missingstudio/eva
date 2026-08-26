# The plan

The build order, what is next inside it, and where the code goes.

[roadmap.md](roadmap.md) owns what each stage **is** — what it builds on, the
plugins it adds, the demo block it has to satisfy, and the exit test it can
fail. This document owns the other three questions: **what is next, what can
run beside it, and which directory the work goes in.** One is why; the other
is what and where.

The split matters because they change at different rates. A stage's exit test
is settled the day the stage is designed. Its position in the order moves
every time a lane finishes early or a prerequisite turns out to be softer than
it looked — and when it moves, exactly one document changes. Where the work
stands — started, done, what is left — is a third question with a third owner:
the execution log in [development.md](development.md), the only table in
`docs/` that says done.

Two id spaces run through both. A **number** is a factory stage. A **letter**
is a surface or service stage: `C` terminal, `W` web, `D` desktop, `M` mobile,
`S` managed service.

## The whole order, in waves

This is the **only** build order. Every unit of work appears once, with what
it waits for; each stage's own "builds on" line in
[roadmap.md](roadmap.md) is the source, and this table is the fold over all
of them. A wave is what can be in flight together
— everything in one wave shares no prerequisite with anything else in it.
The table is structure, never state: no row here changes when a stage lands,
because where the work stands is the execution log's to say.

| Wave | In flight together     | Each waits for                          |
| ---- | ---------------------- | --------------------------------------- |
| 0    | 0 · 1 · C0 · W0        | —                                       |
| 1    | **2** · **W1**         | 1 · W0                                  |
| 2    | M0 · chat surfaces     | W1                                      |
| 3    | 3 · 4 · C1 · W2 · M1   | 2 · 2 · 2 · W1+2 · M0                   |
| 4    | 5 · 7 · D0 · M2 · C4   | 4 · 2+4 · W2 · M1+W1 · C1               |
| 5    | 6 · 6.5 · D1 · D2 · M3 | 0's sink · 0's surface · D0 · D0 · M2+2 |
| 6    | 8 · 9a · 9c · W5 · M4  | 5+7 · 7 · 0+2+4+7 · W1+6 · M3           |
| 7    | 9b · 13 · 9d           | 9a · 9a · 9c                            |
| 8    | 10 · W3+C2 · S1 · M5   | 9a–9c · W2+9a–9b · 9a–9b · M4+9b        |
| 9    | 11 · S2 · S3           | 6+9c · S1 · S2                          |
| 10   | 12 · W4+C3 · S4        | 8+11 · W3/C2+9c–10 · S3+11              |
| 11   | S5                     | S4                                      |
| 12   | 14                     | everything                              |

Read three things out of it.

**The spine is 1 → 2 → 4 → 7, then 9a and 9c in parallel, rejoined at 10 and
11, closed by 12 and 14.** Everything else is a lane someone can take without
blocking it.

**W1 is the cheapest stage with the widest consequence.** It is in wave 1
with no prerequisite past wave 0, and three later lanes — the
phone, the desktop, the chat channels — exist only behind it. Nothing else off
the spine unblocks three tracks.

**Stage 9b unlocks three tracks at once** — the fleet view, the tenant's home,
and the phone's last rung — which is why waves 8 and 9 are the widest in the
plan and the right place to have more than one pair of hands.

One rule keeps the table honest: **`W3` and `C2` are one piece of work, and
so are `W4` and `C3`.** They are two renderers over one fold. Building them
months apart means the fold gets written for whichever came first, and then
the second renderer either bends to it or grows a fold of its own.

## What to build next

A rule rather than a list, so it cannot go stale. **A stage is unblocked when
everything it waits for has a done row in the execution log in
[development.md](development.md).** The wave table above holds what each
stage waits for; the log holds what is done; the join is the answer — and
nothing in this document takes an edit when a stage lands, because the log
takes it alone.

Two standing rules order the unblocked set:

- **The spine outranks the lanes.** An unblocked spine stage blocks more than
  anything beside it, so one pair of hands builds the earliest unblocked
  spine stage first.
- **A lane earns a second pair of hands when it unblocks other lanes.** The
  wave table shows the fan-out: a stage many later rows wait on is worth
  starting early, and a stage nothing waits on can wait itself.

## Where the code goes

[roadmap.md](roadmap.md) names every plugin by **id** — `eva.tool.read`,
`eva.harness.acp` — and never by path, because the id is the thing that
appears in config, in a Build, and in the trace. One rule turns an id into a
place, so a stage's table there is enough to know what to create here:

```
plugin id           eva.a.b
directory           plugins/a-b/
package name        @missingstudio/eva-a-b
```

`eva.trace.jsonl` is `plugins/trace-jsonl/`, published as
`@missingstudio/eva-trace-jsonl`. `eva.provider.anthropic` is
`plugins/provider-anthropic/`. The rule has **one exception**: `eva.tui` lives
in `plugins/tui/` but publishes as `@missingstudio/eva-tui-surface`, because
`packages/tui` already holds the renderer and took the plain name.

Three directories, and which one a stage's work belongs in:

| Directory   | Holds                                                                                              | A stage puts work here when                                |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/` | libraries with no plugin in them — the kernel, the schema, the SDK, the client runtime, a renderer | the code is called by plugins and registers nothing itself |
| `plugins/`  | everything that registers into a domain, slot, hook, or broadcast                                  | the code extends Eva, which is nearly always               |
| `apps/`     | composition roots — a binary, a page, a window, a phone app                                        | the code is the thing a person launches                    |

The layering is enforced, not conventional:
[reference/architecture.md](reference/architecture.md) carries the import
graph. The short version: a plugin may import `schema`, `core`, `sdk`,
`client-runtime`, and `tui-core`, and never `kernel`. A package never imports
a plugin. An app imports both and is imported by nothing.

**No listing of the tree lives here.** `ls packages plugins apps` answers
what exists in one command, and a copy of that answer goes stale the day a
directory lands. What a stage adds against what it extends is the tables
below.

**What the plan adds outside the id rule** — the packages and apps no plugin
id names, each with the stage that creates it. "What each stage creates" below
is the full per-stage list:

| Path                    | What                                                         | Created by |
| ----------------------- | ------------------------------------------------------------ | ---------- |
| `packages/session-view` | the one fold: a Transcript to Blocks, with no renderer in it | W1         |
| `apps/web`              | the page: React 19, Vite, TanStack Router                    | W1         |
| `apps/desktop`          | the Tauri shell, and `apps/desktop/src-tauri` beside it      | D0         |
| `apps/mobile`           | one Expo codebase; iOS and Android are platform layers       | M2         |

Everything else the plan adds is a plugin, so its path is its id.

## What each stage creates

Every plugin a stage adds, as a path. Read it beside the stage's own plugin
table in [roadmap.md](roadmap.md): that table says what each plugin **does**,
this one says where it **goes**. A stage that adds no plugin is absent.

### The factory stages

| 1 | `plugins/prompt/` · `plugins/validator/` · `plugins/workflow/` · `plugins/provider-openai/` · `plugins/provider-compatible/` |
| 2 | `plugins/tool-read/` · `plugins/tool-edit/` · `plugins/tool-grep/` · `plugins/tool-glob/` · `plugins/tool-bash/` · `plugins/tool-web/` · `plugins/tool-policy/` · `plugins/fs/` · `plugins/shell/` · `plugins/sandbox-none/` · `plugins/harness-loop/` · `plugins/sched/` · `plugins/steer/` · `plugins/approval/` · `plugins/diff/` · `plugins/api/` |
| 3 | `plugins/repomap/` · `plugins/retrieve/` · `plugins/compaction/` · `plugins/project/` |
| 4 | `plugins/workspace/` · `plugins/workspace-worktree/` · `plugins/sandbox-local/` · `plugins/snapshot/` · `plugins/net/` · `plugins/secrets/` |
| 5 | `plugins/verify/` · `plugins/check-build/` · `plugins/check-lsp/` · `plugins/check-browser/` · `plugins/remediate/` |
| 6 | `plugins/trace-replay/` · `plugins/trace-redact/` · `plugins/trace-publish/` · `plugins/memory-project/` · `plugins/memory-procedural/` |
| 6.5 | `plugins/registry/` · `plugins/trust/` · `plugins/host-remote/` |
| 7 | `plugins/profile/` · `plugins/agents/` · `plugins/subagent/` · `plugins/resume/` · `plugins/branch/` · `plugins/rewind/` |
| 8 | `plugins/eval/` · `plugins/eval-score/` · `plugins/eval-compare/` · `plugins/eval-gate/` |
| 9a | `plugins/task/` · `plugins/task-import/` · `plugins/queue/` · `plugins/scheduler/` · `plugins/daemon/` |
| 9b | `plugins/control/` · `plugins/enroll/` · `plugins/identity/` · `plugins/attest/` · `plugins/tenant/` |
| 9c | `plugins/harness-acp/` · `plugins/harness-<vendor>/` · `plugins/harness-conform/` · `plugins/serve-acp/` · `plugins/race/` |
| 9d | `plugins/skill/` · `plugins/mcp-client/` · `plugins/mcp-server/` |
| 10 | `plugins/integrate/` · `plugins/mergeq/` · `plugins/conflict/` · `plugins/review-auto/` · `plugins/review-route/` |
| 11 | `plugins/meter/` · `plugins/gateway/` · `plugins/policy-org/` · `plugins/report/` · `plugins/projector/` · `plugins/billing/` |
| 12 | `plugins/learn-mine/` · `plugins/learn-distill/` · `plugins/learn-propose/` · `plugins/learn-route/` · `plugins/learn-tune/` |
| 13 | `plugins/sense/` · `plugins/synthesize/` · `plugins/plan/` |
| 14 | `plugins/treasury/` · `plugins/mandate/` · `plugins/halt/` · `plugins/support/` |

A path may appear under two stages when one creates it and the other extends
it: W1 creates `plugins/api/` and stage 2 adds its write half, M0 creates
`plugins/enroll/` and 9b widens its tiers. The surface table below marks a
creator in bold; a factory row never does, so where both tables name one
path, the bold row is the creator.

Two rows deserve a note. **6.5** is the only stage whose directories are not
derived from a plugin id: `plugins/registry/`, `plugins/trust/`, and
`plugins/host-remote/` are named for what they hold, because a trust gate and
an out-of-process host are machinery a plugin uses rather than plugins
themselves. And **9c**'s `plugins/harness-<vendor>/` is a shape, not a path:
one directory per fleet member, each a launcher entry and at most four hooks
beside the shared `plugins/harness-acp/` runtime. If a vendor module needs
more than that, it is becoming a second contract — stop it there.

### The surface and service stages

These are mostly _extensions_ of a small number of paths rather than new
directories, which is the whole argument for the surface tracks being cheap.

| Stage | Creates or extends                                                                              |
| ----- | ----------------------------------------------------------------------------------------------- |
| C0    | done — `apps/cli/` · `plugins/tui/` · `plugins/print/` · `packages/tui/` · `packages/tui-core/` |
| C1    | `plugins/tui/` · `packages/session-view/`                                                       |
| C2    | `apps/cli/` (the `top` verb) · `plugins/tui/` · `packages/session-view/`                        |
| C3    | `apps/cli/` · `plugins/tui/` · `packages/session-view/`                                         |
| C4    | `apps/cli/`                                                                                     |
| W0    | done — `packages/client-runtime/`                                                               |
| W1    | **`packages/session-view/`** · **`plugins/api/`** · **`plugins/web/`** · **`apps/web/`**        |
| W2    | `plugins/api/` · `plugins/web/` · `apps/web/`                                                   |
| W3    | `packages/session-view/` · `apps/web/`                                                          |
| W4    | `apps/web/`                                                                                     |
| W5    | `apps/web/`                                                                                     |
| D0    | **`apps/desktop/`** · `apps/desktop/src-tauri/`                                                 |
| D1    | `apps/desktop/`                                                                                 |
| D2    | `apps/desktop/` · `.github/workflows/` — one more channel, never a second pipeline              |
| M0    | `packages/client-runtime/` · **`plugins/enroll/`**                                              |
| M1    | **`plugins/notify/`**                                                                           |
| M2    | **`apps/mobile/`**                                                                              |
| M3–M4 | `apps/mobile/`                                                                                  |
| M5    | `plugins/enroll/` · `plugins/control/`                                                          |
| S1    | `apps/cli/` · a compose file · and a **separate** Terraform or Pulumi repository                |
| S2    | `plugins/export/` · `plugins/tenant/`                                                           |
| S3    | `plugins/svc-sandbox/` · `plugins/svc-tokens/` · `plugins/svc-integrations/`                    |
| S4    | `plugins/billing/`                                                                              |
| S5    | `apps/cli/` · `plugins/halt/`                                                                   |

**Bold** is the path that stage creates. Everything else is a path another
stage creates and this one adds to.

Read the shape of that table rather than its rows: **four surfaces and a
service business, and the only genuinely new directories are one package, one
plugin pair, and three apps.** Everything else is an extension of something
stage 0 or W0 already built. That is what "every interface is a plugin over
one Session API" costs when it is true.

## The plans in flight

The order above says what is next. `plans/` says how, for the stage that is
actually being built: a README with the stage's shape, then numbered tickets
with a priority, an effort, and a dependency. A stage gets its directory when
it is next, not when it is designed — decomposing a stage four waves out is
planning against a tree four stages of change away.

`plans/` is gitignored, so which directories a checkout holds is working
state this document never lists — the execution log in
[development.md](development.md) says which stage is being built and what is
left of it. A deleted plan has no history to come back from, and what a
finished stage's plans concluded survives only where it was written to count:
an exit test in [roadmap.md](roadmap.md), a word in [context.md](context.md),
a path here. That is the rule the directory is for: **a plan is working
state, and anything that must outlive the work goes somewhere committed
before the work ends.**

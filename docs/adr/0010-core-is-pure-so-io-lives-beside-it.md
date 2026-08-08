---
status: accepted
---

# core is pure, so every module that touches the outside world sits beside it

`core` holds the domain: Unit, Spec, Outcome, the loop, Session and turn logic, and the interfaces the outer layers implement. It imports `events` and nothing else from within Eva, and it never reaches the outside world — no filesystem, no network, no terminal, no subprocesses.

Everything that does reach outside sits in its own module beside `core`:

| Module | Holds | May import |
| --- | --- | --- |
| `events` | the Event schema and its codec | standard library only |
| `core` | domain types, the loop, Session and turn logic, and the interfaces — including the `TraceSink` **interface** | events |
| `config` | TOML loading, key resolution, model selection | events, core, stdlib, toml |
| `providers` | the `Provider` interface, Anthropic, the scripted fake | events, core, stdlib, the Anthropic SDK |
| `trace` | the JSONL sink — the `TraceSink` **implementation** | events, core, stdlib |
| `cli` | REPL, rendering, one-shot, machine-readable output | all of the above, plus the terminal libraries |

There is no root module. `go.work` is the root, and the workspace is what ties the six together.

`session` and `render` from stage 0's package list are not modules. Session and turn logic are pure, so they live in `core`. Rendering is a frontend concern, so it lives in `cli` — which is where the plan's own tree puts it.

## How it is enforced

By `depguard` inside golangci-lint, configured in `.golangci.yml`, and run by `make lint`.

Every rule uses `list-mode: strict`, so an import is allowed only if it appears in that layer's allow list. The rules therefore **fail closed**: a dependency nobody considered is rejected rather than quietly permitted. Adding a line to an allow list is a deliberate act, and reviewing that line is how a layer's contract stays true.

`core`'s allow list is deliberately almost empty — it does not include the standard library. Each standard-library package `core` comes to need is added on purpose by whoever needs it. That friction is the contract doing its job, and it is what makes "core is pure" checkable rather than aspirational.

"Nothing imports a frontend" needs no rule of its own: `cli` appears in no other layer's allow list, and every list is strict.

## Why this differs from the module tree in the plan

The plan states a rule and draws a tree that breaks it. The rule says core never imports UI, provider specifics, or OS and path specifics. The tree puts `trace/` inside `core/` — and a JSONL sink writes files, so it needs the filesystem. The linter this repository now runs rejects the tree the plan draws.

The same applies to `config`, which the plan lists as a stage 0 package but gives no home in the tree at all. It reads a file, so it cannot live in `core` either.

Rather than weaken the rule, the tree moved. `core` declares `TraceSink`; `trace` implements it. That split is what ADR 0008 already implies, since the sink is the thing that assigns Trace position and appends a turn group atomically.

Two smaller widenings, recorded here so they are not mistaken for drift:

- The plan gives `providers` and `env` `imports: events` only. This table also lets `config`, `providers`, and `trace` import `core`, because each implements an interface that `core` declares. Without that they could not satisfy the contracts they exist to satisfy.
- The plan routes `cli` through `harness`. `harness` arrives at stage 7, so until then `cli` imports `config`, `providers`, and `trace` directly. When `harness` lands, that is the moment to narrow `cli`'s allow list rather than widen it further.

## Considered options

- **Relax the rule so `os` is permitted inside `core/trace` and `core/config`.** Cheaper immediately, and rejected. "core is pure" would stop being true on the first commit, and the most valuable rule would become advice rather than a gate.
- **Put the filesystem work in `env/`.** That module exists in the plan for workspaces, snapshots, and secrets, and arrives at stage 4. Borrowing it now would mean stage 0 depends on a module whose purpose is something else.
- **A hand-written architecture test instead of a linter.** Tried first and removed. It was 200 lines of walking and parsing that reimplemented what `depguard` does declaratively, and its denylist failed open — an import nobody had enumerated passed.

## Consequences

Module paths appear in every import written afterwards, so this is expensive to change once code exists. It is cheap right now, which is why it is decided at stage 0 rather than discovered at stage 6.

An outer module can always be added later without touching `core`. Moving something *out* of `core` later would break every importer, so the bias is to keep `core` smaller than feels necessary.

A new module must be added to `go.work` **and** given a rule in `.golangci.yml`. A module with no rule falls through to depguard's default, which allows only the standard library — restrictive rather than permissive, so a forgotten rule fails loudly instead of silently.

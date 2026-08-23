# @missingstudio/eva-workflow

The workflow harness plugin for [Eva](../../README.md). A workflow is a
declared list of Steps that answers a prompt: the file owns the control flow,
and the model fills the slots. Each Step fills a Template, opens one Run, and
may declare a JSON Schema its answer must conform to — a refused answer gets
one bounded Repair rather than a silent retry.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers one harness row per workflow, which `eva run` opens. The glossary
in [docs/context.md](../../docs/context.md) defines **Workflow**, **Step**,
**Candidate**, **Verdict**, and **Repair**;
[docs/reference/architecture.md](../../docs/reference/architecture.md) places
the harness seam.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default, after
`eva.prompt`, the catalogs, the providers, and `eva.validator`, so the
person's config rows are already in place when it registers. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-workflow": "workspace:*" } }
```

## Usage

Define a workflow under the `workflows` config key in a `.eva` config file,
or as a file in `.eva/workflows/*.yaml` — the kernel's resource discovery
reads those, keyed by the file's base name, so trust gating and the layer
chain apply and the plugin opens no file. A Step's `template` names a row in
the prompt domain, seeded here under the `prompts` key. The plugin takes one
option, `repairs` — the ceiling on Repairs per Step, default 1, zero means
judge and never repair; a Step's own `repairs` key overrides it:

```yaml
plugins:
  - id: eva.workflow
    options: { repairs: 2 }

prompts:
  review:
    text: "Review this file and answer findings as JSON: {{input}}"

workflows:
  review:
    name: Review
    steps:
      - id: findings
        template: review
        with: { input: input }
        schema:
          type: array
          items: { type: object, required: [file, line, claim] }
```

Run it — one input in, the last Run's text out:

```bash
eva run review src/auth/login.ts
```

The input arrives by one route: a positional file path, `--input <file>`, or
piped standard input — two at once is refused, and none means the empty
string. A trailing `.yaml` or `.yml` on the name is stripped, so
`eva run review.yaml` finds the same row.

A workflow document holds a `name`, an optional `model` (`provider/model`,
also settable per Step), and `steps` in execution order. Each Step holds an
`id`, a `template`, an optional `with` mapping whose values are one of
exactly three shapes — `input`, `<step>.output`, or
`<step>.output.<dotted.path>`, naming only an earlier Step — an optional
inline JSON Schema under `schema`, and an optional `repairs` ceiling. Without
a `schema`, the Run's text is the Step's Output, unchecked.

## How a run works

Before the first model call, one pass checks every Step's Template row, its
model against the Catalog, and its JSON Schema through the Validator's
`accepts`, and names every problem together. A document that failed the load
pass still registers: its Run refuses with every problem named, putting the
refusal in the Trace.

Each Step opens one Run through `host.run`, so every Instruction is in the
Trace. The Budget is checked before every Step, Repairs included — the one
place a Repair could run without bound. A refused Candidate gets a Repair —
one more Step, asking again with it as the prior assistant message
and every Fault named, never the JSON Schema again. The Verdict goes through
`host.report` before the Repair's Run opens, so an interrupt cannot shrink a
measured denominator. An empty Validator slot degrades rather than refuses:
the answer arrives `unchecked`, beside a `degraded` record naming `Validator`.

The built-in repair Template registers as the prompt row `workflow.repair`,
so a config entry replaces it, and a row named `<workflow>.repair` outranks
it for that workflow alone. Steps share no history — each starts fresh — and
file order is the execution order. Steering is refused, not recorded: a
workflow's Steps are the file's. It reads no files at run time; the session's
cwd is accepted and unused.

## API

- `workflow` — the plugin definition, id `eva.workflow`. Reads the
  `workflows` key, takes the `repairs` option.
- `readWorkflow(id, raw): ReadWorkflow` — the load-time pass; `workflow` is
  present exactly when `problems` is empty.
- `makeWorkflowHarness(host, deps): Harness` — the harness itself, buildable
  without the plugin runtime; `WorkflowDeps` names what it reads.
- `readReference(written)` / `resolveReference(reference, input, outputs)` —
  the three-shape reference language `with` speaks.
- `REPAIR_TEMPLATE`, `REPAIR_TEMPLATE_ID`, `faultLine` — the built-in repair
  Template, its prompt-row id, and one Fault as one line.
- Types: `Step`, `Workflow`, `ReadWorkflow`, `WorkflowDeps`, `Reference`,
  `Resolved`.

## Development

Tests live beside the sources: [src/document.test.ts](src/document.test.ts)
holds the load pass, [src/reference.test.ts](src/reference.test.ts) the
reference language, [src/harness.test.ts](src/harness.test.ts) the repair
loop's ordering rules, and [src/index.test.ts](src/index.test.ts) the row
registration. `packages/conformance/src/workflow-validator.test.ts` and
`workflow-prompt.test.ts` prove the joins with the validator and prompt
plugins over a live kernel. Run the suite from the repository root:

```bash
bun run test
```

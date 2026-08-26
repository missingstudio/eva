# @missingstudio/eva-harness-loop

Eva's own propose → act → observe agent for [Eva](../../README.md). It takes a
Prompt and drives Steps against the tool domain until the model stops asking
for tools, a Budget runs out, or the max-steps fuse trips.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers one row in the `harness` domain that
[`@missingstudio/eva-sdk`](../../packages/sdk/README.md) declares, and it is
handed the two-member `HarnessHost` that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines. The
glossary in [docs/context.md](../../docs/context.md) defines **Harness**,
**Run**, **Step**, **Budget**, **Claim**, **Stop Reason** and **Outcome**;
[architecture.md](../../docs/reference/architecture.md) §12 owns the harness
seam.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). A plugin's effect answers an `Effect`.

A build that runs the loop also needs a model, at least one tool, and the
Trace. The Eva CLI carries all of them.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default, after
`eva.prompt` and after the tools and both gates. To use the package from
another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-harness-loop": "workspace:*" } }
```

## Usage

The loop is a harness row, so anything that names a harness reaches it:

```bash
eva run eva.harness.loop --input task.md
```

Two options bound one Prompt:

```yaml
plugins:
  - id: eva.harness.loop
    options:
      # The max-steps fuse: Steps in one Prompt. 32 by default.
      steps: 32
      # Consecutive Steps in which no proposed call could run. 2 by default.
      repairs: 2
```

The system prompt is a Template row, so a person replaces it by naming the
same id:

```yaml
prompts:
  loop.system: { text: "Work in steps. Read before you change anything." }
```

## One Step is one Run

A Step is one model request plus the tool executions its response causes, and
that is exactly one Run. So the loop calls `HarnessHost.run` once per Step, and
the calls the response proposed run inside the Run that proposed them: their
`tool_call`, `tool_update` and `tool_result` records commit before that Run's
`finished`.

The loop names its tools on the `RunInput` and reads what they answered off the
`RunResult`. It never calls a Provider, never touches the tool pipeline
directly, and holds no `HarnessClient` — a permission reaches a person through
the pipeline's own gate, which the Run already carries.

A Step that proposes no call is the answer. The last Run's own Claim closed it,
so the loop writes nothing more.

## What stops a Prompt

| What                                        | Stop Reason         | Written by                  |
| ------------------------------------------- | ------------------- | --------------------------- |
| The model proposed no call                  | `end_turn`          | the Run's own Claim         |
| A Run failed                                | that Run's          | the Run's own record        |
| A Stop Reason that is not `end_turn`        | unchanged           | the Provider                |
| The Budget is exhausted                     | `max_turn_requests` | the loop, as a failed Claim |
| The max-steps fuse                          | `max_turn_requests` | the loop, as a failed Claim |
| No tool answered any call, past the ceiling | `max_turn_requests` | the loop                    |
| A cancel                                    | `cancelled`         | classified, never thrown    |

Reaching a ceiling is an **Outcome and not an error**: the partial work stays
on the Trace, every Run that ran closed with its own Claim, and the Prompt ends
with a Stop Reason the schema already carries. Nothing here coins a word.

**The fuse is not the Budget's `steps` limit.** A Budget is one accumulator for
the process and its counters never reset, so a `steps` limit of twenty would
let the first Prompt spend all twenty and stop the second at its first Step. A
fuse bounds one Prompt. The two measure different spans, so neither can
disagree with the other.

A Budget the response itself exhausted stops that response's own calls: each
one is `budget_denied` on the Trace with the same three records a call that ran
leaves, and the Prompt closes at the top of the next Step.

## A malformed call repairs

Every ending of a tool call is a Disposition, and the loop reads it as data. A
call naming a tool that is not registered answers `unknown_tool`, the fault
reaches the model in the next Step's history, and the next Step is the repair —
the same shape a refused Candidate takes in a Workflow. A model that does not
recover is stopped by the `repairs` ceiling, which counts **consecutive Steps
in which no call ran at all**. A call that ran and failed is an answer the
model can act on, so it never counts against the ceiling.

A denial counts against nothing either. A denial is observed, not fatal.

## What it does not do

- It does not decide whether a call may run. That is
  `tool.execute.before`, and the two gates there are plugins of their own.
- It does not schedule a group. `executeToolGroup` in
  [`@missingstudio/eva-core`](../../packages/core/README.md) orders one, and
  `eva.sched` is the policy it is ordered under.
- It does not choose a model per Step. The Catalog's default answers, so a
  model a person set on a Session does not yet reach a harness.
- It does not deliver steering. `eva.steer` owns that, and the structural point
  a steer lands on is the top of the Step loop — once the Run has closed and
  its tool group has committed.
- It hosts no plugins yet. `architecture.md` §12.3a describes six host-scoped
  extension points; each is a seam in `LoopDeps` today, so cutting one later is
  a change here and not a rewrite.

## The tool exchange rides the history as text

`TranscriptMessage` is the one history shape every Provider is handed, and its
`tool` block carries neither the arguments nor the result content. So the loop
states each Step's exchange in words: `tool_call <id> <name> <args>` in the
message the model wrote, and `tool_result <id> <disposition>` with what the
tool said in the message that answers it.

Every Provider already carries text, and a foreign adapter needs no new
capability to read it. A structured exchange would mean changing the fold's
block, all three provider adapters and every golden — worth doing, and a change
of its own.

## API

- `harnessLoop` — the plugin definition, id `eva.harness.loop`.
- `makeLoopHarness(host, deps): Harness` — the loop itself, over a
  `HarnessHost` and a `LoopDeps`.
- `LOOP_HARNESS_ID`, `LOOP_TEMPLATE_ID`, `LOOP_TEMPLATE` — the row id and the
  built-in system prompt.
- `offeredIn(rows)`, `stepMessages(text, called)`, `proposalLine(call)`,
  `answerLine(called)`, `human(text)` — the pure half of a Step, for a suite
  that wants it without a kernel.

## Development

Tests live beside the source: [src/step.test.ts](src/step.test.ts) holds the
pure half, [src/harness.test.ts](src/harness.test.ts) drives the whole control
flow against a scripted `HarnessHost`, and
[src/index.test.ts](src/index.test.ts) holds the registration. The end-to-end
proof — the loop, the real tools, the real gate and a named permission mode
over a virtual file system — is in `packages/conformance`, because a plugin may
not import another plugin. Run the suite from the repository root:

```bash
bun run test
```

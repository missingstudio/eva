# @missingstudio/eva-tool-bash

The command tool for [Eva](../../README.md). It runs one command inside
whatever containment the `Sandbox` slot holds, streams the output while the
command runs, and reports the exit. A nonzero exit is a result and not a
failure of the call: the exit code is in the result and the Run carries on.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
reads the `Sandbox` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines and
[`eva.sandbox.none`](../sandbox-none/README.md) fills today, and it registers
one row in the tool domain. The glossary in
[docs/context.md](../../docs/context.md) defines **Slot** and **Seam**;
[architecture.md](../../docs/reference/architecture.md) §5 owns the slot
mechanics, and [roadmap.md](../../docs/roadmap.md) puts real containment at
stage 4.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The tool returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tool-bash": "workspace:*" } }
```

## Usage

### Set the limits in the Eva CLI

The process holds no limit of its own, so the limits are this plugin's policy.
Set them in a `.eva` config file:

```yaml
plugins:
  - id: eva.tool.bash
    options: { timeout: 120, maxOutput: 64000 }
```

| Option      | Type   | Default | What it limits                        |
| ----------- | ------ | ------- | ------------------------------------- |
| `timeout`   | number | 120     | Seconds one command may run           |
| `maxOutput` | number | 64000   | Characters of output one call carries |

`timeout` is the limit and not a suggestion: a call may ask for less time and
never for more.

### What the model sends

```json
{ "command": ["bash", "-c", "npm test"], "cwd": "packages/core", "timeout": 60 }
```

`command` is the program and its arguments, **already split into words**.
Nothing reaches a shell, so a caller that wants shell syntax names the shell
itself. This tool splits nothing: the words that reach the Sandbox are the
words a gate judged, and two splitters that disagree is the hole a gate exists
to close.

### Run a command in code

`runCommand` runs one command without the plugin runtime. It takes the read of
the Sandbox slot, never a Sandbox:

```ts
const running = runCommand(
  { sandbox: ctx.slot.sandbox.peek, timeout: 120, maxOutput: 64_000 },
  { id: call.id, args: call.args, emit: (payload) => recorder.commit([payload]) },
)
```

## How a command is reported

- **The output streams.** Output is gathered per window and each window is one
  `tool_update` payload. A process hands over chunks in whatever sizes the
  operating system chose, so one record per chunk is a record count nothing
  can predict — a chatty command would write thousands. One window is one
  record, and the window is short enough that a reader still watches the
  command work.
- **The result carries the ending.** `exit code 3` for a process that exited,
  `stopped by SIGTERM` for one a signal ended. The disposition is `ok`,
  because how a command ended is data the model reads rather than a failure of
  the call.
- **A timeout is `failed`, and it kills the process.** The kill is not waited
  out: a process that ignored the signal would hold the Run open for as long
  as it liked, and the fact worth reporting is that the command ran too long
  rather than which signal ended it.
- **An interruption still closes the record.** A cancelled Run interrupts the
  fiber, which closes the Scope and kills the process. There is no result to
  answer with, so one last `tool_update` keeps the Trace from reading
  `in_progress` for ever.
- **An empty `Sandbox` slot is `degraded`.** The call commits
  `degraded { missing: ["Sandbox"] }` and ends as data, rather than guessing
  that a command with no containment was wanted.
- **The containment it had, not the containment it asked for.** The result
  reads `capabilities` and says when nothing enforced the policy. Today
  `eva.sandbox.none` enforces nothing, so every result says so; a filler that
  enforces something takes the caveat away with it.

## What policy it asks for

The `SandboxPolicy` is the caller's decision, so this tool states one: every
path readable, the directory the command runs in writable, and the network
open.

Reading is not where containment is won — a command runs a program from the
machine's own toolchain, so a narrow `readable` refuses every command rather
than containing one. Writing is where it is won. The network stays open
because most commands fetch, and a stage-4 Sandbox that refused `git fetch`
with nothing said is harder to find than one that allowed it.

Narrowing any of the three is `eva.tool.policy`'s decision and the mode's,
never this tool's.

## What it does not do

- It refuses nothing. Whether a command may run at all is the gate's
  decision, and this tool never sees it.
- It contains nothing itself. Containment is the `Sandbox` slot's, read per
  call so stage 4's filler arrives with no change here.
- It writes no `tool_call` and no `tool_result`. It emits the `tool_update`
  payloads only it can see, through the `ToolContext` the execution hands it,
  and answers the result the execution records.

## API

- `toolBash` — the plugin definition, id `eva.tool.bash`. It takes `timeout`
  and `maxOutput`, and registers one tool row.
- `runCommand(deps, call)` — the tool, for a caller that wants it without a
  kernel. `deps` is `{ sandbox, timeout, maxOutput }`, where `sandbox` is the
  **read** of the slot; `call` is `{ id, args, emit }`.
- `readInput(args)` — the arguments, read, or nothing when they name no
  command.
- `commandTool(deps)` — the tool row `toolBash` registers.

## Development

Tests live beside the sources: [src/command.test.ts](src/command.test.ts)
holds the tool's own decisions over a written Sandbox — the argv and the
policy that reach the seam, the slot read per call, the empty slot, each
ending, and both limits; [src/index.test.ts](src/index.test.ts) holds the id,
the options, and the load. The same behaviour over the real Shell and the real
`eva.sandbox.none` is in
[packages/conformance/src/tool-bash.test.ts](../../packages/conformance/src/tool-bash.test.ts),
because a plugin may not import another plugin. Run the suite from the
repository root:

```bash
bun run test
```

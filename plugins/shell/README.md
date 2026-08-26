# @missingstudio/eva-shell

The process plugin for [Eva](../../README.md). It starts a process, streams
stdout and stderr while the process runs, and reports the exit. A nonzero exit
is a result and not a failure of the call: the caller reads it and the Run
carries on.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `Shell` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines, and
[`eva.sandbox.none`](../sandbox-none/README.md) reads that slot to start the
commands it does not contain. The glossary in
[docs/context.md](../../docs/context.md) defines **Slot** and **Seam**, and
[architecture.md](../../docs/reference/architecture.md) §5 owns the slot
mechanics.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The `Shell` contract returns `Effect`
  values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-shell": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. A caller reads the
slot and spawns a `Command`: the program and its arguments already split, and
optionally a directory to start in and environment to add.

```ts
const shell = yield * ctx.slot.shell.peek
const process = yield * shell.spawn({ argv: ["git", "status", "--short"] })
yield * Stream.runForEach(process.output, (chunk) => show(chunk.text))
const exited = yield * process.exit
```

Nothing in `argv` reaches a shell. A caller that wants shell syntax names the
shell itself — `["bash", "-c", line]` — so the gate that judges a command sees
the words that will really run.

## What a spawn promises

- **The output is live.** Chunks are queued as they arrive, so a reader that
  starts late still reads from the first one, and each chunk is handed out
  once. stdout and stderr are one stream in arrival order, each chunk naming
  where it came from.
- **A spawn that never started is the only failure.** Node reports a program
  it cannot start after the call returns, so `spawn` waits for the process to
  be running. A program the machine has no such file for is a `ShellError`
  with `reason: "not_found"`; everything else that stopped the start is
  `spawn_failed`.
- **Every ending is a result.** `exit` answers the code, or the signal that
  ended the process, and it is safe to read more than once.
- **The Scope owns the process.** A process still running when the scope
  closes is sent `SIGTERM`, so a Run that ends leaves nothing behind.

## What it does not do

It contains nothing. Containment is the `Sandbox` slot's job — this plugin
starts what it is given, with the machine in reach. It also holds no timeout:
a caller that wants one races `exit` and calls `kill`, because how long a
command may take is the caller's policy and not the process's.

## API

- `shell` — the plugin definition, id `eva.shell`. It takes no options and
  provides the `Shell` slot.
- `makeShell(): Shell` — the implementation, for a suite that wants the filler
  without a kernel.

## Development

Tests live beside the sources: [src/shell.test.ts](src/shell.test.ts) holds
the streaming, the chunk that arrives before the process ends, the signal, the
nonzero exit, the directory and the environment, and the two spawn failures;
[src/index.test.ts](src/index.test.ts) holds the slot fill and the empty on
unload. That `eva.sandbox.none` reads this slot per command is proved in
[packages/conformance/src/ground-slots.test.ts](../../packages/conformance/src/ground-slots.test.ts).
Run the suite from the repository root:

```bash
bun run test
```

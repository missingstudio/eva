# @missingstudio/eva-sandbox-none

The sandbox that contains nothing, for [Eva](../../README.md). **It applies no
limits at all.** A command it starts reaches every file the user account
reaches and every network the machine reaches, exactly as if it had been typed
into a terminal. It exists so the seam exists: a tool asks for containment
through one contract from its first day, and the plugin that answers with real
limits replaces this one whole.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `Sandbox` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines, and it
starts each command by reading the `Shell` slot that
[`eva.shell`](../shell/README.md) fills. The glossary in
[docs/context.md](../../docs/context.md) defines **Slot** and **Seam**;
[architecture.md](../../docs/reference/architecture.md) §5 owns the slot
mechanics, and [roadmap.md](../../docs/roadmap.md) puts real containment at
stage 4.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The `Sandbox` contract returns `Effect`
  values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-sandbox-none": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. A caller reads the
slot per command and never captures it:

```ts
const sandbox = yield * ctx.slot.sandbox.peek
const process = yield * sandbox.run({ argv: ["bash", "-c", line] }, policy)
```

The `SandboxPolicy` states what the command may reach — readable paths,
writable paths, and the network — whatever the filler behind the slot can
hold. This one holds none of it, and `capabilities` is where it says so:

```ts
yield * sandbox.capabilities // { enforces: [] }
```

A caller reads `capabilities` and reports the containment it has rather than
the containment it asked for. Reporting the absence is the honest answer; a
policy that was quietly ignored is not.

## How it contains nothing

`run` reads the `Shell` slot and starts the command through it, unchanged. It
does not read the policy — there is nothing here to enforce it with, and an
empty `enforces` is where that is said.

The read is a read of the slot, not a held Shell, so replacing the Shell
reaches the next command. That is the same reason a caller must never capture
the `Sandbox` either: stage 4's filler takes this slot and arrives at every
call site with no change to any of them.

With nothing filling the `Shell` slot, `run` fails with a `SandboxError` whose
reason is `unavailable` — no command can start, said out loud. A Shell that
could not start the program is carried through as `spawn_failed`.

## What it does not do

- It refuses nothing. It is not a gate: `eva.tool.policy` decides whether a
  command may run at all, and this plugin never sees that decision.
- It reports nothing to the Trace. What a Run says about running without
  containment is the caller's record to write, from `capabilities`.
- It is not a stub. The contract it answers is the contract a real sandbox
  answers, and its answers are true.

## API

- `sandboxNone` — the plugin definition, id `eva.sandbox.none`. It takes no
  options and provides the `Sandbox` slot.
- `makeNoSandbox(shell: Effect<Shell | undefined>): Sandbox` — the
  implementation. It takes the **read** of the Shell slot rather than a Shell,
  because every command reads the slot again.

## Development

Tests live beside the sources: [src/sandbox.test.ts](src/sandbox.test.ts)
holds the empty capabilities, the command passed through unchanged, the slot
read per command, and the two failures;
[src/index.test.ts](src/index.test.ts) holds the slot fill and the empty on
unload. Over a live kernel, with `eva.shell` behind it and then a second Shell
taking the slot, the same behaviour is proved in
[packages/conformance/src/ground-slots.test.ts](../../packages/conformance/src/ground-slots.test.ts).
Run the suite from the repository root:

```bash
bun run test
```

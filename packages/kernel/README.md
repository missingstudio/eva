# @missingstudio/eva-kernel

The plugin runtime of [Eva](../../README.md). It is the part of Eva that is
not a plugin: the machinery that loads and unloads plugins, the four extension
points a plugin registers into (domains, slots, hooks, broadcasts), the YAML
config source, and the resolution that decides which config applies where Eva
runs.

Eva is built on a plugin kernel: every capability is a plugin, and this
package is the runtime under all of them. It builds the machinery but names no
Slot and declares no Domain — `@missingstudio/eva-boot` assembles the pieces
into a running kernel, and a plugin never imports this package: it reaches the
kernel through the `PluginContext` that `@missingstudio/eva-sdk` types. The
glossary in [docs/context.md](../../docs/context.md) defines each term, and
[architecture.md](../../docs/reference/architecture.md) holds the layer rule
this package sits under: the kernel may not import the SDK, and shared shapes
live in `@missingstudio/eva-core`.

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

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-kernel": "workspace:*" } }
```

## Usage

Each extension point has one constructor. A Slot, for example, holds one
implementation at a time and is read at the point of use:

```ts
import { makeSlot } from "@missingstudio/eva-kernel"
import { Effect, Scope } from "effect"

const program = Effect.gen(function* () {
  const slot = yield* makeSlot<{ greet: Effect.Effect<string> }>("Greeter")

  // provide registers into a scope; closing the scope empties the slot
  const scope = yield* Scope.make()
  yield* Effect.provideService(
    slot.provide("acme.greeter", { greet: Effect.succeed("hello") }),
    Scope.Scope,
    scope,
  )

  const greeter = yield* slot.get // dies while the slot is empty
  return yield* greeter.greet
})

await Effect.runPromise(program) // "hello"
```

## How the plugin runtime works

`makePluginRuntime` runs each plugin's effect in a scope of its own.
Re-adding a known id replaces it and keeps its order position, removing it
runs every finalizer it registered, and a load cycle dies naming its chain.

`makeDomain` rebuilds a Domain by replaying every registered transform in
registration order, then running the finalizer. `batch` defers the rebuilds,
so a boot that registers many transforms rebuilds each Domain once.
`makeRowDomain` is the draft of plain rows every Domain but the catalog has:
a row is copied in, a replaced row keeps its position, and an id nothing
registered is left alone.

## How config is resolved

The config source reads YAML layers and merges them under one law: mappings
merge key by key, lists replace, and every leaf remembers the file that set
it. The kernel reads only the keys in `KERNEL_KEYS` — `plugins` — and carries
every other key raw, because interpreting config is a plugin's job. A `.eva`
directory is a layer too: `resources` reads agents, commands, prompts, themes,
and workflows into the same mapping a config file produces.

`resolveLocation` decides which layers apply where Eva runs. A project
directory is read only after a grant, the grant lives beside the person's own
config rather than in the repository, and what an untrusted checkout holds is
named in `Location.ignored` rather than skipped in silence.
`resolveConfiguration` holds the whole order, lowest precedence first: the
user directory and file, `EVA_CONFIG_DIR`, the trusted project chain, every
`--config`, `EVA_CONFIG_CONTENT`, then the flags as one layer whose origin is
"the command line". A decision record, local to a checkout, records why a
flag is a layer and why the trust grant lives where it does.

## What it does not do

It assembles nothing. Which Slots and Domains Eva has is boot's table — every
constructor here takes a name, and a resolved plugin the build does not carry
is named in the `Kernel.missing` that `@missingstudio/eva-boot` returns.
Nothing watches a config file: a resolution is read once, and seeing a change
means resolving again.

## API

- `makePluginRuntime(scope, context, events?)` — the plugin runtime: `add`,
  `remove`, `wait`, and `list`.
- `makeDomain(options)` / `batch(effect)` — a Domain rebuilt by replaying its
  transforms; inside a batch, each Domain rebuilds once.
- `makeRowDomain(name, publish)` — the Domain of plain rows.
- `makeSlot(name, events?)` — one implementation at a time; `get` dies while
  the Slot is empty, `peek` answers `undefined`.
- `makeHooks()` — hooks run sequentially in registration order.
- `makeBroadcast()` — the typed, process-local stream bus.
- `readConfig`, `layered`, `mergeConfig`, `resolvePlugins` — the YAML config
  source and its merge law.
- `KERNEL_KEYS` — the top-level config keys the kernel itself reads:
  `{ plugins: "list" }`.
- `resolveLocation(directory, env)` / `resolveConfiguration(options)` — which
  layers apply here, and the whole resolution order in one call.
- `isTrusted`, `grantTrust`, `revokeTrust` — the project trust grant.
- `resources(directory)` — a `.eva` directory read as a config layer.

## Development

Tests live beside the sources: [plugin.test.ts](src/plugin.test.ts) holds the
load, replace, and cycle rules, [domain.test.ts](src/domain.test.ts) the batch
rule, [slot.test.ts](src/slot.test.ts) the slot rules,
[config.test.ts](src/config.test.ts) the merge law and the origin table, and
[resolution.test.ts](src/resolution.test.ts) the order end to end. Run the
suite from the repository root:

```bash
bun run test
```

# @missingstudio/eva-sdk

What a plugin author imports to write an [Eva](../../README.md) plugin:
`define` to declare the plugin, `declare` to name the config keys it reads,
and the `PluginContext` type — everything a plugin may touch at runtime.

Eva is built on a plugin kernel: every capability is a plugin, and this
package is the surface a plugin sees. It never imports the kernel — a plugin
reaches the kernel only through the context, and
[architecture.md](../../docs/reference/architecture.md) holds that layer
rule. The glossary in [docs/context.md](../../docs/context.md) defines the
terms, and [writing-plugins.md](../../docs/reference/writing-plugins.md) is
the full walkthrough.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). A plugin's effect is an `Effect` value.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-sdk": "workspace:*" } }
```

## Usage

The smallest plugin registers one command row:

```ts
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

export default define({
  id: "eva.hello",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.command.transform((command) => {
      command.set({
        id: "hello",
        description: "Says hello",
        run: () => Effect.sync(() => console.log("hello")),
      })
    })
  }),
})
```

A plugin declares the config keys it reads, and reads them through that
declaration, so a key spelled two ways does not compile:

```ts
import { declare, define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

const KEYS = declare({ greeting: "string" })

export default define({
  id: "eva.hello",
  reads: KEYS.shapes,
  effect: Effect.fn(function* (ctx) {
    const greeting = KEYS.read(yield* ctx.config, "greeting", "hello")
    yield* Effect.log(greeting)
  }),
})
```

Options under the plugin's own config entry are declared the same way, as
`takes`, and arrive on `ctx.options` rather than `ctx.config`.

## What the context carries

`define` takes a `Plugin`: an id, the config keys it `reads` and `takes`, and
an effect that runs once at load. The effect receives the `PluginContext`:

- The Domains: eight domains of plain rows, declared once in the `RowInfos`
  table — command, theme, keymap, agent, prompt, harness, surface,
  integration — and the catalog, the one Domain that is not rows. The domain
  type, its `<name>.updated` Broadcast topic, and the context field all derive
  from that table.
- The Slots, in `Slots`: recorder, traceSink, sessionStore, credentialStore,
  budget, validator, diffApplier. Adding one is a reviewed SDK change.
- The Hooks, in `ProviderHookSpec`: `model.resolve`,
  `provider.request.before`, `provider.response.after`, `provider.retry`. The
  map is the one place a hook name and its shape are declared, so a
  misspelling does not compile.
- The Broadcasts, in `BroadcastMap`, plus the plugin's own `options`, the
  resolved `config`, the Catalog's `prices`, and — for a Host plugin —
  `plugin.add`.

## What it does not do

It runs nothing. The kernel builds the domains, slots, hooks, and broadcasts,
and boot assembles them into the context this package types. It parses no
config file: `readShape` reads a value that already arrived, and falls back
rather than coercing one written in another shape — `"8"` is not a number.

## API

- `define(plugin)` — declares a `Plugin`: `id`, `reads`, `takes`, `effect`.
- `declare(shapes)` — a config-key declaration: `shapes` goes beside the id,
  `read(from, key, fallback)` reads one declared key.
- `stringOption(options, key, fallback)` — one key read by a name known only
  at run time.
- `readShape(value, shape)` / `fitsShape(value, shape)` — one answer for every
  Shape, shared with the config sweep.
- `instructionOf(...)` — fills a Template into an Instruction, or refuses with
  Gaps.
- `dispatch(...)` / `helpText(rows)` — resolves a command line through the
  command rows, and prints what they offer.
- `priceLookup(state)` — the Catalog's rates; a dated model id falls back to
  its undated row.
- `overFiles(deps, use)` / `textIn(input, key)` — one call of a tool that
  reads the `FileSystem` slot, and one string argument of that call. Every
  file tool answers the same sentence for an empty slot and the same
  Disposition for a path the file system refused.
- `offering(id, row)` — a plugin whose whole effect is offering one row to the
  tool domain. The id stays the plugin's own; a plugin that also registers a
  Command or reads options writes its own effect.
- Types: `Plugin`, `PluginContext`, `Slots`, `RowInfos`, `Domains`,
  `ProviderHookSpec`, `BroadcastMap`, `Frontend`, `FileDeps`.

## Development

Tests live beside the sources: [options.test.ts](src/options.test.ts) holds
the shape rules, [prompt.test.ts](src/prompt.test.ts) the Template and Gap
rules, [command.test.ts](src/command.test.ts) the dispatch rules, and
[domains.test.ts](src/domains.test.ts) the price lookup. The context itself
is assembled and exercised where the kernel and the SDK meet, in
[packages/boot/src/boot.test.ts](../boot/src/boot.test.ts). Run the suite
from the repository root:

```bash
bun run test
```

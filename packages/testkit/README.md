# @missingstudio/eva-testkit

The test helpers of [Eva](../../README.md). A test needs three things the
production tree cannot give it: a Provider that answers a written script
instead of a model, a replay of a recorded provider stream, and a way to run
one plugin's `effect` against a real kernel. All three live here.

Eva is built on a plugin kernel: every capability is a plugin, and a plugin
may not import the kernel — the layer rule in
[architecture.md](../../docs/reference/architecture.md) holds. `withPlugin`
is the one legal way a plugin's own tests boot it
([docs/decisions.md](../../docs/decisions.md) §"A plugin's tests may boot it,
and only its tests"). The glossary in
[docs/context.md](../../docs/context.md) defines the terms used here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The kernel a test boots speaks in
  `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

Add it as a devDependency — it is a test tool, so nothing it reaches may end
up in a shipped plugin:

```json
{ "devDependencies": { "@missingstudio/eva-testkit": "workspace:*" } }
```

## Usage

`withPlugin` runs a plugin's `effect` against a real kernel, through the same
`boot` a run uses — the same replay order, the same late-bound Slots. From
the themes plugin's own tests:

```ts
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { THEMES, themes } from "./index.js"

it("writes every theme into the theme domain", async () => {
  const rows = await withPlugin(themes, (kernel) =>
    Effect.map(kernel.domains.theme.get, (found) => found.map((row) => row.id)),
  )

  expect(rows).toEqual(THEMES.map((theme) => theme.id))
})
```

The third argument takes `options` (what the plugin reads through
`ctx.options`), `config` (what it reads through `ctx.config`), and `before`
(plugins loaded ahead of it, because a Transform often writes onto rows
another plugin made).

To fake the model, `scripted` returns a plugin that answers one written turn
per Provider Turn, and `seen()` holds every request it was handed — so a test
can assert what a Repair carried. A request past the end of the script fails
rather than repeating the final entry, because a silent repeat would make a
repair test pass for the wrong reason.

## API

- `withPlugin(plugin, body, options?)` — runs a plugin's `effect` against a
  real kernel and hands the body what it registered into.
- `scripted(script)` — a Provider that answers a written script; returns
  `{ plugin, seen }`.
- `recorded(cassette)` — a plugin that replays a vendored `Cassette`, chunk
  for chunk, one entry per Provider Turn.
- `providing(provider, id?)` — wraps any `Provider` as a plugin that answers
  `model.resolve` the way a provider plugin does. Both fakes go through it.
- `ScriptedTurn`, `Cassette`, `Scripted`, `LoadOptions` — the shapes above.
- `FAKE_PROVIDER`, `RECORDED_PROVIDER` — the ids the two fakes register
  under.

## What it does not do

It fakes one seam: the Provider. There is no fake Validator and no fake
TraceSink — the suites in [packages/conformance](../conformance/README.md)
boot the real ones. `packages/exit-test/scripts/record.ts` writes the
cassettes; this package only replays them. And nothing here ships: the layer
rule in `vite.config.ts` holds it above `boot`, and it is a devDependency
everywhere it is used.

## Development

Tests live in [src/provider.test.ts](src/provider.test.ts). Run the suite
from the repository root:

```bash
bun run test
```

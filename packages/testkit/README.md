# @missingstudio/eva-testkit

The test helpers of [Eva](../../README.md). A test needs five things the
production tree cannot give it: a Provider that answers a written script
instead of a model, a replay of a recorded provider stream, a live kernel
over the plugins under test, the record read back from behind it, and a file
system with no disk. All five live here.

Eva is built on a plugin kernel: every capability is a plugin, and a plugin
may not import the kernel — the layer rule in
[architecture.md](../../docs/reference/architecture.md) holds. `withPlugin`
is the one legal way a plugin's own tests boot it
([docs/decisions.md](../../docs/decisions.md) §"A plugin's tests may boot it,
and only its tests"), and `withKernel` is the same boot for several plugins
at once (§"Booting several plugins as peers is `withKernel`, in the
testkit"). The glossary in [docs/context.md](../../docs/context.md) defines
the terms used here.

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

Several plugins as peers is `withKernel`, which `withPlugin` is one call of.
It takes them in load order — a bare plugin, or `{ plugin, options }` where
the entry carries options — and hands the body the kernel and the scope,
which `openRow` needs. The scope closes when the body returns, so a finalizer
a plugin registered has already run. From
[workflow-prompt.test.ts](../conformance/src/workflow-prompt.test.ts):

```ts
import { openRow, scripted, withKernel } from "@missingstudio/eva-testkit"

const found = await withKernel(
  [fakeCatalog, fake.plugin, prompt, workflow],
  (kernel, scope) =>
    Effect.gen(function* () {
      const { harness, said } = yield* openRow(kernel, scope, "notes", SESSION)
      const reason = yield* harness.prompt(SESSION, { kind: "prompt", text: "THE CHANGES" })
      return { reason, said: said() }
    }),
  {
    config: { prompts: { summarize: { text: "Summarize: {{changelog}}" } }, workflows: WORKFLOWS },
  },
)
```

A suite that wants the record rather than what the row reported reads
`committed(kernel)`, which reads the Trace back through the `TraceSink`
contract — so no test casts the Slot to one sink plugin's own type.

To fake the model, `scripted` returns a plugin that answers one written turn
per Provider Turn, and `seen()` holds every request it was handed — so a test
can assert what a Repair carried. A request past the end of the script fails
rather than repeating the final entry, because a silent repeat would make a
repair test pass for the wrong reason.

To fake the workspace, `virtualFileSystem(files?)` fills the `FileSystem`
slot from a map: the paths are the keys, and nothing reaches a disk. It is
held to the same contract `eva.fs` is held to, in
[fs-contract.test.ts](../conformance/src/fs-contract.test.ts), so a tool test
that runs on it proves what a tool test on the disk would — with nothing to
make first and nothing to clean up after. It hands back a `plugin` for a
`withKernel` load, the `fs` itself for a suite that wants no kernel, and
`files()`, every file it holds, so a test reads what a tool wrote.

## API

- `withKernel(loaded, body, options?)` — boots a live kernel over the named
  plugins, in load order, and hands the body the kernel and its scope.
- `withPlugin(plugin, body, options?)` — one plugin under test, which is
  `withKernel` with the plugin last.
- `committed(kernel)` — every Event the sink behind the Recorder holds,
  session by session in trace order.
- `scripted(script)` — a Provider that answers a written script; returns
  `{ plugin, seen }`.
- `recorded(cassette)` — a plugin that replays a vendored `Cassette`, chunk
  for chunk, one entry per Provider Turn.
- `providing(provider, id?)` — wraps any `Provider` as a plugin that answers
  `model.resolve` the way a provider plugin does. Both fakes go through it.
- `virtualFileSystem(files?, root?)` — a `FileSystem` with no disk; returns
  `{ plugin, fs, root, files }`.
- `ScriptedTurn`, `Cassette`, `Scripted`, `Virtual`, `Loaded`,
  `KernelOptions`, `LoadOptions` — the shapes above.
- `FAKE_PROVIDER`, `RECORDED_PROVIDER`, `VIRTUAL_FS` — the ids the fakes
  register under, and `VIRTUAL_ROOT`, the root the virtual files sit under.

## What it does not do

It fakes two seams: the Provider and the FileSystem. There is no fake
Validator and no fake TraceSink — the suites in
[packages/conformance](../conformance/README.md) boot the real ones. The
FileSystem earns its fake because the real filler writes to a disk every tool
test would otherwise have to make and remove; the Provider earns its fake
because the real one costs money and answers differently each time. `packages/exit-test/scripts/record.ts` writes the
cassettes; this package only replays them. And nothing here ships: the layer
rule in `vite.config.ts` holds it above `boot`, and it is a devDependency
everywhere it is used.

## Development

Tests live beside the sources in [src/](src/). Run the suite from the
repository root:

```bash
bun run test
```

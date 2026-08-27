# @missingstudio/eva-boot

The boot sequence of [Eva](../../README.md). It assembles the kernel — the
slots, domains, hooks, and broadcast every plugin registers into — and loads
what the config resolved to, in one call.

Eva is built on a plugin kernel: every capability is a plugin. This package
is where `@missingstudio/eva-kernel`'s machinery and the SDK's tables meet:
the kernel builds a Domain, this package says which Domains Eva has. The
glossary in [docs/context.md](../../docs/context.md) defines the terms,
[architecture.md](../../docs/reference/architecture.md) holds the layer rule,
and [docs/decisions.md](../../docs/decisions.md) records why the assembly is
a package rather than a file in an app — a second app would have copied it.

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
{ "dependencies": { "@missingstudio/eva-boot": "workspace:*" } }
```

## Usage

`boot` takes what config resolved to and what this build carries, and returns
a running `Kernel`:

```ts
import { boot, buildOf } from "@missingstudio/eva-boot"
import { define } from "@missingstudio/eva-sdk"
import { Effect, Scope } from "effect"

const hello = define({
  id: "eva.hello",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.command.transform((command) => {
      command.set({ id: "hello", description: "Says hello" })
    })
  }),
})

const program = Effect.gen(function* () {
  const scope = yield* Scope.make()
  const kernel = yield* boot({
    scope,
    resolved: [{ id: "eva.hello" }], // what the config resolved to
    build: buildOf([hello]), // what this artifact carries
  })
  return kernel.missing // [] — the build carries every resolved id
})

await Effect.runPromise(program)
```

## What boot does end to end

`boot` returns a `Kernel`: the plugin runtime, six Slots (Recorder,
TraceSink, SessionStore, CredentialStore, Budget, Validator), nine Domains
(the hand-built catalog and eight row Domains), the four provider Hooks, the
Broadcast, and `prices` — the Catalog's rates derived once, read at the point
of use. Every Slot publishes `slot.filled` and `slot.emptied` through one
rule, and every Domain publishes its count on commit. Loading happens in one
`batch`, so each Domain rebuilds once rather than once per plugin.

A `Build` (`buildOf`) is the one predicate for "does this artifact carry that
id": `all` lists the plugins, and `carries(id)` answers the implementation or
nothing. The composition root asks it before boot to report, boot asks it
again to load, and `Kernel.missing` names every resolved id the build carries
no implementation for — a plugin that never loaded looks exactly like one
that did nothing, so silence is not an option.

Beside `boot`, three pieces bind the kernel to core's contracts. `runDeps`
builds the `RunDeps` that core's `submit` takes: each provider Hook runs in
registration order, and a Hook nobody registered is a no-op. `makeSessionAPI`
implements core's `SessionAPI` over this kernel — create, list, attach,
watch, submit, cancel, model, answer. `harnessHost` is what a native Harness
is handed: `run` is the one path that opens a Run, and `report` commits a
group through the same Recorder.

## One question, both doors

`overSurface` races two answers to one permission request: `Frontend.ask`, the
direct call to the surface Eva holds, and `SessionAPI.answer`, which names the
request over a socket. Both are answers to one question, so the first one wins
and the other door closes at once. A person who answers at a terminal leaves no
card still offering four buttons on a page.

**A known limit, and closing it changes a contract.** The request id is the
tool call's id. That is what lets a surface pair a question with the
`tool_call` record it already drew, and it is why the request carries nothing
else. But call ids repeat across Runs: a model that writes `call_1` in one Run
writes `call_1` in the next. An answer that arrives when no request of that id
is open is dropped, and a test pins that — but one that arrives while the
**next** Run's `call_1` stands answers the wrong question. A request id that is
unique per Run closes it, and that changes what `FrontendRequest` carries, what
the wire answers, and what both surfaces draw.

## What it does not do

It is not the composition root. It does not resolve config — the kernel's
`resolveConfiguration` does, and boot is handed the result — and it does not
decide what a Build carries; the app's table does. It interprets no config
key: `config` is carried to plugins whole, and the model `makeSessionAPI`
starts a Session with is handed in, because the Catalog owns the default. It
ships no plugins.

## API

- `boot(options)` — assembles the kernel and loads the resolved plugins the
  build carries. Options: `scope`, `resolved`, `build?`, `config?`.
- `buildOf(plugins)` — indexes a build's table once into a `Build`:
  `{ all, carries(id) }`.
- `CARRIES_NOTHING` — the empty `Build`; every resolved id comes back missing.
- `runDeps(kernel, emit)` — the `RunDeps` core's `submit` takes, with every
  hook and both budget and recorder slots wired.
- `makeSessionAPI(kernel, model, scope)` — core's `SessionAPI` over this
  kernel, plus `request` for a question a surface must answer.
- `overSurface(kernel, doors)` — the `Approving` a tool call asks through: the
  surface's own `ask` raced against an answer that names the request.
- `harnessHost(kernel, session, emit)` — the `HarnessHost` a native Harness
  is handed: `run` and `report`.
- `runTurn(kernel, input)` — one Run against the resolved model.
- `priorMessages(kernel, session)` — the history, folded from the record.
- Types: `Kernel` (with `missing`), `Build`, `BootOptions`, `TurnInput`,
  `Api`.

## Development

Tests live beside the sources: [boot.test.ts](src/boot.test.ts) holds the
slot traffic, the batch rule, and the `missing` rule, and
[session.test.ts](src/session.test.ts) the Run, refusal, and harness-host
rules. [packages/testkit](../testkit/README.md) boots a plugin through the
real `boot`, and [packages/conformance](../conformance/README.md) holds the
suites that cross plugin boundaries. Run the suite from the repository root:

```bash
bun run test
```

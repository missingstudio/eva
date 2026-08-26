# @missingstudio/eva-conformance

The shared contract test suites of [Eva](../../README.md). When several
implementations must honor one contract — every trace sink numbering a
session's records the same way, every plugin surviving a hot-swap — the suite
that holds them to it lives here, because no plugin may test that for itself.

Eva is built on a plugin kernel: every capability is a plugin, and the layer
rule in [architecture.md](../../docs/reference/architecture.md) says a plugin
may not import another plugin. The place two of them meet — over a live
kernel — is this package. [docs/decisions.md](../../docs/decisions.md)
§"Holding two adapters to one contract is a package, not an app" records why
this is a package, and the glossary in
[docs/context.md](../../docs/context.md) defines the terms used here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The suites drive contracts that are
  expressed as `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

Nothing depends on this package, and it is never added as a dependency: it
holds test files only, and they run with the rest of the suite.

## Usage

Every suite boots a real kernel with the plugins under test — the same
replay order and the same late-bound Slots a run gets — through the
testkit's `withKernel`, which owns the scope and closes it. The Provider is
scripted through `@missingstudio/eva-testkit`, so no suite calls a model, and
`committed` reads the record back through the `TraceSink` contract.

Two suites still call `boot` themselves, because they are not this shape:
`swap.test.ts` boots a kernel that loads nothing and adds plugins mid-Run,
and `harness-host.test.ts` hands out a seam whose scope outlives the call.

An implementation subscribes to a contract by adding one entry to the suite's
table. In [src/sink-contract.test.ts](src/sink-contract.test.ts), every
`TraceSink` is one row, and `describe.each` runs the whole contract against
each:

```ts
const sinks: readonly Row[] = [
  ["eva.trace.memory", () => makeMemorySink()],
  ["eva.trace.jsonl", () => makeJsonlSink(scratch())],
  ["eva.trace.sqlite", () => makeSqliteSink(join(scratch(), "trace.sqlite"))],
]

describe.each(sinks)("the %s sink honors the contract", (_name, make) => {
  // numbering from 1, replay in trace order, refusing appends after close
})
```

A new sink adds its factory to that table and inherits every test. Behavior
only one implementation owes — the jsonl sink's survival of a killed
process — sits in its own `describe` below the shared one.

`eva.trace.postgres` joins both sink tables when `EVA_TEST_POSTGRES_URL`
points at a disposable database, with a fresh schema per sink and every
schema dropped at the end. It is the store the allocation contract exists
for — the only one Eva has with many writers on many machines — so it belongs
here and not only in its own suite. Without a URL it is absent, and the suite
says nothing false about what it proved.

Where implementations are allowed to differ, the suite states the difference
instead of omitting it. `sink-contract.test.ts` holds the row stores to an
exact Header — a later `info` renames the Session — and holds
`eva.trace.jsonl` to the opening intent, because it reads the first line.
That is the shortcut [trace-storage.md](../../docs/reference/trace-storage.md)
priced and accepted, and a test is what keeps it a decision.

## The suites

| Suite                        | What it holds together                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `workflow-validator.test.ts` | The Stage 1 gate: `eva.workflow`, `eva.prompt`, `eva.validator` over a scripted Provider   |
| `workflow-prompt.test.ts`    | A Workflow over the row `eva.prompt` projected, and the refusal when nothing projected it  |
| `catalog.test.ts`            | The models and the Prices, which meet only in a build                                      |
| `compatible.test.ts`         | A compatible endpoint against the Prices and the auth store                                |
| `session-api.test.ts`        | The Session API over the real trace and session stores                                     |
| `sink-contract.test.ts`      | Every TraceSink against one contract, and where they are allowed to differ                 |
| `list-order.test.ts`         | One listing order over every sink, whatever each reads to answer                           |
| `swap.test.ts`               | A Slot hot-swaps mid-Run; a missing capability degrades rather than fails                  |
| `tui.test.ts`                | The shipped bindings against the surface, the shipped theme against the renderer's palette |
| `session-view.test.tsx`      | The terminal's mapping and the page's, over one fold of one Trace                          |

The two suites that gate Stage 1's exit live in
`workflow-validator.test.ts`: a refused Candidate repairs exactly once, with
both verdicts in the Trace and the repair Instruction naming every Fault; and
a build without `eva.validator` reports `unchecked` and a `degraded` record
rather than inventing a validity rate.

`session-view.test.tsx` holds two renderers rather than two plugins, and the
rule is the same one: the terminal is a package and the page is an app, so
neither can reach the other. The two draw different amounts on purpose, so
they are compared over the record facts each drawing names — the page names
every fact of every Block, and whatever the terminal names is a fact the same
Block holds and the page names too.

## What it does not do

It runs no model and re-rolls no distribution: every answer is scripted. The
measured half of the exit test — the canned Workflows against the pinned
model — lives in [packages/exit-test](../exit-test/README.md), not here.

## API

The package exports nothing: no `src/index.ts`, no pack script, test files
only. `vite.config.ts` gives it no import rule on purpose — holding two
adapters to one contract is the job that needs several plugins at once.

## Development

The tests are the package: the suites in [src/](src/). Run them from the
repository root:

```bash
bun run test
```

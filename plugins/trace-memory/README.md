# @missingstudio/eva-trace-memory

The in-memory trace sink for [Eva](../../README.md). It holds the trace in an
array instead of a file: the same contract as
[`eva.trace.jsonl`](../trace-jsonl/README.md), gone with the process. It
exists for test suites that assert on what a Run committed, and to prove that
one sink can replace another mid-Run.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `TraceSink` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines — the same
slot the JSONL sink fills, and exactly one plugin holds a slot at a time. The
glossary in [docs/context.md](../../docs/context.md) defines Trace, Event,
and Session; [architecture.md](../../docs/reference/architecture.md) owns the
slot mechanics.

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

The Eva CLI carries this plugin in its optional table: available by id, but
not loaded unless config names it. To use the package from another workspace
package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-trace-memory": "workspace:*" } }
```

## Usage

Enable the plugin by id in a `.eva` config file. It declares no options:

```yaml
plugins:
  - eva.trace.memory
```

Or add it for one run:

```bash
eva --plugin eva.trace.memory
```

A config entry loads after the built-in table, so this sink takes the
`TraceSink` slot from `eva.trace.jsonl`, and the Recorder's next commit lands
in memory — no restart needed. In tests, `makeMemorySink()` builds the sink
directly.

## How it differs from the JSONL sink

Its `TraceStore` is an array. Core's `sequenced` wraps it with the same
numbering rule every sink inherits, so a record here carries the same trace
position it would carry on disk. But nothing survives the process: the
high-water map is always empty, a fresh sink starts at nothing, and recovery
does not exist here — there is no mark to resume and no torn line to find. A
build that needs to read yesterday's trace needs the JSONL sink.

## API

- `traceMemory` — the plugin definition, id `eva.trace.memory`. It takes no
  options and provides the `TraceSink` slot; unloading the plugin closes the
  sink.
- `makeMemorySink(): Effect<MemorySink>` — the implementation. Beyond the
  `TraceSink` contract it adds one thing: `all()`, everything committed in
  trace order, across every session. That is what the swap suite reads,
  because it is about which sink instance a commit landed in. A test that only
  wants the record reads it through the contract, with the testkit's
  `committed`.

## Development

This package has no test file of its own. It is held from
[packages/conformance](../../packages/conformance):
[sink-contract.test.ts](../../packages/conformance/src/sink-contract.test.ts)
runs the one sink suite over this sink and the JSONL sink, and
[swap.test.ts](../../packages/conformance/src/swap.test.ts) loads it over
`eva.trace.jsonl` mid-Run and holds that the next commit lands here while the
file keeps what it had. Run the suite from the repository root:

```bash
bun run test
```

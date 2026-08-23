# @missingstudio/eva-trace-jsonl

The JSONL trace sink for [Eva](../../README.md). It makes the trace durable:
every event lands in one JSONL file, one record per line, fsynced per group.
Each line is one event encoded as JSON — its id, sequence number, timestamp,
Run, Session, parent, and payload — so the file can be read back, replayed,
and resumed after a crash.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `TraceSink` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines, and the
[`eva.trace`](../trace/README.md) Recorder writes through it. The glossary in
[docs/context.md](../../docs/context.md) defines Trace, Event, and Session;
[architecture.md](../../docs/reference/architecture.md) owns the sink-store
split.

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

The Eva CLI already includes this plugin — it is the default sink, loaded
right after `eva.trace`. To use the package from another workspace package,
add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-trace-jsonl": "workspace:*" } }
```

## Usage

The plugin declares one option, `path`. The default is `~/.eva/trace.jsonl`,
expanded against the home directory. Set another in a `.eva` config file:

```yaml
plugins:
  - id: eva.trace.jsonl
    options: { path: "~/work/trace.jsonl" }
```

One file holds every Session, interleaved, and each Session's records are
numbered from 1. The numbering rule is core's `sequenced`, which wraps the
`TraceStore` this package writes.

`makeJsonlSink(path)` builds the sink directly, without the plugin runtime.
The returned sink has `append`, `replay`, `sessions`, and `close`, plus the
`path` it writes and the `Recovery` it found on open.

## How recovery works

Opening the sink reads the file, takes each Session's high-water mark, and
reports a torn trailing line — the half-written record a killed process
leaves. Every whole record before the tear still counts, and numbering
resumes past the high water. A line that is unreadable anywhere but the end
stops the walk rather than skipping past it, because that is corruption and
not a tear.

## What it does not do

Nothing compacts or rotates the file: it only grows, and every Session shares
the one path unless config sets another. Recovery reports a torn tail and
does not repair it — the bytes stay as the kill left them, and the whole
records before the tear are what a reader gets.

## API

- `traceJsonl` — the plugin definition, id `eva.trace.jsonl`. It reads the
  `path` option and provides the `TraceSink` slot; unloading the plugin
  closes the file.
- `makeJsonlSink(path: string): Effect<JsonlSink>` — the implementation.
  `append` writes a group as lines and fsyncs before returning; `replay`
  yields one Session's events in trace order; `sessions` names every Session
  on disk.
- `DEFAULT_PATH` — `"~/.eva/trace.jsonl"`.
- `recover(source: string): Recovery` — the recovery walk over a file's
  text: per-Session high-water marks and whether the last line is torn.
- `readTrace(path: string): string` — reads the file; an absent file reads
  as empty.

## Development

Tests live in [src/sink.test.ts](src/sink.test.ts): numbering per Session,
resuming across processes, replay, listing, and the torn-tail cases. Every
`TraceSink` implementation is also held to one contract in
[packages/conformance/src/sink-contract.test.ts](../../packages/conformance/src/sink-contract.test.ts).
Run the suite from the repository root:

```bash
bun run test
```

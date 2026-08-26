# @missingstudio/eva-trace-jsonl

The JSONL trace sink for [Eva](../../README.md): a directory with one
append-only file per Session, one JSON record per line. It is the file
posture — a Trace a person can `grep`, `tail`, and `cp` one Session out of.
The default sink is [`eva.trace.sqlite`](../trace-sqlite/README.md);
[docs/reference/trace-storage.md](../../docs/reference/trace-storage.md) owns
that decision and the measurements behind it.

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

The Eva CLI carries this plugin but does not load it by default. To run on
files, turn the default sink off and this one on:

```yaml
plugins:
  - { id: eva.trace.sqlite, disabled: true }
  - id: eva.trace.jsonl
    options: { dir: "~/work/trace" }
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-trace-jsonl": "workspace:*" } }
```

## Usage

The plugin declares two options:

- `dir` — where the Trace lives. Default `~/.eva/trace`. Each Session is one
  file inside it, `<session>.jsonl`, numbered from 1.
- `fsync` — whether each committed group is fsynced before the commit
  returns. Default `true`.

One Session per file makes the unit of read, the unit of delete, and the
unit of corruption all one Session: replay reads one file, deleting a Session
is `unlink`, and a bad line costs the records after it in that file alone.

`makeJsonlSink(dir, { fsync })` builds the sink directly, without the plugin
runtime. The returned sink has `append`, `replay`, `sessions`, `headers`,
`highWater`, and `close`, plus the `dir` it writes.

## How recovery works

A Session's high water is read from its own file on the first touch, so
opening the sink reads nothing. A killed process can leave a half-written
last line; every whole record before it still counts, and numbering resumes
past them. A line that is unreadable anywhere but the end is corruption, not
a tear — the walk stops there rather than skipping past it, and only that
Session pays.

## What the listing costs

`headers` answers the session list from each file's first line and its
`mtime`: the title is the intent the Session opened on, and the update time
is the last append. Two shortcuts, both real: an `info` that renames a
Session late is missed, and `mtime` does not survive `cp -r` or a restore
from backup — ordering degrades to file order on a copied Trace. A fold over
`replay` stays the correct answer; this is only the fast one.

This is the one place the sinks are allowed to differ, and the conformance
suite states it rather than leaving it to be found: the row stores answer a
Header exactly, and this one answers from the first line. Neither is an
accident.

## What `fsync` buys

Durability against a killed process, not against power loss. On Bun,
`fsync(2)` does not flush the drive's write cache on macOS — `F_FULLFSYNC`
would, and Bun does not ask for it, while Node's libuv does. A group is
therefore safe against `kill -9`, which is what torn-tail recovery is built
for. If the machine loses power mid-commit, the tail may be torn or absent.

## What it does not do

Nothing compacts a Session's file: it only grows. Numbering is held in
memory per process, so two Eva processes over one directory can collide —
the SQLite sink allocates in a transaction and cannot.

## API

- `traceJsonl` — the plugin definition, id `eva.trace.jsonl`. It reads `dir`
  and `fsync` and provides the `TraceSink` slot; unloading the plugin closes
  every open file.
- `makeJsonlSink(dir: string, options?: JsonlSinkOptions): Effect<JsonlSink>`
  — the implementation.
- `DEFAULT_DIR` — `"~/.eva/trace"`.
- `fileOf(dir, session)` — the path a Session's records live at.
- `recover(source: string): Recovery` — the recovery walk over one file's
  text: high-water marks and whether the last line is torn.
- `readTrace(path: string): string` — reads a file; an absent file reads as
  empty.

## Development

Tests live in [src/sink.test.ts](src/sink.test.ts): numbering per Session,
resuming across processes, replay, the listing order, and the torn-tail and
corrupt-line cases. Every `TraceSink` implementation is also held to one
contract in
[packages/conformance/src/sink-contract.test.ts](../../packages/conformance/src/sink-contract.test.ts)
and one listing order in
[packages/conformance/src/list-order.test.ts](../../packages/conformance/src/list-order.test.ts).
Run the suite from the repository root:

```bash
bun run test
```

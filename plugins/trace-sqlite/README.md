# @missingstudio/eva-trace-sqlite

The default trace sink for [Eva](../../README.md): every Event in one SQLite
database, in WAL mode, through `node:sqlite` — no dependency, no native build
step, and it runs under Bun, Node, and a `bun build --compile` binary. Each
record's trace position is allocated inside the write transaction, so a
duplicate position is impossible rather than unlikely, and a second Eva
process on the same file cannot collide.
[docs/reference/trace-storage.md](../../docs/reference/trace-storage.md) owns
the decision and the measurements: against a 966 MB corpus this store answers
a session list in about a millisecond and one Session's replay in about
twelve, where the old one-file Trace took seconds for either.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `TraceSink` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines, and the
[`eva.trace`](../trace/README.md) Recorder writes through it.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer, or [Node](https://nodejs.org) 22.13
  or newer — the floor at which `node:sqlite` needs no flag.
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
{ "dependencies": { "@missingstudio/eva-trace-sqlite": "workspace:*" } }
```

## Usage

The plugin declares three options:

- `path` — where the database lives. Default `~/.eva/trace.sqlite`.
- `synchronous` — `normal` or `full`. Default `normal`: a committed group
  survives a killed process. `full` also survives the OS going down
  mid-commit, at a few hundred microseconds a group.
- `import` — a one-file JSONL trace to load when the store holds nothing.
  At the default `path` this defaults to `~/.eva/trace.jsonl`, so a Trace
  written before this sink existed migrates on first open, keeping every
  trace position, and is never read again. A store at any other `path`
  imports only what config names.

```yaml
plugins:
  - id: eva.trace.sqlite
    options: { path: "~/work/trace.sqlite", synchronous: full }
```

`makeSqliteSink(path, { synchronous, importFrom })` builds the sink directly,
without the plugin runtime. The returned sink has `append`, `replay`,
`sessions`, `headers`, `highWater`, and `close`, plus the `path` it writes,
`imported` — how many records the import contributed at this open — and
`rebuilt`, how many Sessions had a Header folded again at this open.

## The store

Two tables, and both are core's shared row shape: `eva.trace.postgres` keeps
the same columns, so a row means the same thing in either and a Trace moves
between them unchanged. `event` holds every record under
`PRIMARY KEY (session, seq)` `WITHOUT ROWID`, with the payload as the codec's
JSON — a row and a JSONL line hold the same bytes per field, and decode
through the same rules. `session_head` holds each Session's high water, made
durable instead of held in one process's memory, with the Session's title and
update time beside it — so `headers` answers from one row per Session and
never replays anything.

What this store decides for itself is the lock: `BEGIN IMMEDIATE`, which is
what one machine's file has where Postgres has a row lock. The allocation
happens inside it, so a second Eva process on the same file cannot claim a
taken position — and because `id` is unique, a group committed twice answers
with the positions it already holds rather than taking new ones.

## When the Header rule moves

A head row records which `headerStep` rule folded it. A row written under an
older rule is not read as current: the next open folds it again from the
events it summarizes, and says how many in `rebuilt`. A cached fold that
cannot say which rule wrote it is a listing that goes quietly wrong the first
time the rule changes.

## What it does not do

`follow` is in-process: a page served by one Eva process does not yet hear
what another process commits, it only cannot corrupt it. Nothing is removed
or compacted yet either — but deleting a Session is now a `DELETE`, not a
rewrite of everything else.

## API

- `traceSqlite` — the plugin definition, id `eva.trace.sqlite`. It reads
  `path`, `synchronous`, and `import`, and provides the `TraceSink` slot;
  unloading the plugin closes the database.
- `makeSqliteSink(path: string, options?: SqliteSinkOptions): Effect<SqliteSink>`
  — the implementation.
- `DEFAULT_PATH` — `"~/.eva/trace.sqlite"`.
- `LEGACY_PATH` — `"~/.eva/trace.jsonl"`, where the one-file Trace lived.

## Development

Tests live in [src/sink.test.ts](src/sink.test.ts): resuming across
processes, a second writer on the same file, the listing order, and the
legacy import. Every `TraceSink` implementation is also held to one contract
in
[packages/conformance/src/sink-contract.test.ts](../../packages/conformance/src/sink-contract.test.ts)
and one listing order in
[packages/conformance/src/list-order.test.ts](../../packages/conformance/src/list-order.test.ts).
Run the suite from the repository root:

```bash
bun run test
```

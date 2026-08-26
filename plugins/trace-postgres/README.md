# @missingstudio/eva-trace-postgres

The hosted trace sink for [Eva](../../README.md): the same store the
[SQLite sink](../trace-sqlite/README.md) keeps, on a Postgres server —
`event` under `PRIMARY KEY (session, seq)`, a `session_head` row beside it,
and every trace position allocated inside the write transaction behind the
head row's lock, so writers on many machines cannot claim one position.
Tenancy is a posture, not a fork: this plugin fills the same `TraceSink`
slot the local sinks fill, chosen by config, and a Trace it stores is
record-for-record the Trace they store.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer, or [Node](https://nodejs.org) 22.13
  or newer.
- A PostgreSQL server, 12 or newer, and a connection URL for it.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI carries this plugin but does not load it by default. To run
hosted, turn the default sink off and this one on:

```yaml
plugins:
  - { id: eva.trace.sqlite, disabled: true }
  - id: eva.trace.postgres
    options: { schema: eva, pool: 4 }
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-trace-postgres": "workspace:*" } }
```

## Usage

The plugin declares three options:

- `url` — the connection string. When config does not carry one, the
  `EVA_POSTGRES_URL` environment variable answers, because a URL holds a
  password and the environment is where a deployment puts one. Without
  either, the plugin provides nothing: the slot stays empty and a Run that
  commits says `degraded`, rather than this plugin guessing at a localhost.
- `schema` — the Postgres schema the tables live under. Default `eva`, so
  one database can hold one Eva per schema. Letters, digits and underscores
  only.
- `pool` — how many connections are held. Default 4. Writes serialize per
  Session on a row lock either way; this bounds the concurrent reads.

The tables are created at open when they are missing, and they are core's
shared row shape — the same columns `eva.trace.sqlite` keeps, so a row means
the same thing in either and a Trace moves between them unchanged. `headers`
answers from one row per `session_head` and never replays anything.

What this store decides for itself is the lock. The head row is upserted
first, which is an insert-or-lock: a fresh Session gets a row at zero, a
known one comes back locked, and either way a second writer — another
machine — waits there rather than claiming a taken position. Because `id` is
unique, a group committed twice answers with the positions it already holds
rather than taking new ones.

A head row records which `headerStep` rule folded it. A row written under an
older rule is folded again at the next open, and `rebuilt` says how many.

`makePostgresSink(url, { schema, pool })` builds the sink directly, without
the plugin runtime.

## What it does not do

`follow` is in-process: `LISTEN`/`NOTIFY` is designed but not built, so a
surface hears live commits only from the process it is attached to. Cold
Events stay in Postgres; the sealed-segment split to object storage is later
work, and [trace-storage.md](../../docs/reference/trace-storage.md) records
both decisions.

## API

- `tracePostgres` — the plugin definition, id `eva.trace.postgres`. It reads
  `url`, `schema`, and `pool`, and provides the `TraceSink` slot; unloading
  the plugin ends the pool.
- `makePostgresSink(url: string, options?: PostgresSinkOptions): Effect<PostgresSink>`
  — the implementation.
- `URL_VARIABLE` — `"EVA_POSTGRES_URL"`.

## Development

The tests in [src/sink.test.ts](src/sink.test.ts) run against a real server,
because a fake proves nothing about allocation under concurrent writers.
Point `EVA_TEST_POSTGRES_URL` at a disposable database to run them; without
one the suite skips. Each run works in a schema of its own and drops it at
the end.

```bash
EVA_TEST_POSTGRES_URL=postgres://localhost/eva_test bun run test
```

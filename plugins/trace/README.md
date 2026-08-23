# @missingstudio/eva-trace

The trace recording plugin for [Eva](../../README.md). It provides the
Recorder: the one path an event takes to the trace. The Recorder opens a Run,
stamps each payload with its envelope — the event id, the wall-clock time, and
the Run, Session, and parent keys — commits the group to the loaded trace
sink, and closes the Run with a claim. Where the records land is another
plugin's job.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `Recorder` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines, and it
reads the `TraceSink` slot that a sink plugin such as
[`eva.trace.jsonl`](../trace-jsonl/README.md) fills. The glossary in
[docs/context.md](../../docs/context.md) defines Trace, Recorder, and Event;
[architecture.md](../../docs/reference/architecture.md) owns the slot
mechanics.

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

The Eva CLI already includes this plugin. It loads first in the built-in
table, because everything records. To use the package from another workspace
package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-trace": "workspace:*" } }
```

## Usage

The plugin declares no options, so there is nothing to configure. The CLI
loads it by default; `eva --without-plugin eva.trace` skips it for one run.
With the Recorder slot empty, a Run still answers — it records nothing and
reports a `degraded` outcome naming the slot.

`makeRecorder` builds a `Recorder` directly, without the plugin runtime:

```ts
import { makeRecorder } from "@missingstudio/eva-trace"
import { shortID } from "@missingstudio/eva-core"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const recorder = yield* makeRecorder({
    // Read at every commit, never captured: replacing the sink moves
    // the next commit into the new sink.
    sink: Effect.succeed(sink),
    now: () => ({ wall: new Date().toISOString() }),
    nextID: shortID,
  })

  const run = yield* recorder.open(sessionId)
  yield* recorder.commit(payloads)
  yield* recorder.close({ result: "done" })
})
```

`RecorderDeps` also takes an optional `published` callback, run after a group
commits, so a caller can follow what landed. The plugin passes none — the
live stream a surface watches is published by `packages/boot` from its own
hub, not through here.

## How a Run records

`commit` hands each group to the sink whole, so a group lands entire or not
at all. A commit that finds the `TraceSink` slot empty records nothing and
remembers what was missing; `close` then commits a `degraded` payload naming
`TraceSink` in the same group as the `finished` record, so a reader never
sees a Run close clean that did not. A `commit` with no open Run dies with
`RunNotOpenError` — that is a caller's bug, not a degraded outcome.

`close` is idempotent: nothing else may close a Run, and a second close does
nothing. The Recorder stamps no trace position — `seq` leaves here as 0, and
the sink's `sequenced` rule numbers each record.

## API

- `trace` — the plugin definition, id `eva.trace`. It takes no options and
  provides the `Recorder` slot.
- `makeRecorder(deps: RecorderDeps): Effect<Recorder>` — the implementation.
  The returned `Recorder` has `open(session)`, `commit(payloads)`, and
  `close(claim, stopReason?)`.
- `RunNotOpenError` — the defect a `commit` with no open Run dies with.

## Development

This package has no test file of its own. The behaviour is contract
behaviour, held by the suites that boot a live kernel in
[packages/conformance/src/swap.test.ts](../../packages/conformance/src/swap.test.ts):
a mid-Run sink swap lands the next commit in the new sink, and a Run with no
sink still closes, with the `degraded` caveat in the same group as the
`finished` record.
[apps/cli/src/plugins.test.ts](../../apps/cli/src/plugins.test.ts) holds that
`eva.trace` loads before `eva.trace.jsonl`. Run the suite from the repository
root:

```bash
bun run test
```

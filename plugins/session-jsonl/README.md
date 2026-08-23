# @missingstudio/eva-session-jsonl

The session store plugin for [Eva](../../README.md). It creates, opens,
folds, and lists Sessions — and stores nothing of its own. Every answer is a
fold over the trace, read back through the loaded trace sink, so a Session is
never written twice: the records already in the sink are the transcript.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `SessionStore` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines, and it
reads whatever sink holds the `TraceSink` slot — in the default build, the
JSONL file [`eva.trace.jsonl`](../trace-jsonl/README.md) writes. The glossary
in [docs/context.md](../../docs/context.md) defines Session, Header, and
Trace: the trace is the single source of truth, and anything a trace cannot
rebuild is a bug.

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

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-session-jsonl": "workspace:*" } }
```

## Usage

The plugin declares no options, so there is nothing to configure. In code,
`makeSessionStore` builds the store directly:

```ts
import { makeSessionStore } from "@missingstudio/eva-session-jsonl"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  // The sink is read at the point of use, so replacing the sink
  // plugin moves the next fold.
  const store = yield* makeSessionStore({ sink: Effect.succeed(sink) })

  const session = yield* store.create
  const transcript = yield* store.fold(session.id)
  const headers = yield* store.list
})
```

What each method does:

- `create` mints a fresh SessionID and remembers it in this process, so a
  new Session is listed before anything commits.
- `open` replays the Session's events and answers its Header — a fold, since
  nothing stores one.
- `fold` replays and folds the transcript. The optional `prices` dependency
  is the PriceLookup boot derives from the catalog (`ctx.prices` in the
  plugin), so the fold can answer a cost estimate; without one the estimate
  is absent rather than guessed.
- `list` unions the Sessions the sink holds with the ones this process
  opened. An empty `TraceSink` slot lists nothing rather than failing.

## What it does not do

Nothing here parses JSONL. The records arrive through the `TraceSink` slot,
and this package works over whatever sink is loaded — the id names its
pairing with `eva.trace.jsonl` in the default build, not a format it
implements. `create` persists nothing either: a Session with no committed
event exists only in this process, and a restart forgets it was ever created.

## API

- `sessionJsonl` — the plugin definition, id `eva.session.jsonl`. It takes
  no options and provides the `SessionStore` slot.
- `makeSessionStore(deps: SessionStoreDeps): Effect<SessionStore>` — the
  implementation. The returned store has `create`, `open(id)`, `fold(id)`,
  and `list`.

## Development

Tests live in [src/store.test.ts](src/store.test.ts): listing unions disk
and process, an empty slot lists nothing, a fold gives Messages back from
events, and a sink swap moves the next fold.
[packages/conformance/src/session-api.test.ts](../../packages/conformance/src/session-api.test.ts)
boots this plugin behind the Session API against a real JSONL sink. Run the
suite from the repository root:

```bash
bun run test
```

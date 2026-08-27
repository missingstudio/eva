# @missingstudio/eva-client-runtime

Every non-visual client concern of [Eva](../../README.md), in one package, so
that a terminal, a web page, a desktop shell and a phone differ only in
platform and pixels.

A surface talks to Eva through the `SessionAPI`, and the order of those calls
is a protocol. Two surfaces wrote that protocol twice and disagreed about it:
the terminal stopped its drain on a bound, and the print path waited on a
close that a watcher which subscribed too late never hears. This package holds
the protocol once. It knows what the server needs to hear about, and no
pixels — it imports the contracts and nothing that draws.

It starts with two domains — the Run, and the connection it runs over — and
takes another when a real consumer needs one.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- A `SessionAPI`. The composition root gives a surface one; see
  [@missingstudio/eva-core](../core/README.md).

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-client-runtime": "workspace:*" } }
```

## Usage

A surface holds one `Client`: the whole session contract, plus the protocol
over it. The composition root builds it where it builds the API, and hands it
on. `client.api` is the same `SessionAPI` shape, so a consumer that only reads
the contract — a command, say — takes the handle and changes nothing of its
own:

```ts
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"

const client = yield * makeClient(yield * localTransport(api))
const record = yield * client.run(session, { kind: "prompt", text: line }, each)
```

`each` is given one queue of `RunSignal`, and there are two of them. A
`payload` is a word of the live stream. A `folded` is the record taking that
stream's place — repaint from it, because everything before it arrived through
it. What a surface does with them stays with the surface — a spinner, a line of
stdout, or a repaint:

```ts
const record =
  yield *
  client.run(session, { kind: "prompt", text: line }, (signal) => {
    if (signal.kind === "folded") return repaint(signal.transcript)
    const { payload } = signal
    if (payload.kind === "text" && payload.content.type === "text") write(payload.content.text)
  })
```

A surface that only reads a Session takes `follow` instead. It answers the same
two signals and never ends on its own, so a caller stops it by interrupting:

```ts
const following = yield * Effect.forkChild(client.follow(session, each))
```

`follow` folds, watches to the close of the Run that is open, and folds again —
the same rule `run` reaches after a drop. It is here rather than at a surface
because it is the runtime's: which positions are honest, what a refused Cursor
means, and when the pipe is worth mentioning. A page that spelled it again
could not say `synchronizing`, because only the runtime knows it is refolding.

The four steps, and why each one is there:

1. **Subscribe.** The watcher is forked before `submit`, so a Run that says
   its first word at once is heard.
2. **Submit.** An interrupt while the Run is open cancels it, so being asked
   to stop keeps the partial work.
3. **Drain in a bound.** `submit` is what says the Run is over: it does not
   return until the Run has closed. The watcher gets `SETTLE` — 2000 ms, or
   `options.settle` — and is then stopped rather than waited on. A drain that
   has not finished by then is a subscription that never started, and waiting
   on one waits forever.
4. **Fold.** `attach` gives the record. Its `at` is the position a reconnect
   resumes from.

### The transport

Where the `SessionAPI` lives is not the runtime's business. A `Transport` is
the whole contract plus the one fact the runtime reads about the pipe:

```ts
import { localTransport } from "@missingstudio/eva-client-runtime"

const transport = yield * localTransport(api)
const client = yield * makeClient(transport)
```

`health` is `ready` or `disconnected`. A drop says what it has to say where it
can be acted on: `health` changes, and every open `watch` ends. It says nothing
through an error channel — `SessionAPI` has none — so a call made while the
pipe is down waits until it is ready. The call is slower, never differently
typed, and a consumer that only calls methods needs no new handling.

`localTransport` is the in-process filler: the API untouched, and a `health`
that is born `ready` and never leaves it. `droppableTransport` is the same
filler that can be told to lose its pipe, and it ships here rather than in a
test file because it is the seam's own proof:

```ts
const transport = yield * droppableTransport(api)
yield * transport.drop // every open watch ends; new calls are held
yield * transport.restore // the held calls run
```

### A dropped connection costs a repaint

`client.state` is the three values a surface acts on: `ready`,
`synchronizing`, `disconnected`. The transport says two, because a pipe knows
only whether it is there; catching up is the runtime's own phase.

While a Run is open and the pipe goes, the live watch dies with it and the
state reads `disconnected`. When the pipe returns, the state reads
`synchronizing` and the runtime does one sequence:

1. **Fold fresh, with `attach`** — never a remembered live position.
2. **Say the record replaced the stream.** That is the `folded` signal, and it
   is the caller's one repaint.
3. **Watch from the fold's own `at`.** Committed groups after that position,
   exactly once.
4. **`ready`.**

A `ResumeTooFarBehind` never reaches the caller: the runtime answers it with
another fold from the new position, so what arrives is one more repaint. While
no Run is open there is nothing to synchronize, so `ready` follows
`disconnected` directly and nothing is folded at anyone.

Why each of those is the answer rather than another one is in
[decisions.md](../../docs/decisions.md).

## What it does not do

It draws nothing and imports nothing that draws. It speaks no wire: the seam is
the shape a wire plugs into, not an HTTP client. It does not retry, back off, or
probe — the local pipe cannot flap and the double drops when told, so a backoff
ladder and a foreground probe are tuned to nothing here; they arrive with the
filler that has a wire. It caches nothing: the record is folded on demand,
because a cached read model is a domain of its own and gets added when a
consumer needs it.

## Development

The protocol's rules live in [run.test.ts](src/run.test.ts), the handle's in
[client.test.ts](src/client.test.ts), the seam's in
[transport.test.ts](src/transport.test.ts) and the reconnect's in
[reconnect.test.ts](src/reconnect.test.ts), all against the fake `SessionAPI`
in [fake-api.ts](src/fake-api.ts). Run the suite from the repository root:

```bash
bun run test
```

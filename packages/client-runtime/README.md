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

It starts with one domain, the Run, and takes another when a real consumer
needs one.

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

`runPrompt` opens one Run and gives back the record that replaces its stream.
Every payload the Run says reaches `each`, the close included, and what a
surface does with them stays with the surface — a spinner, a line of stdout,
or a repaint:

```ts
import { runPrompt } from "@missingstudio/eva-client-runtime"

const transcript =
  yield *
  runPrompt(api, session, { kind: "prompt", text: line }, (payload) => {
    if (payload.kind === "text" && payload.content.type === "text") write(payload.content.text)
  })
```

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

## What it does not do

It draws nothing and imports nothing that draws. It knows no transport, and it
caches nothing: the record is folded on demand, because a cached read model is
a domain of its own and gets added when a consumer needs it.

## Development

The protocol's rules live in [run.test.ts](src/run.test.ts), against a fake
`SessionAPI`. Run the suite from the repository root:

```bash
bun run test
```

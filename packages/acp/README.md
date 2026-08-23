# @missingstudio/eva-acp

The [Agent Client Protocol](https://agentclientprotocol.com) in Effect, for
[Eva](../../README.md): the pinned wire schema, stdio JSON-RPC line framing,
and the mapping from ACP session updates to the one Event schema's Payloads.
A harness such as Claude Code speaks ACP; Eva records Payloads; this package
is the seam between the two.

Eva is built on a plugin kernel: every capability is a plugin, and the
harness contract is ACP, not one Eva invents — `@missingstudio/eva-core`'s
Harness contract imports its capability and permission types from here, which
is why core sits above this package in the layer rule of
[architecture.md](../../docs/reference/architecture.md). The glossary in
[docs/context.md](../../docs/context.md) defines the terms, and
[docs/decisions.md](../../docs/decisions.md) records the bet and every
mapping rule below.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). `payloads` maps one Effect `Stream` to
  another.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-acp": "workspace:*" } }
```

## Usage

`payloads` turns one ACP session update stream into one Payload stream, and
assigns the block index ACP does not carry:

```ts
import { payloads, toStopReason } from "@missingstudio/eva-acp"
import { Effect, Stream } from "effect"

const updates = Stream.fromIterable([
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
  { sessionUpdate: "agent_message_chunk", content: { type: "text", text: ", world" } },
])

// Two text payloads, both in block 0
const collected = await Effect.runPromise(Stream.runCollect(payloads(updates)))

// The Stop Reason arrives on the session/prompt result, not as an update
toStopReason({ stopReason: "end_turn" }) // "end_turn"
```

## How the mapping works

`PROTOCOL_VERSION` pins protocol v1 and `SDK_VERSION` pins
`@agentclientprotocol/sdk` 1.3.0, the release this package was verified
against. A test suite holds the pin against the SDK's own schema, so a bump
of either is a reviewed change. `SESSION_UPDATE_KINDS` names the eleven
stable session update kinds and `DRAFT_SESSION_UPDATE_KINDS` the two the SDK
ships ahead of the spec.

A Block holds chunks of one kind, and adjacency is a fact of the stream, so
the stream owns the index: a kind change advances it, and a tool call between
two runs of text makes two blocks. Anything the protocol does not define — a
draft kind, a foreign kind, a body that fails its own schema — is preserved
as `unknown`, never dropped, because the payload union must carry an ACP
session with no loss.

ACP reports cost as a cumulative decimal with a currency, so it maps to
`info.costTicks` — a level, never the `usage` a fold adds — and only USD
converts to Ticks, because a converted figure is not the provider's own.
Running totals do not sum: session costs of $0.01, $0.03, $0.05 fold to
$0.05, not $0.09.

## What it does not do

It is not a running Transport: nothing here spawns a Harness, correlates a
request to its response, or reads a wire. The plugin that drives a Harness
over ACP stdio brings that loop, and none exists yet. The two draft kinds
stay `unknown` until the spec defines them. `usage_update`'s occupancy
figures (`used`, `size`) are not recorded — the union has no kind for them.

## API

- `payloads(updates)` — one ACP session update stream, one Payload stream,
  with the block index assigned.
- `toStopReason(result)` — the Stop Reason on a `session/prompt` result; a
  reason the protocol does not define stays absent rather than guessed.
- `encodeMessage(message)` / `decodeMessage(line)` — JSON-RPC framed as one
  message per line; a torn line raises `FramingError`.
- `PROTOCOL_VERSION`, `SDK_VERSION` — the pins.
- `SESSION_UPDATE_KINDS`, `DRAFT_SESSION_UPDATE_KINDS` — the stable and draft
  update kinds.
- Types: `AgentCapabilities`, `ClientCapabilities`, `PermissionRequest`,
  `PermissionOutcome`, `JsonRpcMessage`, `SessionUpdateKind` — the capability
  and permission shapes core's Harness contract imports.

## Development

Tests live beside the sources: [protocol.test.ts](src/protocol.test.ts) holds
the pin against the installed SDK and the framing round-trips, and
[mapping.test.ts](src/mapping.test.ts) maps every stable kind, the block
boundaries, and the cost rule. Run the suite from the repository root:

```bash
bun run test
```

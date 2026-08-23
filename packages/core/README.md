# @missingstudio/eva-core

The shared contracts of [Eva](../../README.md). Every type that both the
kernel and the SDK need lives here: the extension points a plugin registers
into, the contracts a plugin implements, the shape of the work, and the shape
of the record it leaves behind.

Eva is built on a plugin kernel, and the kernel may not import the SDK, nor
the SDK the kernel — the layer rule in
[architecture.md](../../docs/reference/architecture.md) holds. So the types
they share live in a package below both. If you write a plugin, an
implementation of a slot, or an embedding of Eva, the types you implement come
from here. The glossary in [docs/context.md](../../docs/context.md) defines
each term.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The contracts are expressed as `Effect`
  values.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-core": "workspace:*" } }
```

## Usage

Import the contract you implement, and the compiler holds you to it. A trace
sink, for example, is a `TraceSink`; a model client is a `Provider` with one
`turn` method:

```ts
import type { Provider, TraceSink } from "@missingstudio/eva-core"
```

Two mechanisms live beside the types, because every implementation owes the
same rule:

- `submit(deps, input)` runs one Run: open through the Recorder, resolve the
  model, read one provider turn, commit its payloads in block groups, close
  with a claim. An empty Recorder slot is legal — the Run records nothing,
  reports `degraded` naming the slot, and still answers.
- `sequenced(store)` turns a `TraceStore` into a `TraceSink`: it merges text
  chunks, numbers each event one past its session's high water, and moves the
  high water only once the write is durable.
- `foldTranscript(events)` folds a session's trace into the `Transcript` a
  surface displays.

## What is in each module

| Module           | What it holds                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `extension.ts`   | The extension-point shapes: `Domain`, `Slot`, `Hooks`, `Broadcast`, `Registration`, the `Row` draft     |
| `contracts.ts`   | What fills the slots: `Recorder`, `TraceSink`, `SessionStore`, `CredentialStore`, `Budget`, `Validator` |
| `spec.ts`        | The work: `Spec`, `Outcome`, the budget shapes, `ModelRef`, `Usage`                                     |
| `transcript.ts`  | `Session`, `Transcript`, and `foldTranscript`                                                           |
| `provider.ts`    | The `Provider`: one `turn` method that begins a provider turn                                           |
| `harness.ts`     | The harness contract, in the Agent Client Protocol's shapes                                             |
| `session-api.ts` | The whole of what a surface may do to Eva                                                               |
| `session.ts`     | `submit`, the one-Run mechanism                                                                         |
| `sink.ts`        | `sequenced`, the store-to-sink mechanism                                                                |

## What it does not do

Nothing here fills a slot. The Recorder, the sinks, the session and credential
stores, the Validator, and every Provider are plugins. `submit` is one step
with no tools and no agency: a tool-calling loop belongs to a harness, and a
harness is a plugin too. And nothing here loads plugins — the plugin runtime
is the kernel's.

## Development

Tests live beside the sources: [session.test.ts](src/session.test.ts) holds
the Run rules, [hooks.test.ts](src/hooks.test.ts) the hook and budget-charge
rules, [sink.test.ts](src/sink.test.ts) the sequencing rules, and
[transcript.test.ts](src/transcript.test.ts) folds the reviewed goldens in
`../schema/fixtures`. Every `TraceSink` implementation is also held to one
contract in
[packages/conformance](../conformance/README.md). Run the suite from the
repository root:

```bash
bun run test
```

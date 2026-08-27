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
- `sinkOf(store)` turns a store into a `TraceSink`, and it is the only
  composition a sink author or a test spells. It merges text chunks before
  the store numbers them, hands committed records to their followers, folds
  `headers` for a store that keeps none, and refuses a group after the
  close. A store that can number inside the act that makes a group durable
  writes `TraceStore` and owns its allocation; one that cannot writes
  `StampedStore` and is numbered in this process. `sequenced` and `numbered`
  are the internal seams behind it.
- `rows.ts` holds the row-shaped store the two SQL sinks share: the columns,
  the codec both ways, the head row with the fold rule that wrote it, and
  the allocation arithmetic. They differ only in the lock.
- `archive.ts` reads a Trace back from JSONL — one file or a directory of
  per-Session files — so nothing else has to ask which shape it holds.
- `foldTranscript(events)` folds a session's trace into the `Transcript` a
  surface displays.

## What is in each module

| Module           | What it holds                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension.ts`   | The extension-point shapes: `Domain`, `Slot`, `Hooks`, `Broadcast`, `Registration`, the `Row` draft                                                      |
| `contracts.ts`   | What fills the slots: `Recorder`, `TraceSink`, `SessionStore`, `CredentialStore`, `Budget`, `Validator`, `FileSystem`, `Shell`, `Sandbox`, `DiffApplier` |
| `spec.ts`        | The work: `Spec`, `Outcome`, the budget shapes, `ModelRef`, `Usage`                                                                                      |
| `transcript.ts`  | `Session`, `Transcript`, and `foldTranscript`                                                                                                            |
| `provider.ts`    | The `Provider`: one `turn` method that begins a provider turn                                                                                            |
| `harness.ts`     | The harness contract, in the Agent Client Protocol's shapes                                                                                              |
| `session-api.ts` | The whole of what a surface may do to Eva                                                                                                                |
| `session.ts`     | `submit`, the one-Run mechanism                                                                                                                          |
| `deciding.ts`    | The words a gate reasons in: `ToolCall`, `ToolDecision`, `strictest`, `settled`, the four options, `editOf`                                              |
| `invocation.ts`  | What a call would run, in the one reading every gate takes: `Invocation`, `argvOf`, `invocationsIn`, `grantableWords`                                    |
| `tool.ts`        | One tool call and one group of them: the execution and the schedule                                                                                      |
| `sink.ts`        | `sinkOf`, the one store-to-sink entry, over the `sequenced` and `numbered` seams                                                                         |
| `rows.ts`        | The row-shaped store both SQL sinks keep: columns, codec, head row, allocation                                                                           |
| `glob.ts`        | `globMatcher`: what a glob pattern means, for every `FileSystem` filler                                                                                  |
| `archive.ts`     | Reading a Trace back from JSONL, one file or a directory of them                                                                                         |

## What it does not do

Nothing here fills a slot. The Recorder, the sinks, the session and credential
stores, the Validator, the file system, the shell, the sandbox, and every
Provider are plugins. `submit` is one Step — one model request, and the calls
that response proposed — and it has no agency of its own: the loop that asks
for another Step belongs to a harness, and a harness is a plugin too. And
nothing here loads plugins — the plugin runtime is the kernel's.

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

# @missingstudio/eva-schema

The one Event schema of [Eva](../../README.md), and the folds over it. Every
record a run leaves behind is an `Event` carrying a `Payload` from one closed
union, and every projection a surface shows — transcript, cost, header,
verdict, answer — is a fold over that trace.

Eva is built on a plugin kernel: every capability is a plugin, and this
package is the shape they all record and read. The glossary in
[docs/context.md](../../docs/context.md) defines **Event**, **Trace**, and
**Fold Keys**: there is exactly one Event schema, this package is it.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.

## Installation

Install once at the repository root:

```bash
bun install
```

To use the package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-schema": "workspace:*" } }
```

## Usage

Decode a trace line by line, then fold one session's events into the
projections a surface shows:

```ts
import { readFileSync } from "node:fs"
import { costFold, decodeLine, transcriptFold } from "@missingstudio/eva-schema"

const lines = readFileSync("packages/schema/fixtures/synthetic.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
const events = lines.map(decodeLine)

// One session of the reviewed fixture
const own = events.filter((event) => event.session === "sess_synth_tools")
const messages = transcriptFold(own)
const cost = costFold(own)
```

## What each family is for

| Module       | What it holds                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payload.ts` | The sealed `Payload` union: twenty-one kinds, closed, so a `switch` over `kind` with no `default` is exhaustive                                                                                  |
| `event.ts`   | The envelope: `Event`, `SCHEMA_VERSION`, `seq`, and the Fold Keys every projection groups by                                                                                                     |
| `id.ts`      | The branded ids: `EventID`, `RunID`, `SessionID`, `TenantID`                                                                                                                                     |
| `codec.ts`   | The wire: `decodeLine` and `encodeLine`, one strict zod body per kind, tied to the union at compile time                                                                                         |
| `cost.ts`    | The unit: Ticks, integers of 1e-10 USD — `toTicks`, `toUsd`, `estimateTicks`, `ModelPrice`, `PriceLookup`                                                                                        |
| `fold.ts`    | The projections: `mergeText`, `transcriptFold`, `costFold`, `headerFold`, `verdictFold`, `answerFold`; the accumulator `estimating`; and the display rules `spendIn`, `spendOf` and `validityOf` |
| `samples.ts` | One populated sample payload per kind, for tests                                                                                                                                                 |

An update the schema does not define lands in `unknown` and is preserved,
never dropped. The codec refuses every schema version but its own, so a
version is a fact of the wire and of nothing else. And a Cost is never
computed from tokens times a rate — `estimateTicks` prices the counters the
trace already holds, and an Estimate never merges into `costTicks`;
[docs/decisions.md](../../docs/decisions.md) records why.

## The fixtures

`fixtures/synthetic.jsonl` is a reviewed trace, and `fixtures/goldens/` holds
what every fold answers over it. Regenerate the goldens deliberately, read
the diff, and commit:

```bash
bun packages/schema/fixtures/generate.ts
```

`packages/core` folds the same fixtures through its own `Transcript`, so the
two packages cannot drift apart on one file.

## What it does not do

It writes nothing. The Recorder contract and every sink live elsewhere; this
package only says what a record is and what a fold answers. And `decode` has
no migration path — it refuses every version but the current one, and gains a
reader only when a stored record outlives a schema change.

## API

- `decodeLine(line)` / `encodeLine(event)` — one JSON line, one `Event`;
  `decode` and `encode` take the parsed object, and a bad body raises
  `CodecError`.
- `toTicks(usd)` / `toUsd(ticks)` — the cost unit conversion, rounded once.
- `estimateTicks(counted, price)` — prices reported counters at catalog
  rates; a counter nobody reported costs nothing.
- `PriceLookup` — what a model reference costs, or nothing.
- `mergeText(events)` — the Trace's text-coalescing rule.
- `transcriptFold`, `costFold`, `headerFold`, `verdictFold`, `answerFold` —
  one session's events folded into a projection.
- `estimating()` — the estimate, accumulated: one exchange priced at the rates
  the caller holds now, and one record nothing could price nulls the whole
  estimate. A fold over the Trace and the Budget both charge through it,
  because they used to disagree about exactly that record — and the Budget
  enforced a limit against the partial sum it kept.
- `spendIn(ran, reported, estimated)` — which of the two figures a reader is
  shown, in the four values `Spend` names. The one selection every reader of a
  spend takes.
- `spendOf(summary, ran)` / `validityOf(summary)` — the display rules over a
  cost and a verdict summary.
- `foldKeys(event)` / `sameFoldKeys(a, b)` — the keys a projection groups by.
- `kinds()`, `verdicts()`, `resolutions()`, `errorClasses()`,
  `dispositions()` — the closed sets, for a test that pins them.
- `samples()` — one sample payload per kind.
- `readContentBlock` — the zod reader for one content block.

## Development

Tests live beside the sources: [payload.test.ts](src/payload.test.ts) pins
the closed sets by count and by word, [codec.test.ts](src/codec.test.ts)
round-trips every sample, [fold.test.ts](src/fold.test.ts) holds the fold
rules, [samples.test.ts](src/samples.test.ts) keeps the samples whole, and
[fixtures.test.ts](src/fixtures.test.ts) folds every committed fixture to its
reviewed golden. Run the suite from the repository root:

```bash
bun run test
```

# @missingstudio/eva-budget

The budget plugin for [Eva](../../README.md). It records what a run spends —
tokens, cost, wall-clock time, and steps — and reports when a configured limit
is reached, so a run stops at a boundary you set instead of spending without
bound.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `Budget` slot that [`@missingstudio/eva-core`](../../packages/core/README.md)
defines. Core charges the budget once for every usage record a provider
reports, and the workflow harness checks it before every step — repairs
included. Exhausting a budget is an outcome, not an error: the partial work is
kept. The glossary in [docs/context.md](../../docs/context.md) defines the
terms used here.

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
{ "dependencies": { "@missingstudio/eva-budget": "workspace:*" } }
```

## Usage

### Set limits in the Eva CLI

Without options the plugin only accounts and displays; it enforces nothing.
Set limits in a `.eva` config file. Zero, or an absent key, means no limit of
that kind:

```yaml
plugins:
  - id: eva.budget
    options: { tokens: 200000, minutes: 30, steps: 50 }
```

| Option    | Type   | What it limits                              |
| --------- | ------ | ------------------------------------------- |
| `tokens`  | number | Input plus output tokens across the run     |
| `minutes` | number | Wall-clock minutes since the run started    |
| `steps`   | number | Steps — one per provider turn that answered |

When a run reaches a limit, the next step does not start. The run ends with an
`exhausted` outcome that names the limit it reached, and the partial work is
kept.

### Use the budget in code

`makeBudget` builds a `Budget` directly, without the plugin runtime:

```ts
import { makeBudget } from "@missingstudio/eva-budget"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const budget = yield* makeBudget({ limits: { tokens: 200_000, steps: 50 } })

  yield* budget.charge({
    model: "claude-opus-5",
    inputTokens: 1_200,
    outputTokens: 400,
  })

  const verdict = yield* budget.check
  // { kind: "affordable" }, or { kind: "exhausted", limit: "tokens" }
})

await Effect.runPromise(program)
```

`BudgetDeps` also takes `now` (an injectable clock, so a minutes limit is
testable without waiting) and `prices` (catalog rates, used to estimate cost
when a provider reports none).

## How cost is computed

A provider's own reported figure is what the budget spends. When no figure
arrives, the budget prices the token counters at catalog rates instead — a
limit that can never be reached is worse than one that is reached
approximately. The two shapes are never added: a reported figure wins for the
run, and `costFrom` on the state says which shape the total came from, so an
exhausted outcome is attributable. Cache reads are priced at their own rate,
not the input rate. The rates arrive as `ctx.prices`, which boot derives
beside the catalog — [docs/decisions.md](../../docs/decisions.md) records why.

## API

- `budget` — the plugin definition, id `eva.budget`. It reads the options
  above and provides the `Budget` slot.
- `makeBudget(deps: BudgetDeps): Effect<Budget>` — the implementation. The
  returned `Budget` has `charge(usage)`, `state`, and `check`.

Config sets no cost limit: `BudgetLimits.costTicks` exists in the contract,
and only a direct caller of `makeBudget` can set it. The plugin enforces
nothing itself — `check` answers and the caller decides, and core keeps
charging either way, so an exhausted budget stops the next step rather than
the one in flight.

## Development

Tests live in [src/index.test.ts](src/index.test.ts). Run the suite from the
repository root:

```bash
bun run test
```

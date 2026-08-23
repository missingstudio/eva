# @missingstudio/eva-usage

The usage normalization plugin for [Eva](../../README.md). Providers report
token counters as they arrived, and this plugin cleans them all with one
rule: it rewrites each usage payload on its way to the trace, so a negative
count becomes zero, a fractional one is truncated, and an absent one stays
absent — silence is not zero, and a normalizer must not invent a figure.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers on the `provider.response.after` hook that
[`@missingstudio/eva-core`](../../packages/core/README.md) runs on every
provider response, before the group commits and before the
[Budget](../budget/README.md) is charged — so the trace, `eva.budget`, and
the cost folds behind `/cost` all see the same cleaned counters. The glossary
in [docs/context.md](../../docs/context.md) defines Trace, Payload, and
Usage.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin definition is an `Effect`
  program; `normalize` itself is a plain function.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-usage": "workspace:*" } }
```

## Usage

The plugin declares no options, so there is nothing to configure. It applies
to every provider's usage payloads automatically. `normalize` is also a
plain function over one payload:

```ts
import { normalize } from "@missingstudio/eva-usage"

normalize({
  kind: "usage",
  model: "anthropic/claude-opus-5",
  inputTokens: -3,
  outputTokens: 5.9,
  cacheWriteTokens: null,
  cacheReadTokens: 0,
})
// inputTokens: 0, outputTokens: 5, cacheWriteTokens stays null
```

Every payload kind other than `usage` passes through untouched. The optional
counters — `reasoningTokens`, `serverToolTokens`, `costTicks` — are clamped
when present and stay absent when absent, rather than appearing as null.

[docs/decisions.md](../../docs/decisions.md) records why the rule lives here
and nowhere else: the Anthropic provider once clamped in its own mapper, and
two rules for one concern drift apart.

## What it does not do

It never invents a counter and never computes a cost — a `costTicks` a
provider reported is clamped, and one nobody reported stays absent. It folds
nothing and shows nothing: `costFold` in core turns the cleaned counters into
the figure the `/cost` command prints, and `eva.budget` charges from the same
counters.

## API

- `usage` — the plugin definition, id `eva.usage`. It takes no options and
  maps `normalize` over each payload group on the `provider.response.after`
  hook.
- `normalize(payload: Payload): Payload` — the rule itself. Usage counters
  become whole non-negative numbers; every other payload kind is returned by
  identity.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): a negative count
clamps to zero, a fractional one truncates, an unreported count stays null,
an absent optional counter stays absent, and every other kind passes through
untouched. Run the suite from the repository root:

```bash
bun run test
```

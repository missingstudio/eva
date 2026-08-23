# @missingstudio/eva-catalog-models

The model catalog plugin for [Eva](../../README.md). It seeds the model rows
the Catalog holds — the `anthropic` and `openai` provider rows with their API
addresses, one row per known model with its name, context window, and whether
it reasons — and the default model, so the CLI knows what to offer before any
provider is called.

Eva is built on a plugin kernel: every capability is a plugin. The Catalog is
a Domain, defined in the glossary at [docs/context.md](../../docs/context.md).
This plugin writes the base data, and
[`@missingstudio/eva-catalog-prices`](../catalog-prices/README.md) writes a
rate onto each row — so the prices plugin must load after this one.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin effect returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-catalog-models": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. It registers one
transform: the two provider rows, the model rows from `ANTHROPIC_MODELS` and
`OPENAI_MODELS`, and the default model — set only when nothing set one before.

To change the default model, set the `model` key in a `.eva` config file. The
[`eva.config`](../config/README.md) plugin loads after this one, so its entry
wins:

```yaml
model: anthropic/claude-sonnet-5
```

There is no config key that adds or edits a model row. The seed lists are
written by hand in [src/index.ts](src/index.ts), and a model Anthropic or
OpenAI ships tomorrow is not here until someone adds it there. The rows gate
nothing at the Provider — a Provider answers any reference in its namespace,
listed or not — but the workflow harness does check the Catalog before it
runs a Step, so a workflow can only name models the Catalog holds.

## How the seeds stay honest

The seed lists are confirmed against the models.dev snapshot the price
generator reads, so every id here has a rate.
`packages/conformance/src/catalog.test.ts` asserts that where the two catalog
plugins meet, and boots a live kernel to check the default model has a rate —
so an addition without a snapshot refresh fails loudly.

`DEFAULT_MODEL` is exported, and the CLI reads it (`apps/cli/src/run.ts`)
rather than keeping a second copy that can drift.

## API

- `catalogModels` — the plugin definition, id `eva.catalog.models`.
- `ANTHROPIC_MODELS`, `OPENAI_MODELS` — the seed lists, as readonly
  `ModelInfo` rows: id, name, context window, reasoning.
- `DEFAULT_MODEL` — the fallback `ModelRef`, currently
  `anthropic/claude-opus-5`. It applies only when nothing set a default first.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): every seed has an id, a
name, and a positive context window; one seed per id; and `DEFAULT_MODEL`
names a model the seed list holds. The join with the prices plugin is proved
in `packages/conformance/src/catalog.test.ts`. Run the suite from the
repository root:

```bash
bun run test
```

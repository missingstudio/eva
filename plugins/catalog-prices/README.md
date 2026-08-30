# @missingstudio/eva-catalog-prices

The price catalog plugin for [Eva](../../README.md). It writes a published
rate onto each model row in the Catalog, so a Run can show what its work cost
when no Provider reported a figure.

Eva is built on a plugin kernel: every capability is a plugin. The glossary in
[docs/context.md](../../docs/context.md) defines **Cost**, **Price**, and
**Estimate**, and the difference is the whole point of this package: a Price
is what a vendor publishes, a Cost is what a Provider says a request cost, and
an Estimate is what a Run's counters come to at a Price. Only a Cost is
written to the Trace — nothing this plugin produces reaches a record.
A decision record, local to a checkout, records why.

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
{ "dependencies": { "@missingstudio/eva-catalog-prices": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. It registers one
transform: for each row in the snapshot, it writes the rate onto the matching
model row. It prices only the models the Catalog already holds, because a
rate for a model nothing offers would add a row no Run can reach.

It must load after [`eva.catalog.models`](../catalog-models/README.md), which
seeds those rows. A Domain replays its transforms in registration order, so a
rate registered first finds no row to write on. `apps/cli/src/plugins.ts`
holds that order, and `apps/cli/src/plugins.test.ts` pins it.

Boot derives `ctx.prices` beside the Catalog — the lookup the
[budget plugin](../budget/README.md) uses to estimate cost when a provider
reports none.

## The snapshot

`src/prices.ts` is generated, not written. It holds one row per model, in
**Ticks per million tokens** — integers of 1e-10 USD, so nothing here is a
float and nothing rounds twice.

The source is [models.dev](https://models.dev), read through `tokenlens`.
`tokenlens` is a devDependency: it runs in the generator and never at load, so
boot does no network, and the rate Eva shows is one a reader can see in the
diff. Take a fresh snapshot deliberately, read the diff, and commit it:

```bash
bun plugins/catalog-prices/fixtures/generate.ts
```

`CHECKED_AT` names the day the snapshot was taken, because a fact about a
moving thing carries the day it was checked.

## What it does not do

The snapshot does not refresh itself. A model added to the catalog without a
rate fails the suite, so missing coverage is loud. A change to a rate already
in the snapshot is not: the figures stay as they were, every Estimate is
quietly wrong, and nothing fails. Until a scheduled refresh exists,
`CHECKED_AT` is the only record of how old the rates are, and nothing reads it
at run time.

## API

- `catalogPrices` — the plugin definition, id `eva.catalog.prices`.
- `PRICES` — the snapshot: one `PriceSeed` per model, naming its provider,
  model id, and rates in Ticks per million tokens.
- `CHECKED_AT` — the day the snapshot was taken.
- `SOURCE` — the snapshot's source, `https://models.dev`.
- `PriceSeed` — the row type: a `ModelPrice` plus `provider` and `model`.

## Development

Tests live in [src/index.test.ts](src/index.test.ts): every rate is a
positive whole number of Ticks and reads as a rate per million tokens, and
the snapshot names its source and day. The joins live where the plugins meet:
`apps/cli/src/plugins.test.ts` holds the load order, and
`packages/conformance/src/catalog.test.ts` boots a kernel to check every
seeded model has a rate and a Run's counters fold to an Estimate. Run the
suite from the repository root:

```bash
bun run test
```

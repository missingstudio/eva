# eva.catalog.prices

What vendors charge for a model, so a Run can show what its work cost when no
Provider reported a figure.

[context.md](../../docs/context.md) defines **Cost**, **Price**, and
**Estimate**, and the difference between them is the whole point of this
package: a Price is what a vendor publishes, a Cost is what a Provider says a
request cost, and an Estimate is what a Run's counters come to at a Price. Only
a Cost is written to the Trace. This package supplies Prices, and nothing it
produces reaches a record. [decisions.md](../../docs/decisions.md) records why.

## What it does

The plugin writes a rate onto each model row in the catalog Domain. It prices
only the models the catalog already holds, because a rate for a model nothing
offers would add a row no Run can reach.

It must load after the plugin that seeds the models. A Domain replays its
transforms in registration order, so a rate registered first finds no row to
write on. `apps/cli/src/prices.test.ts` holds that order and boots a kernel to
check the rates arrive.

## The snapshot

`src/prices.ts` is generated, not written. It holds one row per model, in
**Ticks per million tokens** — integers of 1e-10 USD, so nothing here is a
float and nothing rounds twice.

Take a fresh snapshot deliberately, read the diff, and commit it:

```bash
bun plugins/catalog-prices/fixtures/generate.ts
```

The source is [models.dev](https://models.dev), read through `tokenlens`.
`tokenlens` is a devDependency: it runs in the generator and never at load, so
boot does no network and the rate Eva shows is one a reader can see in the
diff.

`CHECKED_AT` names the day the snapshot was taken, because a fact about a
moving thing carries the day it was checked.

## What the tests hold

- Every rate is a positive whole number of Ticks, and reads as a rate per
  million tokens rather than per token.
- The snapshot names its source and the day it was taken.
- Every model the catalog seeds has a rate here — in `apps/cli`, where the two
  catalog plugins meet, because a plugin does not import a plugin.
- A live kernel prices the default model, and a Run's counters fold to an
  Estimate.

## What it does not do

The snapshot does not refresh itself. A model added to the catalog without a
rate fails the suite, so missing coverage is loud. A **change to a rate already
in the snapshot** is not: the figures stay as they were, every Estimate is
quietly wrong, and nothing fails. Until a scheduled refresh exists, `CHECKED_AT`
is the only record of how old the rates are, and nothing reads it at run time.

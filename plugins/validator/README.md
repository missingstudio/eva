# @missingstudio/eva-validator

The JSON Schema validator plugin for [Eva](../../README.md). It judges one
Candidate — the text a model answered — against a JSON Schema, and names every
Fault as data: where, as a JSON Pointer, and what the schema wanted there. It
judges form, never truth, and it never calls a model.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
fills the `Validator` slot that
[`@missingstudio/eva-core`](../../packages/core/README.md) defines; the
[workflow plugin](../workflow/README.md) reads the slot to check each Step
that declares a schema. The glossary in
[docs/context.md](../../docs/context.md) defines **Validator**, **Verdict**,
and **Fault**, and [docs/decisions.md](../../docs/decisions.md) records why
the repair loop belongs to the caller, not here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The `Validator` contract returns `Effect`
  values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-validator": "workspace:*" } }
```

## Usage

The plugin takes no options and declares no config keys. It provides
`accepts` and `check` — the `Validator` contract in
`packages/core/src/contracts.ts` — into the `validator` slot. Exactly one
plugin fills a slot at a time, so a second Validator replaces this one whole.

In practice you use it through a workflow: give a Step a `schema:` key, and
the harness checks each Candidate through this plugin and repairs a refused
one. See the [workflow plugin](../workflow/README.md).

## How a judgement works

`accepts(schema)` fails with `ValidatorError` only when the JSON Schema itself
cannot be read, judged against the library's own draft 2020-12 meta-schema. A
workflow calls it once per Step before any Run opens, so an author's broken
schema refuses the workflow instead of spending a provider turn.

`check(schema, candidate)` is extract, parse, and judge as one judgement. The
extraction rule is fixed behaviour, not config: the body of one fenced block,
else the longest balanced `{...}` or `[...]` run, else the text as it is. A
Candidate that is not JSON at all is `invalid` with one Fault at the root. A
valid one answers `Judged` carrying the parsed value, so the caller does not
parse twice.

A Fault says where, as a JSON Pointer (`""` is the root), and what the schema
wanted there, in Eva's own words — never the library's message, because a
vendor's prose would land in a record. Faults are one per instance location,
after reduction: two keyword misses at one location join into one Fault, so
two Validator plugins count the same Runs the same way.

Two edge behaviours are deliberate:

- **Dialect refusal.** The dialect is draft 2020-12 alone, through
  `json-schema-library` (pinned). A `$schema` that declares another dialect
  fails `accepts`. A second dialect is a second plugin filling the slot.
- **`$ref` asymmetry.** A dangling `$ref` passes `accepts` — the meta-schema
  cannot see one — and fails `check` with the same `ValidatorError` once the
  judgement walks the branch, faulting the schema and never the Candidate.

## What it does not do

- It never answers `unchecked`: an empty slot answers nothing, and the caller
  writes that word.
- The extraction rule does not vary by config, so a measured number means the
  same thing across Runs and across workflows.
- No loop, no count, no model call. The workflow owns the Repair.

## API

- `validator` — the plugin definition, id `eva.validator`, and the package's
  only export. It provides `accepts` and `check` into the `validator` slot.

## Development

Tests live beside the sources: [src/check.test.ts](src/check.test.ts) holds
the extraction routes, the Fault wording, the reduction to one Fault per
location, the dialect refusal, and the dangling `$ref`;
[src/index.test.ts](src/index.test.ts) holds the slot fill, empty-on-unload,
and whole replacement. The join with `eva.workflow` is proved in
`packages/conformance/src/workflow-validator.test.ts`. Run the suite from the
repository root:

```bash
bun run test
```

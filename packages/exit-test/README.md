# @missingstudio/eva-exit-test

The Stage 1 exit test of [Eva](../../README.md), in two halves: a
deterministic half that gates every push, and a measured number a maintainer
runs deliberately against the pinned model.
[plans/stage-1](../../plans/stage-1/README.md) §"The exit test, and where
each half runs" is the design; this package is the build of it.

Eva is built on a plugin kernel: every capability is a plugin, and the exit
test drives the shipped ones — workflow, prompt, validator, the Anthropic
provider — through a hermetic fixture, so the number it reports is about the
build and the model, never about the operator's machine. The glossary in
[docs/context.md](../../docs/context.md) defines the terms used here.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- An `ANTHROPIC_API_KEY`, only for the two scripts that call the model
  (`record.ts` and `measure.ts`). The deterministic half calls no model.

## Installation

Install once at the repository root:

```bash
bun install
```

Nothing depends on this package, and it declares no exports: it holds the
scorer, the fixture, the vendored traces, and the scripts that use them.

## Usage

The deterministic half is [src/score.test.ts](src/score.test.ts): every
vendored trace in `traces/` folds to its committed golden in `goldens/`, byte
for byte. It runs with the rest of the suite, in `verify`, on every push and
every pull request:

```bash
bun run test
```

The measured half runs at a desk, when a maintainer chooses to spend the $12
to $20 a full run costs. No workflow runs it — a model's statistical property
is not a function of the tree, so it could never gate `ci.yml`, and a
schedule would spend the money whether or not anybody reads the number:

```bash
ANTHROPIC_API_KEY=... bun packages/exit-test/scripts/measure.ts \
  --each 100 --jobs 4
```

`measure.ts` fans N Runs of each of the five canned Workflows out across OS
processes — each one an `eva run` with its own trace file, because one
Recorder holds one open Run. It prints what was measured (the date, the
endpoint, the models the Runs reported, the inputs) and the ratios from the
one fold, and exits non-zero when first-pass validity falls below 95%
aggregate, repair yield below 90%, or more than 2% of the Runs produced no
Candidate. `--out DIR` says where the trace files land; a shell whose
`ANTHROPIC_BASE_URL` points elsewhere is refused unless `--endpoint` names
that endpoint on purpose.

## The hermetic fixture

`fixture/` is the run's whole world: `config.yaml` pins the model and an
explicit plugin list, beside the prompts, the five workflow files, and the
five vendored inputs. A run reaches it by `EVA_CONFIG_DIR`, which needs no
trust grant, and `scripts/fixture.ts` gives every child an empty user config
in a scratch directory and writes the pinned endpoint into its environment —
the operator's own config, trust record, and `ANTHROPIC_BASE_URL` never
reach a Run, so the same fixture scores identically on two machines.

Two more scripts, each run deliberately:

- `scripts/record.ts` — one pass of the five Workflows against the pinned
  model. It writes each Trace to `traces/<workflow>.jsonl` and the raw
  provider streams to `cassettes/<workflow>.json` for the testkit's
  `recorded` to replay. Read the diff before committing.
- `scripts/generate.ts` — regenerates `goldens/*.json` from the vendored
  traces.

## API

`src/score.ts` is the scorer, and it computes nothing of its own: `readingOf`
is `verdictFold` and `validityOf` from `@missingstudio/eva-schema`, so the
golden test, the generator, and the measurement read one fold and five
callers cannot compute five rates. Beside it: `WORKFLOWS` names the five
canned Workflows once, `eventsOf` reads a trace file, `writtenOf` fixes a
golden's exact bytes, `said` prints one reading, `refuses` holds the 2%
no-Candidate line, and `ENDPOINT` and `wrongEndpoint` pin the endpoint the
measurement is about.

## What it does not do

The committed traces are synthetic pins of the fold arithmetic, not recorded
provider streams. They stand until a maintainer runs `record.ts` against the
pinned model, reviews the diff, and commits the real streams — no
`cassettes/` directory exists yet for the same reason. And the build alone
does not exit the stage: Stage 1 exits on the first recorded measurement at
or above the line.

## Development

Tests live in [src/score.test.ts](src/score.test.ts). Run the suite from the
repository root:

```bash
bun run test
```

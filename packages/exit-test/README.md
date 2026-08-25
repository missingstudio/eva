# @missingstudio/eva-exit-test

The Stage 1 exit test of [Eva](../../README.md), in two halves: a
deterministic half that gates every push and that Stage 1 exits on, and a
measured number a maintainer may run deliberately against the pinned model.

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

The deterministic half runs with the rest of the suite, in `verify`, on
every push and every pull request. [src/score.test.ts](src/score.test.ts)
folds every vendored trace in `traces/` to its committed golden in
`goldens/`, byte for byte; [src/replay.test.ts](src/replay.test.ts) replays
every vendored cassette in `cassettes/` through the real fixture — the
Workflow harness, the Validator, the Repair — and folds the resulting Trace
to the same golden, so the trace and the cassette stay two projections of
one recording; [src/gate.test.ts](src/gate.test.ts) asserts the verdict the
measurement exits on; and [src/fixture.test.ts](src/fixture.test.ts) resolves
the environment both halves send, so a trace path a YAML reader would give
back changed fails here rather than in a measurement:

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
Recorder holds one open Run. Everything after the fan-out is
[src/gate.ts](src/gate.ts): the read-back, the no-Candidate rule, the
refusal share, and the threshold verdict — first-pass validity below 95%
aggregate, repair yield below 90%, or more than 2% of the Runs producing no
Candidate all fail it, and the script prints and exits on that one report.
`--out DIR` says where the trace files land; a shell whose
`ANTHROPIC_BASE_URL` points elsewhere is refused unless `--endpoint` names
that endpoint on purpose.

## The hermetic fixture

`fixture/` is the run's whole world: `config.yaml` pins the model and an
explicit plugin list, beside the prompts, the five workflow files, and the
five vendored inputs. A run reaches it by `EVA_CONFIG_DIR`, which needs no
trust grant, and `src/fixture.ts` gives every run an empty user config in a
scratch directory and writes the pinned endpoint into its environment — the
operator's own config, trust record, and `ANTHROPIC_BASE_URL` never reach a
Run, so the same fixture scores identically on two machines.

`hermeticEnv` also says where the Run's Trace lands, as one inline config
layer. Both halves say it that way — the in-process Run resolves the layer
and a child the fan-out spawns reads it from its environment — so the
deterministic gate proves the words the measurement sends, and the path is
written as JSON rather than interpolated into YAML.

Running the fixture in-process has one home, [src/run.ts](src/run.ts):
`runFixture` takes a fixture Workflow, boots the one Build from the fixture's
own config and that one layer, prompts it, and hands back its Trace. The
recorder, the replay gate, and any suite that wants the fixture in-process
all go through it — the plugin table is stated there once, so nothing mirrors
the config's ids by hand.

Three more scripts, each run deliberately:

- `scripts/record.ts` — one pass of the five Workflows against the pinned
  model. It writes each Trace to `traces/<workflow>.jsonl` and the raw
  provider streams to `cassettes/<workflow>.json` for the testkit's
  `recorded` to replay. Read the diff before committing.
- `scripts/replay.ts` — regenerates `traces/*.jsonl` from the vendored
  cassettes, deterministically: the same fixture Build with the recorded
  streams standing in for the model. For after a change to the machinery
  the fixture runs on.
- `scripts/generate.ts` — regenerates `goldens/*.json` from the vendored
  traces.

## API

Three modules, and each owns one thing.

[src/score.ts](src/score.ts) is the scorer, and it computes nothing of its
own: `readingOf` is `verdictFold` and `validityOf` from
`@missingstudio/eva-schema`, so the golden test, the generator, and the
measurement read one fold and five callers cannot compute five rates. Beside
it, `repairsOf` is the one computation of the repair yield and `said` prints
one reading.

[src/gate.ts](src/gate.ts) is the whole verdict: `gate` reads the traces
back, and `NO_CANDIDATE_SHARE`, `refuses`, `FIRST_PASS_LINE` and
`REPAIR_YIELD_LINE` are the lines it applies. The share used to live beside
the printer, so the module that decided imported its own rule from the
module that only prints.

[src/fixture.ts](src/fixture.ts) is the run's world: `WORKFLOWS` names the
five canned Workflows once, `INPUTS` and `inputOf` say what each one reads,
`hermeticEnv` builds the environment one Run gets, and `ENDPOINT` and
`wrongEndpoint` pin the endpoint the measurement is about.

Reading a trace file and fixing a golden's bytes are the schema package's
`readTrace` and `writtenGolden`.

## What it does not do

The committed cassettes hold synthetic streams, derived from the original
hand-written pins, not recorded provider output. They stand until a
maintainer runs `record.ts` against the pinned model, reviews the diff, and
commits the real streams — the traces and goldens then regenerate from that
same recording. Nothing waits on that: Stage 1 exits on the deterministic
half, and no measured rate is on the record.

## Development

Tests live beside the sources in `src/`. Run the suite from the repository
root:

```bash
bun run test
```

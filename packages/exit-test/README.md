# @missingstudio/eva-exit-test

The Stage 1 exit test: the deterministic half that gates every push, and the
machinery for the measured number that runs on a schedule.
[plans/stage-1](../../plans/stage-1/README.md) §"The exit test, and where each
half runs" is the design; this package is the build of it.

## What it does

`src/score.ts` is the scorer, and it computes nothing of its own: `readingOf`
is `verdictFold` and `validityOf` from `@missingstudio/eva-schema`, so the
golden test, the generator, and the measurement read one fold and five callers
cannot compute five rates. `WORKFLOWS` names the five canned Workflows once,
`writtenOf` fixes a golden's exact bytes, and `refuses` holds the 2% share of
Runs that may produce no Candidate before no rate is reported at all.

`fixture/` is the hermetic run: `config.yaml` pins the model and an explicit
plugin list, beside the prompts, the five workflow files, and the five
vendored inputs. A run reaches it by `EVA_CONFIG_DIR`, which needs no trust
grant, and `scripts/fixture.ts` gives every child an empty user config in a
scratch directory and writes the pinned `ENDPOINT` into its environment — the
operator's own config, trust record, and `ANTHROPIC_BASE_URL` never reach a
Run, so the same fixture scores identically on two machines.

Three scripts, each run deliberately:

- `scripts/record.ts` — the recorder. One deliberate pass of the five
  Workflows against the pinned model. It writes each Trace to
  `traces/<workflow>.jsonl` and the raw provider streams to
  `cassettes/<workflow>.json`, one entry per Provider Turn, for the testkit's
  `recorded` to replay. Read the diff before committing.
- `scripts/generate.ts` — regenerates `goldens/*.json` from the vendored
  traces.
- `scripts/measure.ts` — the runner: N Runs of each Workflow (default 100),
  fanned out across OS processes, each one an `eva run` with its own trace
  file, because one Recorder holds one open Run. It prints the four ratios
  from the one fold and exits non-zero when first-pass validity falls below
  95% aggregate, repair yield below 90%, or more than 2% of the Runs produced
  no Candidate. It refuses a shell whose `ANTHROPIC_BASE_URL` points elsewhere
  unless `--endpoint` names that on purpose, and it prints what was measured:
  the date, the endpoint, the models the Runs reported, and the inputs.

## Where each half runs

The deterministic half is `src/score.test.ts`, and it runs in `verify` on
every push and every pull request. No model is called there. The measured half
is `.github/workflows/measure.yml`: `measure.ts` on a monthly schedule and on
dispatch, with a stored `ANTHROPIC_API_KEY`. It is not in `ci.yml`, because a
model's statistical property is not a function of the tree —
`measure-report.yml` watches from outside and files a GitHub issue when a
scheduled run fails.

## What the tests hold

- A vendored trace exists for each of the five Workflows.
- Every trace folds to its committed golden, byte for byte, and the five
  together fold to the golden aggregate — one fold, never a sum of summaries.
- The `no-validator` trace folds to `{ kind: "none" }`, and what `said` prints
  for it says "no rate" and carries no percentage.
- `refuses` draws the 2% line exactly, and `wrongEndpoint` refuses an endpoint
  the measurement is not pinned to.

## What it does not do

The committed traces are synthetic pins of the fold arithmetic, not recorded
provider streams. They stand until a maintainer runs `record.ts` against the
pinned model, reviews the diff, and commits the real streams — no `cassettes/`
directory exists yet for the same reason. And the build alone does not exit
the stage: Stage 1 exits on the first recorded measurement at or above the
line.

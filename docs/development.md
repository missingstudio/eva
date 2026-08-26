# Development

This document owns how a change is made in this repository: what you set up
once, which models you can name, how you run Eva on Eva, the loop one change
goes through, and where each stage stands today.

It repeats nothing. [reference/toolchain.md](reference/toolchain.md) owns the
build, the test runner, and CI's jobs. [../AGENTS.md](../AGENTS.md) owns the
commit format and the branch names. [roadmap.md](roadmap.md) owns what we
build and in what order, and the exit test each stage can fail.
[../plans](../plans) holds one ticket per plan.

## Set up once

Install the workspace:

```bash
bun install
```

Run the CLI from source. A development run has no build step:

```bash
bun run eva --version
```

## Connect a model

Eva reads `ANTHROPIC_API_KEY` for Anthropic, and `OPENAI_API_KEY` for OpenAI.
Copy `.env.example` to `.env` and write the key in it. Bun loads `.env`, so a
development run finds the key without an export. `.env` is ignored by Git.

Answer one prompt to prove the key works:

```bash
bun run eva -p "Reply with exactly: OK" --model anthropic/claude-haiku-4-5
```

The answer prints, and a cost line follows it. `--model` names the model for
one run.

## Name another model in config

`eva.catalog.models` seeds the rows of both first-party providers into the
Catalog, and `/model` lists every row it holds. No config key adds a row: the
seed lists are written by hand, and
[../plugins/catalog-models](../plugins/catalog-models/README.md) says where
and why.

Every other model reaches Eva as an OpenAI-compatible endpoint. Ollama,
llama.cpp, vLLM, LM Studio and a hosted gateway all speak that wire, and you
name each one under the `providers` option of `eva.provider.compatible`. The
key becomes a namespace, which is the first half of a model reference:

```yaml
plugins:
  - id: eva.provider.compatible
    options:
      providers:
        ollama:
          api: http://localhost:11434/v1
          models: [qwen3-coder]
        together:
          api: https://api.together.xyz/v1
          credential: true
          models: [moonshotai/Kimi-K2-Instruct]
  - id: eva.auth
    options:
      env:
        together: TOGETHER_API_KEY
```

`api` is the base URL, and it is the one key an entry must have. An entry with
`credential: true` asks for a credential of the same name, and the `env`
mapping of `eva.auth` says which environment variable holds it. A keyless
entry sends no Authorization header, which is what a local server wants.
[../plugins/provider-compatible](../plugins/provider-compatible/README.md)
holds every key an entry takes. An entry named `openai` replaces the
first-party provider, because that plugin loads after it.

Name the model where you need it:

```bash
bun run eva --model ollama/qwen3-coder
```

Write the `models` list, because a Workflow reads it. At the terminal an
unlisted reference still runs: a Provider answers anything in its namespace. A
Workflow is stricter. Its load pass checks each Step's model against the
Catalog before the first Run opens, and an unlisted model refuses the Workflow
with `the Catalog does not hold <provider/model>`.

A Workflow names one model for every Step, and a Step names its own where the
work needs another. Spend a small model on small work:

```yaml
name: Review
model: anthropic/claude-haiku-4-5
steps:
  - id: findings
    template: review
    with: { file: input }
    model: anthropic/claude-opus-5
```

A compatible namespace has no price, so a run against one reports its cost as
unknown. It does not guess.

## Use Eva on Eva

Eva runs Workflows against this repository. The setup is six steps, and you do
it once per clone. `.eva/` is ignored by Git, so each person runs these steps
in their own checkout.

**1. Make the directory.**

```bash
mkdir -p .eva/prompts .eva/workflows
```

**2. Grant trust.** Eva reads a project's `.eva` only after a grant, because a
directory can name plugins to load, and to name a plugin is to name code. The
grant is written beside your own config, in `~/.eva/trusted`, never in the
repository:

```bash
bun run eva trust
```

Without the grant every run says which directories it did not read, and
`eva run` then answers `no harness answers <name>`.

**3. Set what this repository runs with.** The file is `.eva/config.yaml`:

```yaml
model: anthropic/claude-haiku-4-5

plugins:
  - id: eva.workflow
    options: { repairs: 2 }
  - id: eva.budget
    options: { tokens: 200000, steps: 50 }
  - id: eva.trace.sqlite
    options: { path: "~/.eva/eva-repo.sqlite" }
```

`model` is the default for this directory. `repairs` is the ceiling on Repairs
per Step. The budget stops the next Step when a limit is reached. The trace
path keeps this repository's evidence apart from the shared store.

**4. Write a Template.** A file in `.eva/prompts/` becomes one prompt row,
keyed by its base name. This is `.eva/prompts/commit-msg.md`:

```markdown
You write one Conventional Commit subject line for the Eva repository.

Rules: `type(scope): description`. Types: feat, fix, refactor, chore, docs,
test, ci, build. The scope is the package or plugin name. Lowercase, no
period, imperative mood, 72 characters or less. Use Simplified Technical
English. Answer with the line and nothing else.

The staged diff:

{{diff}}
```

**5. Declare the Workflow.** A file in `.eva/workflows/` becomes one harness
row, keyed by its base name. This is `.eva/workflows/commit-msg.yaml`:

```yaml
name: Commit message
steps:
  - id: subject
    template: commit-msg
    with: { diff: input }
```

Run it. One input goes in, and the last Run's text comes out:

```bash
git diff --staged | bun run eva run commit-msg
```

The input arrives by one route: piped standard input, a positional file, or
`--input <file>`. Two routes at once is refused with both named. At a terminal
the positional route is the readable one; in a script, pipe the input instead,
because an empty standard input that is not a terminal counts as a route.

**6. Check the answer against a schema.** A Step that names a JSON Schema is
judged by the Validator, and a refused Candidate is asked again with every
Fault named. This is `.eva/prompts/review.md`:

```markdown
You review one file from the Eva repository against AGENTS.md: the smallest
correct change, package boundaries, and Simplified Technical English in
comments.

Answer with a JSON array. Each item has `file`, `line`, `claim`, and
`severity` (one of `high`, `medium`, `low`). An empty array is a valid answer.

{{file}}
```

And this is `.eva/workflows/review.yaml`:

```yaml
name: Review
steps:
  - id: findings
    template: review
    with: { file: input }
    schema:
      type: array
      items:
        type: object
        required: [file, line, claim, severity]
        properties:
          file: { type: string }
          line: { type: integer }
          claim: { type: string }
          severity: { enum: [high, medium, low] }
```

```bash
bun run eva run review packages/kernel/src/mapping.ts
```

`bun run eva config show` names every key it resolved and the file each one
came from. The trace file holds the evidence:

```bash
tail -3 ~/.eva/eva-repo.jsonl
```

Each Step writes `started`, `text`, `usage` and `finished`, and a Step with a
schema also writes a `verdict` that names the attempt and every Fault. A Run
that failed is in there too, with the class of the failure: a provider with no
key reads `auth_failed`, and an endpoint that does not answer reads
`unreachable`.

## The loop for one change

1. Read the stage's plan, or write one before you start.
2. Cut a branch. `type/kebab-case-description`.
3. Make the smallest correct change. Keep the package boundaries.
4. Run the package's tests while you work, and `bun run verify` before you
   push. `verify` is what CI runs.
5. Commit one logical change. Work that spans more gets more commits.
6. Write the state change into the execution log.

## Execution log

This log records state, never design. The roadmap says what a stage builds and
what its exit test is; this table says where that stage is now and what is
left. Add a row when a stage starts, and edit the row when its state changes.

| Stage                  | State       | What is left |
| ---------------------- | ----------- | ------------ |
| 0 — Wire               | done        | nothing      |
| 1 — Workflow           | done        | nothing      |
| 2 — Tools and the loop | not started | the plans    |

**Stage 0 — Wire.** Done. The kernel, the SDK, the event schema, the trace, one
provider, and the terminal all ship, and `verify` runs the three exit tests.

**Stage 1 — Workflow.** Done. Every plugin ships and the deterministic gate
passes in `verify`, and the stage exits on that gate. The measured half is
built and stays unrun: a maintainer decided against the $12 to $20 a full run
costs, so no first-pass rate is on the record and the vendored cassettes hold
synthetic streams. `measure.ts` and `record.ts` stay in the tree for whoever
wants the number later.
[../packages/exit-test](../packages/exit-test/README.md) says how both halves
run and what a full measurement costs.

**Stage 2 — Tools and the loop.** Not started. Execution starts the same way
Stage 1 did: read the roadmap's stage, then write the stage's plan as one
ticket per plan, with a priority, an effort, and what it depends on. Build the
tickets in dependency order, one commit each, and record the result as each
lands.

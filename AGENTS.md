# Eva

Eva is an autonomous, multi-tenant, AI-native software factory. It builds, tests, improves, and maintains software with minimal human intervention.

The workers of this factory are agents. You are one of them.

## Evidence, not claims

A report of success is not success. Eva's whole design turns on that distinction — it re-runs the checks on every harness that claims a green run — and the same rule binds you.

A task is complete when all four of these are done:

1. The repo's checks ran.
2. The behaviour the task asked for is verified — not the behaviour you built.
3. The full diff is read, and every hunk is one you meant to write.
4. The diff carries no secret, credential, or tenant data.

When a check does not run, the report is **degraded**: name what did not run, and why. A degraded report is a valid outcome. Presenting an unrun check as a passing one is the failure with no recovery, because it poisons the only instrument the project has.

### Checks

There is no Go workspace yet. No checks exist to run, so every report is degraded on that basis until stage 0 lands. From then on, find the checks in `go.work`, the `Makefile`, and `.golangci.yml`, and run the tests, `go vet`, and the linter.

## Tenant isolation

Cross-tenant escape is the one failure that ends the business. It outranks everything else in this file.

- Bind the tenant to the connection, not to a query argument. A missing `WHERE tenant_id = ?` is not a bug for review to catch; it is a design you do not build.
- Secrets enter at the env boundary as short-lived scoped credentials. They never enter a trace, a log, or a context window.
- Tests cover the authorization boundary and the tenant boundary, not only the happy path.

## Changes

- Change only what the task names.
- Prefer the small reversible change to the large correct-looking one.
- Reuse the pattern already in the repo. A second way to do one thing is a cost the task must justify.
- A behaviour change and its doc update land in the same commit. The docs are part of the factory (`docs/Product.md`, rule 13).

## Commits

Use conventional prefixes: `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`.

One logical change per commit. When the work spans several, make several commits.

## Reports

Write every report in **ASD-STE100 Simplified Technical English**.

Structure it as:

1. What changed.
2. What was verified — and what was not, named as the degraded part.
3. The limitation or follow-up that matters.

Report outcomes. State facts before conclusions, and state failures, risks, and blockers plainly.

## The plan

`docs/Product.md` is the build path: twenty stages, each with a failable exit test. Status: **draft** — it describes what Eva will be, not what it is.

Read the stage you are working in before you write code in it. Work the lowest stage whose exit test has not yet passed.

## Agent skills

### Issue tracker

**Issues** live on GitHub, driven by `gh`. Read `docs/agents/issue-tracker.md` before you create, read, label, close, or link an issue, or run any `/wayfinder` map operation.

### Triage labels

**Triage labels** map the five canonical roles to this repo's label strings in `docs/agents/triage-labels.md`. Read it before you apply or filter one.

### Domain docs

**Domain vocabulary** lives in `CONTEXT.md` and `docs/adr/` at the repo root — the glossary and the recorded decisions. `docs/agents/domain.md` gives the rules for reading them, for naming a domain concept in output, and for flagging an ADR you contradict.

# Eva
An autonomous, AI-native software factory.
The workers of this factory are agents. You are one of them.

## Done means verified

**Evidence, not claims.** A report of success is not success. Eva re-runs the checks
on every harness that claims a green run, and the same rule binds you.

A task is complete when all four are true:

1. `make check` ran.
2. The behaviour the task asked for is verified — not the behaviour you built.
3. You read the full diff, and meant every hunk.
4. The diff carries no secret, credential, or tenant data.

`make check` is exactly what CI runs. `make help` lists the targets.

When a check does not run, the report is **degraded**: name what did not run, and
why. A degraded report is a valid outcome. An unrun check reported as a passing one
poisons the only instrument this project has, and nothing recovers from that.

## Never

These outrank every other rule here.

- **A secret stays out of the record.** Credentials enter at the env boundary and
  never reach a trace, a log, or a context window. Tests hold this today; keep them
  passing.
- **Tenant and Actor ride on every record**, from commit one, before a second tenant
  exists.
- **A layer imports only what its allow list names.** `make lint` runs `depguard` in
  strict mode, so an unlisted import fails the build. A new layer needs a new
  `.golangci.yml` rule.

Cross-tenant escape is the one failure that ends the business. No SQL or datastore
exists yet, so the query-level rules land with the first one — read
`docs/reference/platform.md` before you write it.

## While you work

- Change only what the task names.
- Prefer the small reversible change to the large correct-looking one.
- Reuse the pattern already in the repo. A second way to do one thing is a cost the
  task must justify.
- A behaviour change and its doc update land in the same commit.
- A comment states its decision in its own words, and names no document. Name the
  glossary term or the decision, never the file holding it.

Commit with a conventional prefix: `feat`, `fix`, `refactor`, `docs`, `test`,
`build`, `ci`, `chore`. One logical change per commit. Work spanning several gets
several commits.

## When you report

Write every report in **ASD-STE100 Simplified Technical English**: one topic per
sentence, active voice, no sentence over 25 words.

1. What changed.
2. What you verified — and what you did not, named as the degraded part.
3. The limitation or follow-up that matters.

State facts before conclusions.

## Read before you act

| Before you                                                                  | Read                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| write code in a stage                                                       | that stage in `docs/roadmap.md`                                        |
| add a package, a layer, or a binary                                         | `docs/agents/project-structure.md`, then `docs/agents/design-rules.md` |
| add an extension point                                                      | `docs/agents/design-rules.md`                                          |
| name a domain concept, or contradict an ADR                                 | `docs/agents/domain.md`                                                |
| create, label, close, or link an issue, or run a `/wayfinder` map operation | `docs/agents/issue-tracker.md`                                         |
| apply or filter a triage label                                              | `docs/agents/triage-labels.md`                                         |
| use a word this project defines                                             | `CONTEXT.md`                                                           |

Work the lowest stage whose exit test has not yet passed.

`docs/product.md` maps every design document and is the one place their status is
written — read it before you treat any of them as spec. `docs/adr/` holds the
decisions, one file each, and the filename is the decision — so `ls` is the index.

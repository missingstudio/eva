---
status: accepted
---

# The base system prompt is compiled in, and its size is a merge gate

Every turn pays for the base system prompt before the transcript is sent. It is the one piece of context that is bought on every Run of every Session for as long as the build lives, so it is the piece that must be hardest to grow by accident.

Two decisions follow from that.

## It is part of the build, not part of the configuration

The prompt is `core/prompt/base.md`, embedded into the binary at compile time.

A file read at run time would be a prompt that varies by machine, so two Runs with identical Traces could have been conditioned on different prompts and nothing in the record would say which. It would also be the one input to a model call that no review ever sees, because it would not arrive in a diff.

Embedded, it is source: it is reviewed as prose, it changes in a commit with a reason attached, and a Trace plus the commit that produced the binary says exactly what a turn was conditioned on.

`embed` is the first standard-library package `core` has been allowed beyond the four it had, and it is allowed because it is a compile-time read. The bytes land in the binary and nothing reaches the filesystem while a Run is going, so "core is pure" still holds. The allow list in `.golangci.yml` grew by one line, deliberately, which is the friction ADR 0010 describes working as intended.

## Its size is compared against a declared budget, in CI

`prompt.Budget` is 2 KiB — the bar owainlewis/neo holds itself to. `prompt.Fits` compares the byte count against it and names both figures when the prompt is over. Appending a paragraph to `base.md` and running `make check` gives:

```
prompt: the base system prompt is 2597 bytes and the budget is 2048 bytes, so it is 549 over
```

The check is a test, so `make check` runs it and CI is what refuses the change. Two tests hold it up: one measures the real prompt, and one inflates a prompt deliberately and asserts the refusal fires and names the figures. The second is what proves the gate is a gate rather than a comment — a size check nobody has ever seen fail is indistinguishable from one that cannot.

Raising the budget is allowed. Raising it in the commit that would otherwise have failed, with no statement of what the extra bytes buy on every turn, is the thing this exists to make visible.

**The comparison is on bytes, and only on bytes.** Deterministic size budgets are the only spend this project ever gates a merge on. A gate that measured a duration would be red on a loaded machine and green on a quiet one, and a check that fails for reasons nobody caused is a check people learn to ignore — which costs more than the regression it was meant to catch. Timing figures stay informational.

A byte is not a token, and the budget does not pretend otherwise. Bytes are what a repository can compare exactly and identically on every machine; tokens need a tokenizer per model and change under the project's feet when a model does.

## The prompt is not in the transcript

`Turn` prepends it to the Call and the Session never holds it.

A Session learns what happened by folding committed Events, so a system Message inside the transcript would have to have been recorded — and what every Trace would then carry is the same kilobyte on every Run of one binary. That is a record of the build, repeated once per turn, rather than a record of the turn.

**Falsifier:** this holds while the prompt is constant for a build. The first thing that varies it per Run — a Profile that carries its own, memory folded in per Session, a tenant with a prompt of its own — breaks it, because from then on the Trace could no longer say what a turn was conditioned on. At that point what varies has to enter the record; what is still constant does not have to follow it in.

## Consequences

**Context spend is a reviewed figure from the first commit.** The number of bytes every turn buys is stated in the repository, and changing it is a reviewed act rather than a drift nobody measured.

**The budget cannot be the whole contract.** A size gate passes on an empty file, so a deleted prompt would satisfy every byte comparison in the package. A second test asserts the prompt says something.

**The prompt is one file for every model and every tenant.** That is correct at stage 0, where there is one Turn, one Session, and no Profiles. It is the thing to revisit at the stage that introduces Profiles, rather than a shape to build for now.

## Considered options

- **A budget stated in a document.** Free, and rejected: a plausible paragraph walks straight past a document. The exit test for this stage asks for a gate, and a gate is a check that has been seen to fail.
- **A token budget rather than a byte budget.** Closer to what is actually paid for, and rejected: it needs a tokenizer per model, the count moves when a vendor changes one, and CI would then fail for reasons no commit caused. Bytes are exact, local, and proportional enough to catch what this is for — prose growing without anyone deciding it should.
- **A separate `make budget` target and a CI step of its own.** More visible, and rejected as a second way to run one check. `make check` is what CI runs and what this repository tells an agent to run; a gate that lives outside it is a gate that is skipped locally.
- **A run-time check that refuses to start when the prompt is over budget.** Rejected: it moves a build-time fact into the one place it cannot be fixed, and it would fail in a user's terminal for a mistake made in a pull request.

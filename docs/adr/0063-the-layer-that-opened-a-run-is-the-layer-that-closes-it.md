---
status: accepted
---

# The layer that opened a Run is the layer that guarantees it closes

A Harness closes the Run it was handed, with the claim that is its account of the turn.
When it returns without closing one, the assembly that opened it closes it — failed, and
saying so — and that close is what the caller is told too. A Run closes once.

## The strongest invariant in the contract had nothing enforcing it

`Prompt.Recorder` says the Run is already open and that closing it is the Harness's own
act. Nothing checked. A Harness that returned early left a Run with no `Finished` record,
which a reader cannot tell from a Run still going — the exact failure ADR 0011 and the
Loop's own interrupt handling take pains to avoid, reachable by a plain early return in
any implementation of a public contract.

It is an invariant a comment cannot hold, because the layer with the comment is not the
layer that can check it. The assembly opened the Recorder. It is the only thing that
knows the Run exists and can see the Harness return.

## Why the claim replaces the Harness's own

The repaired close says the turn failed. The caller is handed that, and not the outcome
the Harness returned.

A Harness that did not close its Run did not answer the turn, so its account of how the
turn went is not one to put on a screen beside a record that says otherwise. Two accounts
of one turn, in two shapes, is how an interface comes to show something the Trace does
not hold — which the Loop already refuses for its own errors, for the same reason.

## Closing twice commits once

`Recorder.Finish` on a closed Run commits nothing and reports nothing. A Run closes on
the first account of it, and a second `Finished` record would leave a reader choosing
between two claims about one Run.

`Closed` says the close was *stated*, not that the Trace took it. A close the sink refused
is reported to whoever asked for it, and this Recorder does not then offer a second
account of the same Run.

## Considered options

- **Leave it to the contract.** Rejected. It is what was there, and the only thing
  standing between a Trace and an orphaned Run was every future Harness author reading a
  comment.
- **Repair it and keep the Harness's outcome.** Rejected. The screen would say the turn
  answered and the record would say it failed.
- **Return an error as well as the failed outcome.** Rejected. The Run did close, so the
  record holds the turn's account — and an error beside it is the second shape again. An
  error the Harness itself returned still travels, joined, because that one is a fact no
  Trace holds.

## Consequences

**`Assembly.Answer` is the one place this is known, so it is the one place it is
handled.** A Server, a Worker, and a console inherit it without knowing it happened.

**A Harness Eva did not write can be driven.** ADR 0045's registry admits implementations
this repository does not own, and the layer that opens the Run no longer trusts one to
close it.

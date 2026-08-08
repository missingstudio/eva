---
status: accepted
---

# A Recorder is told what it cannot see for itself

ADR 0013 gave the Recorder the job of closing a Run and composing its caveat, and named the thing that would break it:

> **Falsifier:** the Recorder can only raise what it can see for itself. The first degradation that comes from somewhere else — an estimated cost, a capability the harness does not have — cannot be discovered by watching commits, so `Finish` grows an argument or the Recorder grows a way to be told.

The real Provider produced two of them on its first turn.

A turn the API reported no usage for has a cost nobody knows. A turn the model stopped at the token cap has an answer that is not all of one. Neither leaves a mark on the committed stream: no Event says a figure was expected, and the frames of a truncated turn are the frames of a whole turn until the stop reason arrives. A Recorder watching commits sees a clean Run in both cases.

So the Recorder grows a way to be told.

```go
func (r *Recorder) Degrade(missing ...string)
```

`Finish` joins what it was told to what it saw and commits one `Degraded` — what it was told first, because that was known before the close and the unrecognised kinds are what the close itself works out. Everything ADR 0013 decided still holds: one caveat per Run, composed by the Recorder, committed with the claim, absent when the Run is clean.

`Degrade` writes nothing, so it takes no context and cannot fail. A degradation that could be lost to a cancelled call would be one the Trace is missing at exactly the moment it mattered.

## A Provider says it where it learns it

A Provider yields `events.Degraded` as a payload like any other, and `cli.Turn` routes it to `Degrade` instead of committing it. There is no second vocabulary for a Provider to speak — a Provider says what happened in the one Event schema, and the Turn decides what that means for the record.

Saying it where it is learned rather than saving it for the end is what keeps the composition honest. The truncation is known at `message_delta` and the unreported cost only at the end of the stream, so a Provider that noticed both emits two payloads. They arrive at different times, from different places in the stream, and they still close the Run as one record. A Turn that committed each payload as it arrived would put a caveat in the middle of a turn and a second one at the end, and that is the outcome a test now fails on.

## Consequences

**A Provider's caveat never becomes a record of its own.** `Turn.stream` intercepts `events.Degraded` before the content block accumulates. This is convention rather than compiler, the same gap ADR 0013 left around `Record` still accepting `events.Finished`, and it is the gap to close if a second Unit ever grows its own loop.

**A degradation is a sentence, not a code.** `Degrade` takes the words, because whoever knew the thing is the only one who can say what sort of thing it was — `what this turn cost: the provider reported no usage` rather than a flag a reader has to look up. It is read by someone working out why a Run was excluded from scoring.

**A repeat is one entry, in both lists.** `appendOnce` is now shared by what the Recorder was told and what it saw. A caveat says what was missing; it is not a measure of how often something noticed.

**Degrading a Run still never fails it.** A truncated answer closes with `done` and a caveat beside it. The turn did answer; the caveat says the answer is not all of one, and `Degraded` is what excludes it from scoring. Whether truncation should instead be the `Exhausted` Outcome is a question for the stage that builds budgets, where `budget_denied` already lives — not a question a Provider should settle by itself, and not one to settle by giving `Degrade` a second meaning.

**A failed Run gets no caveat.** The inverse also holds: a claim of failure is already the reason a Run is set aside, so a caveat qualifying it would say nothing the claim does not. This is why the Provider distinguishes a stream that ended from a stream that broke — without it, a turn that connected and then broke would carry "the provider reported no usage" while a turn that never connected at all carried nothing, which is an asymmetry with no meaning behind it.

**Falsifier:** this only works while every degradation has somewhere to be noticed from. A degradation that belongs to no Unit and no Provider — a Trace known to be incomplete because the disk filled, say — has no caller to call `Degrade`, and the sink cannot reach the Recorder. That is the next thing to break this, and the answer then is probably that the sink reports what it could not write rather than that the Recorder grows a third source.

## Considered options

- **`Finish(ctx, claim, missing ...string)`.** Fewer methods, and rejected: the degradations are discovered mid-stream, far from the close, so the Turn would have to hold them and hand them over — which is a Unit accumulating a caveat again, one forgotten variable away from the failure ADR 0013 exists to prevent.
- **Let the Provider's `Degraded` commit as its own record.** Simplest: `Turn.stream` already commits every payload that is not a text chunk, so this needed no code at all. Rejected: a Run with two caveats makes a reader work out which one qualified the claim, and a caveat that is not in the closing group is one a `kill -9` can separate from it.
- **A new payload kind for truncation.** Rejected: `Degraded` already means "this data is incomplete", which is exactly what a cut-off answer is. A kind per cause would grow the closed set for every new way to be incomplete.

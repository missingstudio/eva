---
status: accepted
---

# A Unit answers with an Outcome, and errors only when nothing recorded it

`Execute` returns two things, and until now it returned one fact in both of them.

```go
Execute(ctx context.Context, spec Spec) (Outcome, error)
```

A turn the Provider broke closed as `failed`, with the provider's words in the claim — and then returned that same error beside the Outcome. A turn somebody stopped closed as `failed` with the summary `interrupted`, and returned `context.Canceled`. Both callers got the whole story twice, in two shapes, and each of them believed a different half.

The one-shot command read the error first and the Outcome second. The console read the error and dropped the Outcome on the floor — the field was written on every turn and read on none — then worked out for itself, from the raw error, the same two-way classification the Turn had already made and committed:

```go
// what the Turn committed
case errors.Is(streamErr, context.Canceled):
    outcome = Outcome{Result: ResultFailed, Summary: "interrupted"}

// what the console said, independently
case errors.Is(a.err, context.Canceled):
    c.put(hint.Render("interrupted"))
```

Two classifications of one turn, agreeing by coincidence. The moment they stop agreeing, a person is reading a sentence the Trace does not support, and nothing in the process can tell them so. That is the failure this project has one instrument to detect, arriving through the return values rather than through the record.

So the fact is stated once.

**The Outcome is what happened.** Every way the work can end is a Result and a summary: `failed` with the provider's words, `failed` with `interrupted`, and later `needs_human` and `exhausted`. A Unit that also returned that as an error would be offering a second account of one turn, which is precisely what the caller must not have.

**The error is what no Outcome can carry.** A Recorder that could not stamp, a sink that would not take the group, a Trace that closed under the Run. Those leave the caller with nothing in the Trace to read instead, so they are the one thing that has to reach it directly.

## The distinction is made where the failure happens

By the time an error has travelled out of the stream loop, a provider that broke and a disk that filled are the same `error` value. They are told apart at the point of refusal instead, by the one place a group reaches the Recorder:

```go
func (b *blocks) commit(ctx context.Context, payloads ...events.Payload) error {
	if err := b.rec.Record(ctx, payloads...); err != nil {
		return unrecorded{err: err}
	}
	return nil
}
```

`Execute` closes the Run either way — the claim is committed under a context the cancellation cannot reach, exactly as before — and then reports the error only if the stream carried an `unrecorded` out.

## Consequences

**The console shows the claim.** What a person reads on a turn that did not answer is `Outcome.Summary`, which is the string the `Finished` record holds. The screen cannot disagree with the Trace because it is not deriving anything.

**A turn that failed exits non-zero from the Outcome, not from the error.** `answerOnce` already read `Result != done` and reported it; it now reads nothing else. The message a script sees gains the Result in front of it — `failed: provider anthropic: …` rather than the bare provider text — which is the claim as the Trace states it.

**`Turn.stream` is unchanged in what it commits.** A stream that broke still flushes what had arrived, still under `WithoutCancel`. The partial answer reaching the Trace was never the thing in question.

**This is a contract on `Unit`, not on `Turn`.** It is stated on the interface because the next Unit — a workflow, an agent, a harness — will meet the same choice, and the way to get it wrong is to return the failure twice because both channels are there.

**Falsifier:** this holds while every failure of the work has somewhere in the Outcome to be said. A failure that a Result cannot name and a summary cannot carry — one that needs structured detail a caller must switch on — would push a producer back to the error channel to say it. The answer then is a field on Outcome, not a second meaning for the error, because the error would once again be the shape nothing recorded.

## Considered options

- **Return the error and let each caller ignore the Outcome.** The status quo, and it is what produced the duplicated classification. It also makes the Outcome optional in practice, which makes it optional in fact.
- **Drop the error from `Execute` entirely and add a Result for it.** Rejected: the closed Result set describes the work, and "the Trace would not take this" is not something the work did. It would also put a value in the set that every consumer switching on Result would have to learn to ignore.
- **Have the Recorder report its own failures out of band.** Considered, and it is worse than it looks: the Recorder is shared with future parallel tool groups, so an out-of-band report has no single Unit to reach, and the Unit that most needs to know is the one whose group was refused.

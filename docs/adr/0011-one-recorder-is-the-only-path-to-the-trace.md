---
status: accepted
---

# One Recorder is the only path an Event takes to the Trace

A Unit says what happened. It does not stamp an envelope, choose a group, append to a sink, or tell anyone what it appended. `core.Recorder` does all four, behind one method:

```go
func (r *Recorder) Record(ctx context.Context, payloads ...events.Payload) error
```

The payloads of one call are one group: the sink commits them as one unit, and the Events that come back — with their Trace positions assigned — go to the Recorder's Subscribers in Trace order, after the commit.

Two things follow, and they are the reason for the decision.

**The group becomes real.** `TraceSink.Append` has always taken a group and promised that a group is written whole or not at all. Its only caller passed a group of one, six times a turn, so the promise was bought by nobody and the fold of ADR 0004 had nothing to fold within — a sink cannot coalesce across `Append` calls without buffering, and a sink that buffered would be reporting records as committed before they were written. Grouping at the caller is the missing half. It is what makes "no `tool_use` is ever persisted without its `tool_result`" a property of the writer at stage 2, rather than a rule contributors are expected to remember.

**There is one write path, so there is one transcript.** `Session` had a writer of its own. A turn appended the user's message before the stream and the assistant's message after it, and only when the stream succeeded — so a turn that failed halfway left the partial answer in the Trace and nothing in the Session. Two sources of truth, disagreeing, with nothing to detect it. `Session` now folds committed Events (`Committed`, satisfying `core.Subscriber`) and has no other way to learn anything. The same fold serves the live turn, resume replaying a stored Trace, and any projection that needs a transcript.

`--json` is a Subscriber for the same reason: what it prints is a projection of the Trace, so it prints what was committed rather than a second copy the producer made.

## The prompt is now a record

`Started` carries the Spec's intent. Without it the transcript's first message existed only in the process that answered it, and "anything a Trace cannot reconstruct is a second source of truth and a bug" was false of the most important message in the stream.

Adding a field is additive and keeps `SchemaVersion` at 1 (ADR 0006). Mid-run user input — steering — is a different thing and gets its own kind at stage 2; it is not this field.

## Consequences

**A Recorder belongs to one Run and is safe for concurrent use.** It holds the wire counter, and commits and publishes under one lock so that no Subscriber sees the Trace out of the order the Trace holds. A Subscriber must therefore not call `Record`. Stage 2 runs parallel tool groups against one Recorder, which is why this is decided now rather than found later.

**A Subscriber failure is reported and does not un-commit.** A broken output stream is a real failure. The Trace already holds the record, and the Trace is the source of truth.

**`core` gained `sync`, `errors`, and `fmt`.** Three lines on the allow list ADR 0010 keeps deliberately short, recorded here so they are not mistaken for drift. `core`'s test files are governed by a separate `core-tests` rule, so a package a test needs never becomes a package production code may import.

**Group boundaries are the caller's.** The Recorder does not guess where a turn's groups end. `cli.Turn` commits a content block at a time: everything already recorded survives the process dying, so buffering a whole turn would trade the property invariant 1 rests on for a smaller file.

**Falsifier:** if a Unit turns up that needs to emit without committing — a dry run, a preview, a speculative branch — then `Record` is the wrong shape and the seam moves. Revisit this ADR rather than reintroducing a second writer, which is what it exists to prevent.

## Considered options

- **Leave the triple at the call site and only add grouping.** Cheaper, and rejected: the Session divergence is not a grouping bug, and stage 2 adds several Units that would each rewrite stamp-commit-publish.
- **Fold text in the Recorder rather than the sink.** Would have contradicted ADR 0004 for no gain. The Recorder decides what commits together; the sink decides what merges. The split keeps both statements true.
- **Let `Session` keep its `Append` for the user's message, and fold only the assistant's.** Half a fold is not a fold — the first message would still be a second source of truth, and resume would still have nothing to rebuild it from.

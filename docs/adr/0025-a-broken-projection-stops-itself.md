---
status: accepted
---

# A broken projection stops itself, and the Run says one did

A Subscriber that returns an error is dropped from the Recorder's fan-out. Every other Subscriber keeps receiving every committed Event, and the Run gains a caveat saying a projection stopped following. The error still reaches the caller.

Publishing used to stop at the first Subscriber that failed. The loop returned, so every Subscriber registered behind the broken one never saw that Event — and never saw any Event of any later group either, because the next group failed at the same place.

## Why that was the wrong failure

The Trace held all of it. That is the part that makes this worse than it looks: nothing was lost, nothing was corrupt, and the file was complete the whole time. What was wrong was a projection that had silently stopped being one — a screen that had gone still while the record behind it kept growing, with nothing on the screen to say so.

A person watching a console that stopped updating cannot tell it from a model that stopped answering. Both look like nothing happening. The Trace is the only thing that can tell them apart, so it is the Trace that has to say which it was.

## What replaces it

Three things, and the third is the one that matters.

**A failure stops one Subscriber, not the loop.** Each is fed independently; a broken one takes itself out.

**A Subscriber that missed a record is not fed again.** A projection is a fold over a complete stream. One that skipped an Event cannot be made whole by the Events after it — it would keep drawing, keep looking correct, and be wrong in a way nothing downstream could detect. So it stops, rather than continuing as a plausible account of a Run it no longer follows.

**The Run records that it happened.** `Recorder.Degrade` already exists for what a Run cannot see for itself, and this is exactly that: the caveat commits with the claim (ADR 0013), so a reader of the Trace learns a projection went blind at the same moment they learn how the Run ended.

The caveat names the sort of thing that stopped rather than which Subscriber it was. The list is read by someone working out why a Run was set aside, and the identity of a projection is not something the Trace holds.

Errors are joined rather than replaced, so a caller that had three Subscribers break learns about three.

## Considered options

- **Keep feeding the broken Subscriber, with a mark saying it is behind.** This is what the rebuild plan proposed. It needs somewhere to put the mark, and `Committed(ctx, Event) error` has nowhere — so it means widening the one-method interface that every projection in the repository implements, to carry a flag almost none of them would read. A projection that ignored the mark would be the silent corruption this ADR is about, now with a field that says so.
- **Return on the first failure, as before, and document it.** Rejected. The behaviour is not surprising because it is undocumented; it is surprising because a Subscriber's own correctness depends on the reliability of a Subscriber it has never heard of and cannot see.
- **Let the Recorder retry a failed Subscriber.** Rejected. A Recorder does not know what failed or whether it is transient, and a retry under the publish lock would hold up the Trace behind a broken pipe.

## Consequences

**A Subscriber cannot recover within a Run.** A screen that failed one write is done for that Run even if the next write would have succeeded. That is deliberate — the alternative is a projection that is missing a record and does not know it — but it means a Subscriber whose failures are transient should absorb them itself and return nil, which is a thing its author must now decide on purpose.

**`Session` is a Subscriber, and it is the first one.** It never fails today. If it ever did, the transcript would stop folding while the Trace kept growing, and the caveat is what would say so.

**Falsifier:** if a Subscriber turns up whose failure is genuinely per-Event and carries no implication for the ones after it — a metrics tap that drops a sample — then dropping it for the Run is too strong, and the shape to reach for is a Subscriber that absorbs its own errors rather than a Recorder that forgives them.

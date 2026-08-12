---
status: accepted
---

# An interrupted Run closes

Ctrl-C in the console cancels the context the turn runs under. Everything the turn does after that point is done with a cancelled context, and a cancelled context is what the sink refuses to write under.

Left alone, that produces the worst record of the three possible ones. The Trace holds a Run that opened, some of an answer, and nothing else — and a Run with no `Finished` is indistinguishable from a Run that is still going. The one moment a reader most needs to know what happened is the moment the record stops saying.

So the close is out of reach of the cancellation:

```go
t.Recorder.Finish(context.WithoutCancel(ctx), outcome.Claim())
```

and so is the commit of whatever had arrived when the stream broke, for the same reason: the commonest way for a stream to end early is somebody stopping it, and that is not a reason to lose the part of the answer that did arrive.

## It closes as failed

The Result set is closed — `done | failed | needs_human | exhausted` — and none of those words is "interrupted". Adding one is a schema change to serve a word, and every consumer that switches on Result would meet a value it does not know.

An interrupted Run closes as `failed` with the summary `interrupted`. The summary is where the sentence goes; the Result is where the four-way decision goes, and "this Run did not produce an answer to act on" is the decision.

It gets no caveat. ADR 0014 settled that a claim of failure is already the reason a Run is set aside, so a `Degraded` over it would say nothing the claim does not.

## The capability is told, not assumed

`Interrupt` in `Capabilities` means "cancels cleanly", and it is now the first capability that differs between two Runs of one binary. The console listens for the cancellation and lets the Run close. A signal to the one-shot command kills the process where it stands, which is not a clean cancel however it looks from outside.

So `Turn.Interrupt` is told by whoever drives the Turn. A capability that is missing degrades a Run; a capability that is claimed and absent corrupts it, and a scheduler that routed work here on a false claim would have no way to find out.

ADR 0042 later gave the process surface the signal, which makes the second sentence of the first paragraph no longer true: a signal now cancels the Context the one-shot turn runs under, so that Run closes here like any other and claims `Interrupt` because it can honour it. Nothing else in this ADR changed — being told rather than assumed is exactly what let one path start claiming it without the other saying anything new.

## Consequences

**Cancellation stops the provider, not the record.** The context the Provider streams under is cancellable. The two commits that close the Run out are not. A caller who wanted to stop Eva writing to disk has no way to ask for that, which is correct: the Trace is the instrument, and an instrument that can be switched off from outside measures nothing.

**The Session survives the interrupt.** The transcript is a fold over what was committed, so the part of the answer that arrived is in it, and the next turn is conditioned on it. Cancelling is a normal act rather than a reason to start again.

**Falsifier:** `WithoutCancel` keeps the close reachable, not fast. A sink that blocked — a full disk, a network store at stage 6 — would hang the close with no deadline of its own, where the cancelled context would at least have ended it. The answer then is a deadline on the close rather than a cancellation of it, because the record still has to be written.

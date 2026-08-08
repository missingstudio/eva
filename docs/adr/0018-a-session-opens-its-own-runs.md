---
status: accepted
---

# A Session opens its own Runs

Opening a Run took nine fields, and six of them were already held by the Session the Run was against.

```go
core.NewRecorder(core.RecorderOptions{
	Sink:        e.sink,
	Tenant:      e.session.Tenant,
	Actor:       e.session.Actor,
	Run:         events.RunID(newID("run")),
	Session:     e.session.ID,
	Now:         now,
	NewID:       func() events.EventID { return events.EventID(newID("evt")) },
	Subscribers: append([]core.Subscriber{e.session}, e.subs...),
})
```

Every turn of every Session restated who was running, under which tenant, against which Session, and remembered to put the Session first among the Subscribers. A caller free to restate all that is a caller free to restate one of them wrongly, and an Event stamped with the wrong Session is one no fold will ever find — not the transcript, not resume, not a projection looking for it later. The Trace would hold it, correctly, and nothing would ever read it.

So the Session opens the Run:

```go
func (s *Session) Open(sink TraceSink, subs ...Subscriber) (*Recorder, error)
```

Nothing about identity is passed, because nothing about identity is the caller's. The Session subscribes itself first, because the transcript being folded before anyone else sees the Event was already a rule and is now a property.

## The clock and the identifiers are the Session's

`core` is pure and has neither, so they are still handed in from outside — but once, when the Session opens, rather than once per Run:

```go
type Origin struct {
	Now     func() events.Timestamp
	RunID   func() events.RunID
	EventID func() events.EventID
}
```

Once rather than per Run is the part that matters. A Session whose Runs were stamped from two different clocks would be a Session whose own records could not be ordered against each other, and ordering a Session's records is what a transcript *is*.

## What this buys the tests

`RecorderOptions` had five checks — no sink, no clock, no identifiers, no Run, no Session — and one construction site that always filled every field. They were unreachable in practice, guarding a caller that did not exist.

They now guard a real one. `Open` rejects a Session with no source of Run identifiers itself, because that one is called rather than passed and a nil called is a panic rather than a report; the other two reach `NewRecorder` and are reported in the words a caller of that would have read.

The larger gain is that a test can name the outside world. A Session opened with a clock that does not move and identifiers that count produces Events a test can assert on rather than only check the shape of — and a failure names `run_1` and `evt_2` rather than eight bytes of hex that mean nothing on the second reading.

## Consequences

**`NewSession` takes an Origin.** A Session built with an empty one still folds every Event a Trace holds — which is what resume does, and what a projection over somebody else's Trace does — and simply cannot open a Run of its own. That asymmetry is correct: reading a record needs no clock.

**`NewRecorder` stays exported.** It is the primitive, and `Open` is the deep interface over it. A Unit that one day needs a Recorder whose envelope the Session cannot supply — a Parent Run, at stage 2, when a tool call spawns one — has the primitive to reach for, and that is the moment to decide whether `Open` grows a parent or the Unit builds its own.

**`cli` keeps minting the identifiers.** The prefixes, the entropy, and the monotonic origin are all the frontend's, as ADR 0010 requires. What changed is that it hands them over once instead of on every turn.

**Falsifier:** this holds while a Run's envelope is a property of its Session. The first Run whose envelope differs from its Session's in something the Session cannot know — a Mandate narrower than the Session's, a tenant a sub-agent runs under — is a Run `Open` cannot stamp, and at that point either `Open` takes what differs or the caller goes back to the primitive. Revisit then rather than widening `Open` a field at a time until it is `RecorderOptions` again.

## Considered options

- **Leave the nine fields and add a helper in `cli`.** Cheaper, and it puts the rule in the layer that is allowed to get it wrong. The reason the Session is the right owner is that it is the only thing that cannot be mistaken about its own identity.
- **Give the Recorder the Session instead of the fields.** Rejected: `core.Recorder` would then hold a transcript it has no business reading, and a Recorder is per Run while a Session outlives every one of them.
- **Have `Open` take the sink at `NewSession` too.** Tempting, since the sink is also the same every time. Rejected: the sink is a resource the caller opens and closes, and a Session that held one would be a Session with a lifetime tied to a file.

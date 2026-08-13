---
status: accepted
---

# A frontend resumes by Trace position, and only a durable Event moves a Cursor

One stream carries both what arrived and what was committed, and each says which it is: a
record is an Event and carries its durable position, and a chunk is a chunk. A frontend
that reconnects resumes from its last Cursor, which is a Trace position and not a wire
position.

## Why one stream and not two

A turn is shown twice. The Live area shows it arriving, from the stream. The transcript
shows it afterwards, as a fold over what was committed. Only the record is kept
(ADR 0015).

In one process that is two paths, and they already exist: a chunk reaches whoever is
watching, and a committed group reaches the Recorder. Over a wire a client needs both,
or a remote console is visibly worse than a local one — which would break the falsifier
ADR 0047 carries.

Two streams would double the reconnection logic and invent an ordering question between
them. One stream carrying two named things needs neither.

A record and a chunk are told apart by which one the line holds, rather than by an absent
Trace position on a record-shaped thing: a record with no position is a shape the schema
does not have, and a reader should not need a rule to recover the difference (ADR 0061).

## Why Trace position and not wire position

The two sequences were separated for this (ADR 0008). `WireSeq` is assigned by the
producer, per connection. `Seq` is assigned by the sink at commit, per Session. They
diverge by construction, because the sink coalesces many chunks into one record and
commits a group atomically.

A Worker that reconnects is replaying a *connection*, so it resumes by `WireSeq`. A
frontend is folding a *Session*, so it resumes by `Seq`. Handing a frontend a wire
position would ask it to resume a connection it does not care about, and would break the
moment two connections served one Session.

`events.Cursor` already carries exactly `{Session, Seq}`, and its own documentation
already states the rule: *"A position in an Event stream that a consumer has durably
committed. Only a durable commit advances one."* This decision does not invent the
Cursor. It says which consumers hold one.

## What a dropped connection costs

Nothing. Everything committed is on disk (invariant 1), and an interrupted Run closes
(ADR 0016). A client reattaches with its Cursor and the server replays what follows.

That is why this is not optional. Rule 7 in `docs/explanation/the-ladder.md` says lost or
fabricated Trace data poisons the eval suite, which is the one instrument this project
has. A frontend that silently missed events would be a projection disagreeing with the
Trace, and nothing would report it.

## Considered options

- **Two streams, one live and one committed.** Rejected. Twice the reconnection logic,
  and a new ordering question between two channels describing one turn.
- **Committed Events only.** Rejected. The remote Live area becomes coarser than the
  local one, which is the two-code-paths failure ADR 0047 exists to prevent.
- **Resume by wire position.** Rejected. It is the Worker's mechanism, applied to a
  consumer that folds a Session rather than replaying a connection.

## Consequences

**A client can hold ADR 0015's rule itself.** Only a durable Event moves the Cursor, so
a client cannot accidentally treat a chunk as a record.

**A long-absent client may bound its own replay, and is told what was left out.** Replay
from a Cursor is linear in the records since it, so a client that was away for an hour
replays an hour. A client may therefore ask for the newest N records instead of all of
them, and the answer states the position it actually began at.

The bound is the client's to choose and the answer's to declare. Rule 12 governs the
second half: when a value hits a bound the system says so, and it never truncates in
silence. A client that asked for a bound and was given one knows its view starts mid-Session
and can ask for the rest.

The Cursor still governs correctness. A bounded replay does not move a Cursor past what the
client received, so a client that bounded its catch-up and then reconnected does not skip
the records it chose not to read.

**A checkpoint remains the eventual fix**, keyed by the Cursor that already names a durably
reached position, and `docs/decisions.md` keeps it as a known cost. The trigger is
unchanged: a Trace long enough to measure. The bound above makes that trigger later rather
than removing it.

**The server must retain enough to replay.** The Trace is the retention, so this adds no
store. It does mean a Session whose Trace was moved or truncated cannot serve a resume,
and it says so rather than serving a gap.

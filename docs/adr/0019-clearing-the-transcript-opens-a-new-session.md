---
status: accepted, the screen clause superseded by 0023
---

# Clearing the transcript opens a new Session

> ADR 0023 made the transcript a pane the console owns, so `/clear` now empties
> the screen as well as the Session. Read the consequence below that says it does
> not as no longer true. Everything else here stands, and one clause of it
> especially: the Trace still grows with what was cleared.

`/clear` empties the transcript without ending the process. The obvious implementation is one line:

```go
func (s *Session) Clear() { s.messages = nil }
```

That line makes the Session a second source of truth.

A Session has no writer of its own. It learns what happened by folding committed Events, which is what keeps the Trace the single account of a conversation. A Session that deleted its own messages would be a Session the Trace no longer describes: the Trace still holds every prompt and every answer, the fold no longer does, and from that moment the two disagree about one conversation. Replaying the file — which is what resume does, and what any projection over a stored Trace does — would rebuild exactly the messages `/clear` was asked to remove.

So the console swaps the Session instead:

```go
func (s *Session) Fresh(id events.SessionID) *Session {
	return NewSession(id, s.Tenant, s.Actor, s.origin)
}
```

A new identifier diverges from nothing. Every Event already committed is stamped with the old Session, `Committed` takes only the Events stamped with its own, and folding the file by identifier gives back exactly the transcripts the process had — two of them, in the order they existed. Nothing is deleted, and nothing has to be.

The identity is carried over because it is the same person at the same terminal under the same tenant. The `Origin` is carried over because a Session's Runs must be stamped from one clock (ADR 0018), and a second clock arriving at `/clear` would be a second clock in one process for no reason.

## The spend goes with it

The cost line reports what a turn cost and what the Session has cost. After `/clear` it is a different Session, so the cumulative figure restarts.

The alternative is a figure that outlives the Session it names, which is two conversations summed and reported as one, with nothing on screen to show the join. Nothing is lost by restarting it: every `Usage` record is in the Trace either way, and a total across Sessions is a question for a projection over the Trace rather than for a line in a console.

## Consequences

**One process writes several Sessions to one Trace file.** The sink already counts Trace position per Session, so this needed no change there — but it is now a case that happens rather than one the type merely allows.

**`/clear` does not clear the screen.** The transcript is the Session, and what is above the view is the terminal's scrollback. A person can still read what they said; the model cannot.

**The Trace grows with what was cleared.** That is the point. Emptying a context window is not deleting a record, and a `/clear` that shrank the Trace would be the one operation in Eva that destroys evidence.

**Falsifier:** this holds while emptying a transcript means starting over. The first operation that has to keep part of a transcript — rewind to a turn, branch from one — cannot be a new Session with nothing in it, because the part that is kept has to come from somewhere. At that point the answer is a fold over the Trace up to a Cursor, and `/clear` becomes the degenerate case of it: rewind to before the first turn. Revisit then, rather than growing `Fresh` an argument at a time.

## Considered options

- **`Session.Clear()`, emptying the messages in place.** One line, and it keeps one identifier for what a person experiences as one console. Rejected: it is the second source of truth this design exists to prevent, and it would be undetectable — the Trace and the fold each look correct on their own.
- **A `Cleared` Event the Session folds as "empty from here".** Faithful to the fold, and it keeps the Session identifier. Rejected for now: it puts a console convenience into a settled event schema, and it needs a Run to be recorded against — a Run with no turn in it, which every projection would then have to know about. Worth revisiting if rewind wants a record of what was cut.
- **Keep the cumulative spend across a clear.** Rejected: the word on the line is "session". A figure that means something else than the word beside it is worse than no figure.

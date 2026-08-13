---
status: accepted
---

# An answer is a record, and a rejection is one of its resolutions

One Kind is added. It names the `NeedsHuman` Event it resolves, says how the Question
ended, and carries the words when there are any.

```go
const KindResolved Kind = "resolved"

type Resolution string   // how a Question ended; the set is closed

const (
    ResolutionAnswered  Resolution = "answered"   // a person answered
    ResolutionRejected  Resolution = "rejected"   // a person declined to answer
    ResolutionExpired   Resolution = "expired"    // nobody answered in time
    ResolutionCancelled Resolution = "cancelled"  // the Run stopped while blocked
)

type Resolved struct {
    Question   EventID    `json:"question"`         // the NeedsHuman this resolves
    Resolution Resolution `json:"resolution"`
    Answer     string     `json:"answer,omitempty"` // absent unless answered
}
```

## The gap this closes

`KindNeedsHuman` is registered and `NeedsHuman{Question, Resume}` is in the schema.
Nothing records the reply.

So a Session that escalated and was answered could not be rebuilt from its Trace. The
Session has no writer of its own — it folds committed Events (ADR 0011) — so an answer
that reached only a process is an answer the fold cannot give back. That is invariant 1
failing quietly, in the one place a person's own words are the input.

## Why the Question is named by its Event

`NeedsHuman` gets no new field. Every Event already carries an `ID` that the Recorder
assigned at commit, so `Resolved` names the Question by the identity that already
exists.

A second identifier on `NeedsHuman` would be a second thing that could disagree with
the first, and the envelope's identity is the one a Trace already indexes.

## Why a rejection is a Resolution and not an Outcome

A person declining to answer is not an error, and it is not a failure of the Run. The
primitive already fixes what it is: *"Errors are data. Denied, unknown, failed,
canceled, and skipped tool calls all return error-shaped results. The model can recover
from these results."*

So a rejection is data. The Unit reads it and decides what follows — finish with what it
has, fail and say why, or ask something else. The Outcome is whatever the Unit reaches,
and no closed set widens.

That is what makes this cheap. `OutcomeKind` stays four values. `ErrorClass` stays
eight. Adding "a human declined" to either would have put a human's choice in a set that
otherwise describes machine failure.

## Why `Resolution` is its own set and not `Disposition`

`Disposition` says how a tool call ended, and it holds `unknown_tool` and
`budget_denied`. Neither can happen to a Question. A set half of whose values are
impossible for a subject is a set that subject does not belong to.

`expired` and `cancelled` are in the set because both happen without a person acting,
and a Question that ended unanswered has to say which. Silence would leave a blocked
Run indistinguishable from a resolved one.

## What the schema version does

`SchemaVersion` stays 2. ADR 0006 keeps the version for an additive change, and a new
Kind is additive.

A reader that does not know `resolved` sees `Unknown` with its bytes intact and marks
the Run Degraded (ADR 0002). That is the designed behaviour for an unrecognised kind
rather than an exception to it.

## Considered options

- **The answer arrives as user input, on `Started{Intent}` of a new Run.** Rejected. A
  new Run is not "resume the same call", which is the whole problem the design track
  names.
- **The answer is the tool call's `ToolResult`.** Rejected. `NeedsHuman` may fire
  *inside* a tool call that continues afterwards, so the answer is not that call's
  result. It is elegant for one case and wrong for the rest.
- **Record only that a Question was resolved, and keep the words out of the Trace.**
  Rejected. The words are the input the Run acts on, and a fold that cannot give them
  back cannot rebuild the Session.

## Consequences

**A blocked Run is a fold, not a flag.** A `NeedsHuman` with no matching `Resolved` is
blocked. The `blocked-on-human` state the scheduler needs at stage 9b is derived from
two records, so nothing invents a state field that could disagree with the Trace.

**A person's words enter the Trace.** They are subject to every rule that governs the
Trace, including redaction at the sink when that lands at stage 6.

**`NeedsHuman` stays both.** It is a mid-stream Event and a terminal Outcome. A Run that
was answered continues; a Run that nobody answered closes as `NeedsHuman`, which is the
honest terminal record.

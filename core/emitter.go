package core

import "github.com/missingstudio/eva/events"

// emitter stamps a payload with the envelope of the Run it belongs to, and
// assigns the wire position.
//
// It exists so that every producer stamps the same way. An envelope filled in
// by hand at each call site is an envelope that is eventually filled in
// wrongly, and a projection cannot fold a record whose fold keys are missing.
//
// It is unexported because a Recorder is the only thing that should hold one.
// A caller that could stamp an Event without committing it could produce a
// wire position the Trace never sees, and the two sequences of docs/adr/0008
// only mean something while every stamped Event is also an appended one.
//
// The id and the timestamp are arguments rather than something an emitter
// reads for itself, because core is pure: it has no clock and no source of
// entropy. The caller that owns the outside world supplies both.
type emitter struct {
	tenant  events.TenantID
	actor   events.Identity
	run     events.RunID
	session events.SessionID
	// parent is the tool call that spawned this Unit, and is nil on the main
	// conversation.
	parent *events.RunID

	wire uint64
}

// emit stamps a payload and takes the next wire position.
//
// Seq is deliberately left at zero. The wire position counts what was sent and
// the Trace position counts what was durably committed; only the sink may
// assign the second, and a zero there means "not yet committed". The two
// sequences are named apart so that a consumer cannot treat one as the other
// (docs/adr/0008).
func (e *emitter) emit(id events.EventID, at events.Timestamp, payload events.Payload) events.Event {
	kind, _ := events.KindOf(payload)
	wire := e.wire
	e.wire++

	return events.Event{
		ID:      id,
		WireSeq: wire,
		At:      at,
		Version: events.SchemaVersion,
		Kind:    kind,
		Tenant:  e.tenant,
		Actor:   e.actor,
		Run:     e.run,
		Session: e.session,
		Parent:  e.parent,
		Payload: payload,
	}
}

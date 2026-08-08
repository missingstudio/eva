package core

import "github.com/missingstudio/eva/events"

// Emitter stamps a payload with the envelope of the Run it belongs to, and
// assigns the wire position.
//
// It exists so that every producer stamps the same way. An envelope filled in
// by hand at each call site is an envelope that is eventually filled in
// wrongly, and a projection cannot fold a record whose fold keys are missing.
//
// The id and the timestamp are arguments rather than something an Emitter
// reads for itself, because core is pure: it has no clock and no source of
// entropy. The caller that owns the outside world supplies both.
type Emitter struct {
	Tenant  events.TenantID
	Actor   events.Identity
	Run     events.RunID
	Session events.SessionID
	// Parent is the tool call that spawned this Unit, and is nil on the main
	// conversation.
	Parent *events.RunID

	wire uint64
}

// Emit stamps a payload and takes the next wire position.
//
// Seq is deliberately left at zero. The wire position counts what was sent and
// the Trace position counts what was durably committed; only the sink may
// assign the second, and a zero there means "not yet committed". The two
// sequences are named apart so that a consumer cannot treat one as the other
// (docs/adr/0008).
func (e *Emitter) Emit(id events.EventID, at events.Timestamp, payload events.Payload) events.Event {
	kind, _ := events.KindOf(payload)
	wire := e.wire
	e.wire++

	return events.Event{
		ID:      id,
		WireSeq: wire,
		At:      at,
		Version: events.SchemaVersion,
		Kind:    kind,
		Tenant:  e.Tenant,
		Actor:   e.Actor,
		Run:     e.Run,
		Session: e.Session,
		Parent:  e.Parent,
		Payload: payload,
	}
}

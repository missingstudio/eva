package core

import "github.com/missingstudio/eva/internal/events"

type emitter struct {
	tenant  events.TenantID
	actor   events.Identity
	run     events.RunID
	session events.SessionID
	parent  *events.RunID

	wire uint64
}

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

package events

import "time"

// SchemaVersion versions the whole schema, and rides on every envelope.
//
// Adding a Kind or a nullable field is additive and keeps this number.
// Removing a field, retyping one, renaming one, or narrowing an enum
// increments it. Readers migrate old records on read; stored Traces are never
// rewritten. See docs/adr/0006.
const SchemaVersion uint32 = 1

type (
	// EventID identifies one Event.
	EventID string
	// TenantID identifies the tenant an Event belongs to. It is populated
	// from commit one, long before a second tenant exists, because adding it
	// later would touch every stored record, query, cache key, and object
	// path (docs/adr/0001).
	TenantID string
	// RunID identifies one execution of a Unit against a Session.
	RunID string
	// SessionID identifies the durable, resumable transcript.
	SessionID string
)

// ActorKind is what sort of thing an Identity is.
type ActorKind string

const (
	ActorHuman  ActorKind = "human"
	ActorAgent  ActorKind = "agent"
	ActorSystem ActorKind = "system"
)

// Identity is who or what an Event is attributed to.
type Identity struct {
	ID   string    `json:"id"`
	Kind ActorKind `json:"kind"`
}

// Cursor is a position in an Event stream that a consumer has durably
// committed. Only a durable commit advances one.
type Cursor struct {
	Session SessionID `json:"session"`
	Seq     uint64    `json:"seq"`
}

// Timestamp carries both clocks on purpose. Wall time is what a human reads
// and what orders records across machines; the monotonic reading is what
// latency per step is computed from, because a wall clock can step backwards.
// Go drops its own monotonic reading when a time.Time is marshalled, so the
// reading is carried as its own field.
type Timestamp struct {
	Wall time.Time `json:"wall"`
	Mono int64     `json:"mono_ns"`
}

// Kind names the payload an Event carries. The set is closed: a kind that is
// not listed arrives as KindUnknown with its bytes intact, and the Run is
// marked Degraded rather than the record being dropped (docs/adr/0002).
//
// Every kind is declared in payload.go, in one block beside the payload it
// names: the constant, the struct, its isPayload method, and its registration.
// Adding a kind is therefore four adjacent lines in one file rather than four
// edits in three, and the registration is what KindOf and the codec read — so
// there is no second switch that can silently disagree with the first.
//
// Kinds reports the registered set at run time, which is what makes the
// round-trip test exhaustive by construction rather than by a hand-typed list.
type Kind string

// Event is the one typed, versioned, sequence-numbered record that every
// observable thing in Eva is an instance of. There is no second vocabulary:
// Eva's own loop emits these, and an adapter for a foreign Harness normalizes
// into them.
//
// The envelope carries everything a projection needs in order to fold or
// filter. The payload carries only what a projection needs in order to
// display. See docs/adr/0001.
type Event struct {
	// ID identifies this record.
	ID EventID

	// Seq is the Trace position: per Session, assigned by the sink at commit.
	// Zero means the record has not been committed. It is not WireSeq, and
	// the two are named apart on purpose (docs/adr/0008).
	Seq uint64

	// WireSeq is the wire position: per connection, assigned by the producer,
	// so a reconnecting peer can resume from its last acknowledged cursor.
	WireSeq uint64

	// At is when the Event was produced.
	At Timestamp

	// Version is the SchemaVersion this record was written under.
	Version uint32

	// Kind names the payload. It is derived from the payload when the Event
	// is encoded, so the two cannot disagree.
	Kind Kind

	// Tenant and Actor are on every record from commit one.
	Tenant TenantID
	Actor  Identity

	// Run and Session attribute the record without replaying the stream.
	Run     RunID
	Session SessionID

	// Parent is the tool call that spawned this Unit, and is nil on the main
	// conversation. Without it a nested subagent's Events cannot be
	// attributed, and cost per task cannot be reported.
	Parent *RunID

	// Payload is display-only detail, behind a sealed interface.
	Payload Payload
}

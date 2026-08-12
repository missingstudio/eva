package events

import "time"

const SchemaVersion uint32 = 2

type (
	EventID string
	// TenantID identifies the tenant an Event belongs to. It is populated
	// from commit one, long before a second tenant exists, because adding it
	// later would touch every stored record, query, cache key, and object
	// path.
	TenantID  string
	RunID     string
	SessionID string
)

type ActorKind string

const (
	ActorHuman  ActorKind = "human"
	ActorAgent  ActorKind = "agent"
	ActorSystem ActorKind = "system"
)

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
// marked Degraded rather than the record being dropped.
type Kind string

// Event is the one typed, versioned, sequence-numbered record that every
// observable thing in Eva is an instance of. There is no second vocabulary:
// Eva's own loop emits these, and an adapter for a foreign Harness normalizes
// into them.
type Event struct {
	ID EventID

	// Seq is the Trace position: per Session, assigned by the sink at commit.
	// Zero means the record has not been committed. It is not WireSeq, and
	// the two are named apart on purpose.
	Seq uint64

	// WireSeq is the wire position: per connection, assigned by the producer,
	// so a reconnecting peer can resume from its last acknowledged cursor.
	WireSeq uint64

	At Timestamp

	Version uint32

	// Kind names the payload. It is derived from the payload when the Event
	// is encoded, so the two cannot disagree.
	Kind Kind

	Tenant TenantID
	Actor  Identity

	Run     RunID
	Session SessionID

	// Parent is the tool call that spawned this Unit, and is nil on the main
	// conversation. Without it a nested subagent's Events cannot be
	// attributed, and cost per task cannot be reported.
	Parent *RunID

	// Payload is display-only detail, behind a sealed interface.
	Payload Payload
}

package events

import (
	"encoding/json"
	"errors"
	"fmt"
)

// The encoding is a published contract. Adapters, extensions, and every
// --json consumer read it, so it is defined here once rather than left to
// whatever struct tags happen to be in scope.

var (
	// ErrNoPayload is returned when an Event carries no payload. Every Event
	// is an instance of some kind; there is no empty one.
	ErrNoPayload = errors.New("events: event has no payload")

	// ErrNoVersion is returned when an Event carries no schema version. A
	// record without one cannot be migrated on read, which is the whole
	// mechanism of docs/adr/0006.
	ErrNoVersion = errors.New("events: event has no schema version")

	// ErrKindMismatch is returned when an Event's Kind names something other
	// than the payload it holds.
	ErrKindMismatch = errors.New("events: kind and payload disagree")
)

// envelope is the wire shape. The payload stays raw on the way in so that an
// unrecognised kind can be preserved with its bytes untouched.
type envelope struct {
	ID      EventID         `json:"id"`
	Seq     uint64          `json:"seq"`
	WireSeq uint64          `json:"wire_seq"`
	At      Timestamp       `json:"at"`
	Version uint32          `json:"version"`
	Kind    Kind            `json:"kind"`
	Tenant  TenantID        `json:"tenant"`
	Actor   Identity        `json:"actor"`
	Run     RunID           `json:"run"`
	Session SessionID       `json:"session"`
	Parent  *RunID          `json:"parent"`
	Payload json.RawMessage `json:"payload"`
}

// MarshalJSON encodes an Event.
//
// Kind is derived from the payload rather than copied from the field, so the
// two cannot disagree in a stored record. A Kind that contradicts its payload
// is rejected rather than silently corrected, because a caller that set it is
// telling us something, and one of the two is a bug.
func (e Event) MarshalJSON() ([]byte, error) {
	if e.Payload == nil {
		return nil, ErrNoPayload
	}
	kind, ok := KindOf(e.Payload)
	if !ok {
		return nil, fmt.Errorf("events: %T is not a payload of this schema", e.Payload)
	}
	if e.Kind != "" && e.Kind != kind {
		return nil, fmt.Errorf("%w: kind %q, payload %T", ErrKindMismatch, e.Kind, e.Payload)
	}
	if e.Version == 0 {
		return nil, ErrNoVersion
	}

	payload, err := json.Marshal(e.Payload)
	if err != nil {
		return nil, fmt.Errorf("events: encode %s payload: %w", kind, err)
	}

	return json.Marshal(envelope{
		ID:      e.ID,
		Seq:     e.Seq,
		WireSeq: e.WireSeq,
		At:      e.At,
		Version: e.Version,
		Kind:    kind,
		Tenant:  e.Tenant,
		Actor:   e.Actor,
		Run:     e.Run,
		Session: e.Session,
		Parent:  e.Parent,
		Payload: payload,
	})
}

// UnmarshalJSON decodes an Event, switching on Kind to select the concrete
// payload type. A kind this build does not know becomes an Unknown holding the
// original bytes, and the Kind on the envelope becomes KindUnknown — the
// record is preserved rather than dropped, and the caller can see that it was
// not understood (docs/adr/0002).
func (e *Event) UnmarshalJSON(b []byte) error {
	var env envelope
	if err := json.Unmarshal(b, &env); err != nil {
		return fmt.Errorf("events: decode envelope: %w", err)
	}

	payload, kind, err := decodePayload(env.Kind, env.Payload)
	if err != nil {
		return err
	}

	*e = Event{
		ID:      env.ID,
		Seq:     env.Seq,
		WireSeq: env.WireSeq,
		At:      env.At,
		Version: env.Version,
		Kind:    kind,
		Tenant:  env.Tenant,
		Actor:   env.Actor,
		Run:     env.Run,
		Session: env.Session,
		Parent:  env.Parent,
		Payload: payload,
	}
	return nil
}

// decodePayload reads a payload back using the registry in payload.go. A kind
// with no registration is preserved as Unknown rather than dropped, which is
// the one branch here that is a decision rather than a lookup.
func decodePayload(kind Kind, raw json.RawMessage) (Payload, Kind, error) {
	decode, known := decoderByKind[kind]
	if !known {
		return Unknown{Kind: string(kind), Raw: raw}, KindUnknown, nil
	}
	payload, err := decode(raw)
	if err != nil {
		return nil, "", err
	}
	return payload, kind, nil
}

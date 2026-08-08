package core

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/missingstudio/eva/events"
)

// Subscriber receives each Event after it is durably committed, in Trace
// order.
//
// After, not before: a consumer that saw an Event the Trace does not hold
// would be reading a claim rather than a record. The Event a Subscriber
// receives carries the Trace position the Trace actually holds.
//
// A Subscriber is a projection, so it may not change what was committed. It
// may fail — a broken pipe on the machine-readable stream is a real failure —
// and its error reaches the caller, which is why the method returns one.
type Subscriber interface {
	Committed(ctx context.Context, e events.Event) error
}

// SubscriberFunc adapts a function to Subscriber.
type SubscriberFunc func(ctx context.Context, e events.Event) error

// Committed calls f.
func (f SubscriberFunc) Committed(ctx context.Context, e events.Event) error { return f(ctx, e) }

// RecorderOptions is everything a Recorder needs to stamp and commit.
//
// Now and NewID are supplied rather than read, because core is pure: it has no
// clock and no source of entropy. The layer that owns the outside world hands
// both in.
type RecorderOptions struct {
	// Sink is where committed Events land. Required.
	Sink TraceSink

	// The envelope every Event of this Run carries.
	Tenant  events.TenantID
	Actor   events.Identity
	Run     events.RunID
	Session events.SessionID
	// Parent is the tool call that spawned this Unit, and is nil on the main
	// conversation.
	Parent *events.RunID

	// Now and NewID are required: an Event with no timestamp cannot be
	// ordered across machines and an Event with no identity cannot be
	// deduplicated on replay.
	Now   func() events.Timestamp
	NewID func() events.EventID

	// Subscribers receive each committed Event, in the order given.
	Subscribers []Subscriber
}

// Recorder is the one way an Event reaches the Trace.
//
// It owns the three steps that used to sit at every call site — stamp the
// envelope, commit the group, publish what was committed — so that a Unit
// says what happened and nothing else. A Unit that wrote its own envelope
// could disagree with the next Unit about what a fold key means; a Unit that
// appended without publishing would leave the machine-readable stream showing
// a different turn from the Trace.
//
// Record takes a group because the sink commits a group as one unit: either
// every Event in it is stored or none is. That is what will make "no tool_use
// is ever persisted without its tool_result" a property of the writer rather
// than a rule contributors are expected to remember, and it is what gives the
// sink's fold something to fold within (docs/adr/0004).
//
// A Recorder belongs to one Run. It is safe for concurrent use, because stage
// 2 runs parallel tool groups and a wire counter that is only safe by
// convention is a data race waiting for its second goroutine.
type Recorder struct {
	sink  TraceSink
	now   func() events.Timestamp
	newID func() events.EventID
	subs  []Subscriber

	// mu covers the emitter's wire counter, the commit, and the publish, so
	// that two goroutines cannot interleave the Events of two groups and no
	// Subscriber sees the Trace out of the order the Trace holds.
	mu  sync.Mutex
	emt emitter
}

// NewRecorder builds a Recorder, or reports what the options are missing.
//
// The check is here rather than at the first Append because a Recorder with no
// clock fails on the Event that mattered, at the point where the only thing
// left to do is report the failure it should have prevented.
func NewRecorder(o RecorderOptions) (*Recorder, error) {
	switch {
	case o.Sink == nil:
		return nil, errors.New("core: a Recorder needs a TraceSink")
	case o.Now == nil:
		return nil, errors.New("core: a Recorder needs a clock")
	case o.NewID == nil:
		return nil, errors.New("core: a Recorder needs an identifier source")
	case o.Run == "":
		return nil, errors.New("core: a Recorder needs the Run it records")
	case o.Session == "":
		return nil, errors.New("core: a Recorder needs the Session it records")
	}

	return &Recorder{
		sink:  o.Sink,
		now:   o.Now,
		newID: o.NewID,
		subs:  append([]Subscriber(nil), o.Subscribers...),
		emt: emitter{
			tenant:  o.Tenant,
			actor:   o.Actor,
			run:     o.Run,
			session: o.Session,
			parent:  o.Parent,
		},
	}, nil
}

// Record stamps the payloads and commits them as one group.
//
// The group is atomic: either every Event in it reaches the Trace or none
// does. A rejected group takes no Trace position and leaves no gap, so the
// caller may retry it without the Trace showing a hole where the first attempt
// was.
//
// Committed Events go to the Subscribers in Trace order, after the sink
// returns. The sink may return fewer Events than were handed to it — it folds
// consecutive chunks of one content block into a single record — so what a
// Subscriber sees is what the Trace holds, not what the producer sent.
//
// A Subscriber that fails does not un-commit the group. The error is returned
// because a broken output stream is a real failure, but the Trace is the
// source of truth and it already holds the record.
// A Subscriber may not call Record: publishing happens under the same lock as
// committing, because a Subscriber that saw group 3 before group 2 would be
// reading the Trace out of the order the Trace holds.
func (r *Recorder) Record(ctx context.Context, payloads ...events.Payload) error {
	if len(payloads) == 0 {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	group := make([]events.Event, len(payloads))
	for i, payload := range payloads {
		if payload == nil {
			return fmt.Errorf("core: payload %d of %d is nil", i+1, len(payloads))
		}
		if _, known := events.KindOf(payload); !known {
			return fmt.Errorf("core: %T is not a payload of this schema", payload)
		}
		group[i] = r.emt.emit(r.newID(), r.now(), payload)
	}

	committed, err := r.sink.Append(ctx, group)
	if err != nil {
		return err
	}

	for _, e := range committed {
		for _, sub := range r.subs {
			if err := sub.Committed(ctx, e); err != nil {
				return fmt.Errorf("core: publish %s event: %w", e.Kind, err)
			}
		}
	}
	return nil
}

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
// sink's fold something to fold within.
//
// A Recorder belongs to one Run. It is safe for concurrent use, because stage
// 2 runs parallel tool groups and a wire counter that is only safe by
// convention is a data race waiting for its second goroutine.
type Recorder struct {
	sink  TraceSink
	now   func() events.Timestamp
	newID func() events.EventID
	subs  []Subscriber

	// mu covers the emitter's wire counter, the commit, the publish, and what
	// the Run did not understand, so that two goroutines cannot interleave the
	// Events of two groups and no Subscriber sees the Trace out of the order
	// the Trace holds.
	mu  sync.Mutex
	emt emitter
	// unknownKinds names each Event kind this build does not recognise that
	// the Run has committed, once, in the order it met them. It holds the
	// kinds themselves rather than the sentences they become, so that what is
	// compared for repeats is the kind and not its wording. Finish is what
	// turns it into the Run's Degraded record.
	unknownKinds []string
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

	return r.commit(ctx, payloads...)
}

// Finish closes the Run: the claim it makes about itself, and the caveat on
// that claim, as one group.
//
// The caveat is not the caller's to remember. A Run that committed a record
// nobody understood and then claimed a clean finish would leave a Trace that
// is structurally valid and quietly wrong, and the Trace is the only
// instrument the project has. The Recorder is the one path an Event takes to
// the Trace and therefore the only thing that sees all of them, so it composes
// the two rather than trusting each Unit to.
//
// This is the one group the Recorder decides the boundary of. Everywhere else
// the caller decides what commits together, and the caveat is the exception
// because it belongs to no producer: it is a property of what the Trace holds.
//
// Degraded is omitted when the Run is clean, because its presence is the flag:
// a gate reads whether the record is there rather than reading a boolean
// inside it.
func (r *Recorder) Finish(ctx context.Context, claim events.Claim) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	finished := events.Finished{Claim: claim}
	if len(r.unknownKinds) == 0 {
		return r.commit(ctx, finished)
	}

	// The caveat is first in the group, because Finished is what closes the
	// Run and a record behind it would be one the close does not cover.
	//
	// An entry says what sort of thing was not understood, rather than naming
	// the kind alone: this list is read by someone working out why a Run was
	// excluded, and "quantum_flux" on its own does not say whether a record or
	// a figure is meant.
	missing := make([]string, len(r.unknownKinds))
	for i, kind := range r.unknownKinds {
		missing[i] = fmt.Sprintf("unknown event kind %q", kind)
	}
	return r.commit(ctx, events.Degraded{Missing: missing}, finished)
}

// commit is the body of Record, and runs with mu held. Finish needs to read
// what the Run did not understand and commit in one step, which a second call
// to Record could not do: the two would be separated by anything another
// goroutine committed in between.
func (r *Recorder) commit(ctx context.Context, payloads ...events.Payload) error {
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

	// What the Run did not understand is noted before anything is published,
	// because it is a property of what the Trace holds. A Subscriber that
	// breaks half way through stops the publishing; it does not unsee a record
	// the Trace already has.
	for _, e := range committed {
		r.noteUnknown(e)
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

// noteUnknown collects the kind of a committed Event this build does not
// recognise.
//
// It reads what the sink returned rather than what the producer sent, because
// what degrades a Run is what its Trace holds. Each kind is named once however
// many records of it arrive: the list says what was not understood, not how
// often.
func (r *Recorder) noteUnknown(e events.Event) {
	unknown, ok := e.Payload.(events.Unknown)
	if !ok {
		return
	}
	for _, already := range r.unknownKinds {
		if already == unknown.Kind {
			return
		}
	}
	r.unknownKinds = append(r.unknownKinds, unknown.Kind)
}

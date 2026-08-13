package core

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/missingstudio/eva/internal/events"
)

type Subscriber interface {
	Committed(ctx context.Context, e events.Event) error
}

type SubscriberFunc func(ctx context.Context, e events.Event) error

func (f SubscriberFunc) Committed(ctx context.Context, e events.Event) error { return f(ctx, e) }

type RecorderOptions struct {
	Sink TraceSink

	// The envelope every Event of this Run carries.
	Tenant  events.TenantID
	Actor   events.Identity
	Run     events.RunID
	Session events.SessionID
	Parent  *events.RunID

	// Now and NewID are required: an Event with no timestamp cannot be
	// ordered across machines and an Event with no identity cannot be
	// deduplicated on replay.
	Now   func() events.Timestamp
	NewID func() events.EventID

	Subscribers []Subscriber
}

// Recorder is the one way an Event reaches the Trace.
type listener struct {
	sub    Subscriber
	failed bool
}

type Recorder struct {
	sink  TraceSink
	now   func() events.Timestamp
	newID func() events.EventID
	subs  []listener

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
	// toldMissing names what the Recorder could not have seen for itself, in the
	// order it was told. These are already sentences, because whoever knew
	// the thing is the only one who can say what sort of thing it was.
	toldMissing []string
	// closed says the Run has been closed. A Run closes once, on the first
	// account of it: two Finished records would leave a reader choosing which
	// of them the Run ended on.
	closed bool
}

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

	subs := make([]listener, 0, len(o.Subscribers))
	for _, sub := range o.Subscribers {
		subs = append(subs, listener{sub: sub})
	}

	return &Recorder{
		sink:  o.Sink,
		now:   o.Now,
		newID: o.NewID,
		subs:  subs,
		emt: emitter{
			tenant:  o.Tenant,
			actor:   o.Actor,
			run:     o.Run,
			session: o.Session,
			parent:  o.Parent,
		},
	}, nil
}

func (r *Recorder) Record(ctx context.Context, payloads ...events.Payload) error {
	if len(payloads) == 0 {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	return r.commit(ctx, payloads...)
}

func (r *Recorder) Degrade(missing ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, entry := range missing {
		if entry != "" {
			r.toldMissing = appendOnce(r.toldMissing, entry)
		}
	}
}

// Closed says whether this Recorder has already stated the Run's close. It is
// what lets the layer that opened a Run tell a Unit that closed it from one
// that returned without closing it — a fault only that layer is in a position
// to repair. It says the close was stated rather than that the Trace took it:
// a close the sink refused is reported to whoever asked for it, and this
// Recorder does not offer a second account of the same Run.
func (r *Recorder) Closed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closed
}

// Finish closes the Run with the claim its Unit makes about it. Closing a Run
// that is already closed commits nothing: the Run closed on the first account
// of it, and a second Finished record would leave a reader choosing between
// two.
func (r *Recorder) Finish(ctx context.Context, claim events.Claim) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.closed {
		return nil
	}
	r.closed = true

	finished := events.Finished{Claim: claim}
	if len(r.toldMissing) == 0 && len(r.unknownKinds) == 0 {
		return r.commit(ctx, finished)
	}

	// One caveat closes a Run, whatever it was assembled from. Two Degraded
	// records would make a reader ask which of them qualified the claim.
	missing := make([]string, 0, len(r.toldMissing)+len(r.unknownKinds))
	missing = append(missing, r.toldMissing...)
	for _, kind := range r.unknownKinds {
		missing = append(missing, fmt.Sprintf("unknown event kind %q", kind))
	}

	// The caveat is first in the group, because Finished is what closes the
	// Run and a record behind it would be one the close does not cover.
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

	// Every Subscriber still following gets every committed Event, and a
	// failure stops the Subscriber that returned it rather than the loop. One
	// broken projection used to end the publishing where it stood, so a
	// Subscriber registered behind a broken one silently stopped receiving a
	// Trace that was being written the whole time — and nothing anywhere
	// said so.
	var failures []error
	for _, e := range committed {
		for i := range r.subs {
			if r.subs[i].failed {
				continue
			}
			if err := r.subs[i].sub.Committed(ctx, e); err != nil {
				r.subs[i].failed = true
				r.toldMissing = appendOnce(r.toldMissing, projectionMissing)
				failures = append(failures, fmt.Errorf("core: publish %s event: %w", e.Kind, err))
			}
		}
	}
	return errors.Join(failures...)
}

// projectionMissing is what a Run says about itself when a Subscriber stopped
// following it. It names the sort of thing that is missing rather than which
// Subscriber it was: the list is read by someone working out why a Run was set
// aside, and the identity of a projection is not something the Trace holds.
const projectionMissing = "a projection stopped following this Run, and is missing records the Trace holds"

// noteUnknown collects the kind of a committed Event this build does not
// recognise.
func (r *Recorder) noteUnknown(e events.Event) {
	if unknown, ok := e.Payload.(events.Unknown); ok {
		r.unknownKinds = appendOnce(r.unknownKinds, unknown.Kind)
	}
}

func appendOnce(list []string, entry string) []string {
	for _, already := range list {
		if already == entry {
			return list
		}
	}
	return append(list, entry)
}

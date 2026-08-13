package harness

import (
	"context"
	"errors"
	"sync"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

// Assembly holds a Session and the Harness that answers on it. It opens one Run
// per prompt, guarantees that Run closes, and commits what the Harness emits. A
// frontend, a Server, and a daemon each reach this rather than rebuilding it.
//
// It is the Session API called in the same process (ADRs 0047, 0061): five of
// its methods carry a distance's context and error, and cannot fail with one.
type Assembly struct {
	harness Harness
	sink    core.TraceSink

	// newSession mints the identity a cleared transcript starts under. See
	// Clear, and ADR 0019 for why clearing opens a Session rather than emptying
	// one.
	newSession func() events.SessionID

	// mu covers everything a turn is answered with. A Server answers several
	// clients against one Session, and a console reads the model while a turn
	// runs, so none of the fields below belong to one goroutine.
	mu      sync.Mutex
	session *core.Session
	model   string

	// watchers are who is told what happens. A watcher whose context has ended
	// has stopped watching, which is what makes a Frontend leaving one act
	// rather than two, and the same act on either Transport.
	watchers []watcher

	closed bool
}

// watcher is one attachment: what it is told after the Trace holds a record,
// and what it is told while a turn is still arriving. Either may be nil, and
// neither implies the other.
type watcher struct {
	// left is what says this watcher has gone. A watcher is dropped when the
	// context it attached under ends, and it is read at the turn rather than
	// waited on by a goroutine — so a Frontend that left is one no turn tells,
	// with nothing running in between to notice.
	left context.Context

	sub      core.Subscriber
	arriving func(chunk string)
}

func (w watcher) gone() bool { return w.left != nil && w.left.Err() != nil }

// AssemblyOptions is the parts one Assembly is built from.
type AssemblyOptions struct {
	Harness Harness
	Sink    core.TraceSink
	Session *core.Session

	// Model is which model answers, as configuration named it.
	Model string

	// NewSessionID mints the identity a cleared transcript starts under.
	NewSessionID func() events.SessionID
}

func New(o AssemblyOptions) (*Assembly, error) {
	switch {
	case o.Harness == nil:
		return nil, errors.New("harness: an Assembly needs a Harness to answer with")
	case o.Sink == nil:
		return nil, errors.New("harness: an Assembly needs a TraceSink")
	case o.Session == nil:
		return nil, errors.New("harness: an Assembly needs a Session to answer against")
	case o.NewSessionID == nil:
		return nil, errors.New("harness: an Assembly needs a source of Session identifiers")
	}

	return &Assembly{
		harness:    o.Harness,
		sink:       o.Sink,
		session:    o.Session,
		model:      o.Model,
		newSession: o.NewSessionID,
	}, nil
}

// Answer runs one prompt as one Run and returns when the Run is closed. An
// answer that failed says so in its Outcome; an error is the record failing.
func (a *Assembly) Answer(ctx context.Context, intent string) (core.Outcome, error) {
	session, model, subs, arriving, interrupt := a.forTurn()

	recorder, err := session.Open(a.sink, subs...)
	if err != nil {
		return core.Outcome{}, err
	}

	outcome, err := a.harness.Answer(ctx, Prompt{
		Spec: core.Spec{
			Tenant: session.Tenant,
			Actor:  session.Actor,
			Intent: intent,
		},
		Recorder:  recorder,
		Session:   session,
		Model:     model,
		Interrupt: interrupt,
		Arriving:  arriving,
	})
	if recorder.Closed() {
		return outcome, err
	}
	return a.abandoned(ctx, recorder, err)
}

// abandoned closes a Run the Harness returned from without closing, which is a
// Run no reader can tell from one still going (ADR 0063).
//
// It returns the close it wrote rather than the claim the Harness made: one that
// did not close its Run did not answer the turn, so its account of how the turn
// went is not one to show beside a record that says otherwise.
func (a *Assembly) abandoned(ctx context.Context, recorder *core.Recorder, reported error) (core.Outcome, error) {
	outcome := core.Outcome{
		Result:  events.ResultFailed,
		Summary: "the harness returned without closing this Run",
	}
	// Out of reach of the cancellation, for the reason every close is: the
	// commonest way for a turn to end early is somebody stopping it, and a Run
	// stopped is exactly the one whose close would otherwise be cancelled with
	// it.
	closing := recorder.Finish(context.WithoutCancel(ctx), outcome.Claim())

	// Whatever the Harness reported still travels beside it: a record that
	// failed is the one fact no Trace holds, and closing the Run it left open
	// did not make that untrue.
	return outcome, errors.Join(reported, closing)
}

// forTurn takes one reading of everything the turn is answered with, so that a
// turn is answered against the Session it opened on. A Session cleared while a
// turn is in flight leaves that turn recording where it started, rather than
// splitting one Run across two transcripts.
func (a *Assembly) forTurn() (*core.Session, string, []core.Subscriber, func(string), bool) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Whoever has left is dropped here rather than watched for. A turn is the
	// only moment the answer matters, and a goroutine per watcher would be a
	// goroutine per Frontend that ever attached.
	live := a.watchers[:0]
	for _, w := range a.watchers {
		if !w.gone() {
			live = append(live, w)
		}
	}
	a.watchers = live

	var (
		subs []core.Subscriber
		told []func(string)
	)
	for _, w := range a.watchers {
		if w.sub != nil {
			subs = append(subs, w.sub)
		}
		if w.arriving != nil {
			told = append(told, w.arriving)
		}
	}

	// Watching is the claim. Something following a turn is something that can
	// stop one, so the capability is claimed by the act rather than assumed —
	// and a watcher that is told nothing still claims it, because what listens
	// for the cancellation is the Frontend and not what it asked to be told.
	interrupt := len(a.watchers) > 0

	var arriving func(string)
	if len(told) > 0 {
		arriving = func(chunk string) {
			for _, tell := range told {
				tell(chunk)
			}
		}
	}
	return a.session, a.model, subs, arriving, interrupt
}

// Watch attaches a Frontend to what happens: what was committed after the Trace
// holds it, and what is arriving before any of it is. Watching claims the
// Interrupt capability, because something following a turn is something that
// can stop one. The watcher is dropped when ctx ends.
func (a *Assembly) Watch(ctx context.Context, sub core.Subscriber, arriving func(chunk string)) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.watchers = append(a.watchers, watcher{left: ctx, sub: sub, arriving: arriving})
	return nil
}

// Model is which model the turns that follow will use.
func (a *Assembly) Model(context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.model, nil
}

// UseModel switches the model, from the next turn on. The Session is not
// disturbed: what a model change is for is answering the same conversation with
// something else.
func (a *Assembly) UseModel(_ context.Context, model string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.model = model
	return nil
}

// Clear empties the transcript by opening a new Session over the same identity,
// the same sink, and the same Harness. Session.Fresh has why it is a new one.
func (a *Assembly) Clear(context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.session = a.session.Fresh(a.newSession())
	return nil
}

// Session is which Session the turns that follow are answered against. It is
// a fact about this process rather than a method of the Session API: what
// crosses a wire is the transcript, and this is the identity holding it.
func (a *Assembly) Session() events.SessionID {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.session.ID
}

// Close ends the Trace. A Trace that failed to flush is not a successful run,
// whatever a turn claimed, so what this returns is reported rather than
// dropped.
func (a *Assembly) Close() error {
	a.mu.Lock()
	already := a.closed
	a.closed = true
	a.mu.Unlock()

	if already {
		return nil
	}
	return a.sink.Close()
}

// Watching is how many Frontends are following this Session. A Frontend that
// left is not one of them, and the answer is the same on either Transport:
// what makes a watcher gone is the context it attached under ending.
func (a *Assembly) Watching() int {
	a.mu.Lock()
	defer a.mu.Unlock()

	live := 0
	for _, w := range a.watchers {
		if !w.gone() {
			live++
		}
	}
	return live
}

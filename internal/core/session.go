package core

import (
	"context"
	"errors"

	"github.com/missingstudio/eva/internal/events"
)

// Author is who said a Message.
//
// The word every model API uses here is "role", which the glossary retires: a
// role is part of what a Mandate contains, and one concept gets one name.
type Author string

const (
	AuthorSystem    Author = "system"
	AuthorUser      Author = "user"
	AuthorAssistant Author = "assistant"
)

// Message is one entry in the transcript.
type Message struct {
	Author Author
	Text   string
}

// Session is the durable, resumable transcript. It is what survives kill -9,
// and what resume, branch, and rewind act on. A Session that is resumed twice
// has one Session and several Runs.
//
// # It is a fold, not a copy
//
// A Session has no writer of its own. It learns what happened by folding
// committed Events, which is the only way the Trace can stay the single source
// of truth: a transcript assembled beside the Trace is a second source of
// truth, and the two diverge on the first turn that fails halfway — the Trace
// holding the partial answer the Session never heard about.
//
// So the same fold serves three callers that would otherwise each write their
// own: the live turn, resume replaying a stored Trace, and any projection that
// needs the transcript. Anything a Trace cannot reconstruct is a bug, and this
// is the code that does the reconstructing.
type Session struct {
	ID     events.SessionID
	Tenant events.TenantID
	Actor  events.Identity

	origin Origin

	messages []Message

	// openRun is the Run whose assistant Message is still being appended to,
	// and runIsOpen says whether there is one. Text records of a single Run
	// fold into a single Message, because a Run is one execution of a Unit and
	// a transcript entry is one thing said.
	//
	// The flag is not redundant with an empty openRun: a Run identifier is a
	// string, and "no Run is open" must not be a value a Run could hold.
	openRun   events.RunID
	runIsOpen bool
}

// Origin is the outside world a Session needs in order to open a Run: a clock,
// and a source of identifiers.
//
// core is pure and reaches nothing outside itself, so the layer that owns the
// outside world hands both in. It hands them in once, when the Session opens,
// rather than once per Run — a Session that minted its Runs from two different
// clocks would be a Session whose own transcript could not be ordered.
//
// A test supplies a clock that does not move and identifiers that count, which
// is what makes a committed Event something a test can assert on rather than
// only check the shape of.
type Origin struct {
	Now     func() events.Timestamp
	RunID   func() events.RunID
	EventID func() events.EventID
}

// NewSession opens a Session under an identity, against the outside world it
// will open its Runs with.
func NewSession(id events.SessionID, tenant events.TenantID, actor events.Identity, origin Origin) *Session {
	return &Session{ID: id, Tenant: tenant, Actor: actor, origin: origin}
}

// Open opens a Recorder for one new Run of this Session.
//
// A Recorder belongs to one Run, so a Session of many turns opens many. What is
// not opened again is the Session: the transcript folds across every Run of it,
// which is what makes the second prompt answered in the light of the first.
//
// Everything the envelope of a Run carries is already here — the tenant, the
// actor, the Session, and the clock and identifiers that stamp it — so a caller
// asks for a Run rather than restating who is running it. A caller free to
// restate it is a caller free to get it wrong, and an Event stamped with the
// wrong Session is one no fold will ever find.
//
// The Session is always the first Subscriber, so the transcript is folded
// before the Event reaches anyone else. Every Subscriber is a projection of the
// same committed record; the order only decides which is built first.
func (s *Session) Open(sink TraceSink, subs ...Subscriber) (*Recorder, error) {
	// The other two are checked by NewRecorder, in the words a caller of that
	// would have read. This one is checked here because it is called rather
	// than passed, and a nil called is a panic rather than a report.
	if s.origin.RunID == nil {
		return nil, errors.New("core: a Session needs a source of Run identifiers to open a Run")
	}

	return NewRecorder(RecorderOptions{
		Sink:        sink,
		Tenant:      s.Tenant,
		Actor:       s.Actor,
		Session:     s.ID,
		Run:         s.origin.RunID(),
		Now:         s.origin.Now,
		NewID:       s.origin.EventID,
		Subscribers: append([]Subscriber{s}, subs...),
	})
}

// Fresh opens a new Session under the same identity, against the same outside
// world.
//
// It is what emptying a transcript is. A Session that deleted its own messages
// would be a transcript the Trace cannot reconstruct: the Trace would still
// hold every one of them, the fold would not, and the two accounts of one
// conversation would disagree from that moment on — which is the second source
// of truth this type is written to prevent.
//
// A new identifier diverges from nothing. The Trace holds both Sessions, each
// fold takes only the Events stamped with its own, and replaying the file gives
// back exactly the transcripts the process had.
func (s *Session) Fresh(id events.SessionID) *Session {
	return NewSession(id, s.Tenant, s.Actor, s.origin)
}

// Session satisfies Subscriber, which is how it is fed.
var _ Subscriber = (*Session)(nil)

// Committed folds one committed Event into the transcript.
//
// Only the kinds that say something fold: Started carries the Spec's intent
// and opens the transcript with it, and Text is what the assistant said. Every
// other kind is real and recorded and simply is not a Message — usage is a
// cost, a retry is an attempt, and neither belongs in what the next provider
// call is conditioned on.
//
// An Event for another Session is ignored rather than rejected, so that one
// Subscriber can sit on a Trace that carries more than one.
func (s *Session) Committed(_ context.Context, e events.Event) error {
	if e.Session != s.ID {
		return nil
	}

	switch payload := e.Payload.(type) {
	case events.Started:
		s.closeRun()
		if payload.Intent != "" {
			s.messages = append(s.messages, Message{Author: AuthorUser, Text: payload.Intent})
		}

	case events.Text:
		if s.runIsOpen && s.openRun == e.Run && len(s.messages) > 0 {
			s.messages[len(s.messages)-1].Text += payload.Chunk
			return nil
		}
		s.messages = append(s.messages, Message{Author: AuthorAssistant, Text: payload.Chunk})
		s.openRun, s.runIsOpen = e.Run, true

	case events.Finished:
		s.closeRun()
	}
	return nil
}

// closeRun ends the assistant Message a Run was appending to, so that the next
// Text starts a new entry rather than extending an entry from a Run that is
// over.
func (s *Session) closeRun() {
	s.openRun, s.runIsOpen = "", false
}

// Messages returns the transcript. The copy is deliberate: a caller that
// mutated the slice would be editing history, which is what branch and rewind
// exist to do properly.
func (s *Session) Messages() []Message {
	out := make([]Message, len(s.messages))
	copy(out, s.messages)
	return out
}

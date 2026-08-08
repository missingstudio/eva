package core

import (
	"context"

	"github.com/missingstudio/eva/events"
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

// NewSession opens a Session under an identity.
func NewSession(id events.SessionID, tenant events.TenantID, actor events.Identity) *Session {
	return &Session{ID: id, Tenant: tenant, Actor: actor}
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

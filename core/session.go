package core

import "github.com/missingstudio/eva/events"

// Author is who said a Message.
//
// The word every model API uses here is "role", which CONTEXT.md retires: a
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
// The transcript held here is the working copy for the current process. The
// durable copy is the Trace, which is the single source of truth: anything a
// Trace cannot reconstruct is a second source of truth and a bug.
type Session struct {
	ID     events.SessionID
	Tenant events.TenantID
	Actor  events.Identity

	messages []Message
}

// NewSession opens a Session under an identity.
func NewSession(id events.SessionID, tenant events.TenantID, actor events.Identity) *Session {
	return &Session{ID: id, Tenant: tenant, Actor: actor}
}

// Append adds a Message to the transcript.
func (s *Session) Append(m Message) {
	s.messages = append(s.messages, m)
}

// Messages returns the transcript. The copy is deliberate: a caller that
// mutated the slice would be editing history, which is what branch and rewind
// exist to do properly.
func (s *Session) Messages() []Message {
	out := make([]Message, len(s.messages))
	copy(out, s.messages)
	return out
}

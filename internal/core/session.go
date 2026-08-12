package core

import (
	"context"
	"errors"
	"sync"

	"github.com/missingstudio/eva/internal/events"
)

type Author string

const (
	AuthorSystem    Author = "system"
	AuthorUser      Author = "user"
	AuthorAssistant Author = "assistant"
)

type Block interface{ isBlock() }

type Text struct{ Text string }

func (Text) isBlock() {}

type ToolCall struct {
	ID   string
	Name string
	Args string
}

func (ToolCall) isBlock() {}

type ToolResult struct {
	Call        string
	Name        string
	Disposition events.Disposition
	Content     string
}

func (ToolResult) isBlock() {}

type Message struct {
	Author Author
	Blocks []Block
}

// Say is an entry that is nothing but words, which is what most of them are.
func Say(author Author, text string) Message {
	return Message{Author: author, Blocks: []Block{Text{Text: text}}}
}

func (m Message) Said() string {
	var out string
	for _, block := range m.Blocks {
		if text, isText := block.(Text); isText {
			out += text.Text
		}
	}
	return out
}

// Session is the durable, resumable transcript. It is what survives kill -9,
// and what resume, branch, and rewind act on. A Session that is resumed twice
// has one Session and several Runs.
type Session struct {
	ID     events.SessionID
	Tenant events.TenantID
	Actor  events.Identity

	origin Origin

	// mu covers the fold. A Session opens a Recorder per Run and outlives all
	// of them, so two Runs of one Session fold into this transcript from two
	// goroutines — each holding its own Recorder's lock, neither holding a lock
	// the other can see. A frontend that answers one turn at a time is what
	// keeps that from happening today, and a frontend is not a place to keep an
	// invariant the type can hold itself.
	mu       sync.Mutex
	messages []Message

	// openRun is the Run whose Message is still being appended to, and
	// runIsOpen says whether there is one. Records of a single Run fold into as
	// few Messages as the conversation allows, because a Run is one execution of
	// a Unit and a transcript entry is one thing said.
	openRun   events.RunID
	runIsOpen bool

	// openAuthor is who the open Message belongs to, and is empty when the next
	// block starts a new one. A Run says two things in turn once it calls a
	// tool — the assistant asks, and the results come back as the next entry —
	// so which entry is open is not answered by the Run alone.
	openAuthor Author
}

type Origin struct {
	Now     func() events.Timestamp
	RunID   func() events.RunID
	EventID func() events.EventID
}

func NewSession(id events.SessionID, tenant events.TenantID, actor events.Identity, origin Origin) *Session {
	return &Session{ID: id, Tenant: tenant, Actor: actor, origin: origin}
}

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

func (s *Session) Fresh(id events.SessionID) *Session {
	return NewSession(id, s.Tenant, s.Actor, s.origin)
}

// Session satisfies Subscriber, which is how it is fed.
var _ Subscriber = (*Session)(nil)

func (s *Session) Committed(_ context.Context, e events.Event) error {
	if e.Session != s.ID {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	switch payload := e.Payload.(type) {
	case events.Started:
		s.closeRun()
		if payload.Intent != "" {
			s.messages = append(s.messages, Message{Author: AuthorUser, Blocks: []Block{Text{Text: payload.Intent}}})
		}

	case events.Text:
		s.say(e.Run, AuthorAssistant, Text{Text: payload.Chunk})

	case events.ToolCall:
		s.say(e.Run, AuthorAssistant, ToolCall{
			ID:   payload.ID,
			Name: payload.Name,
			Args: string(payload.Args),
		})

	// A result is the person's turn to speak, whoever ran the tool: every API
	// that takes these takes them in the entry that answers the assistant, so
	// the fold puts them there rather than inventing a third Author the wires
	// would each have to map back.
	case events.ToolResult:
		s.say(e.Run, AuthorUser, ToolResult{
			Call:        payload.Call,
			Name:        payload.Name,
			Disposition: payload.Disposition,
			Content:     payload.Content,
		})

	case events.Finished:
		s.closeRun()
	}
	return nil
}

func (s *Session) say(run events.RunID, author Author, block Block) {
	if s.runIsOpen && s.openRun == run && s.openAuthor == author && len(s.messages) > 0 {
		open := &s.messages[len(s.messages)-1]
		text, isText := block.(Text)
		if isText && len(open.Blocks) > 0 {
			if last, lastIsText := open.Blocks[len(open.Blocks)-1].(Text); lastIsText {
				open.Blocks[len(open.Blocks)-1] = Text{Text: last.Text + text.Text}
				return
			}
		}
		open.Blocks = append(open.Blocks, block)
		return
	}

	s.messages = append(s.messages, Message{Author: author, Blocks: []Block{block}})
	s.openRun, s.runIsOpen, s.openAuthor = run, true, author
}

// closeRun ends the Message a Run was appending to, so that the next record
// starts a new entry rather than extending an entry from a Run that is over.
func (s *Session) closeRun() {
	s.openRun, s.runIsOpen, s.openAuthor = "", false, ""
}

// Messages returns the transcript. The copy is deliberate: a caller that
// mutated the slice would be editing history, which is what branch and rewind
// exist to do properly.
func (s *Session) Messages() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]Message, len(s.messages))
	for i, m := range s.messages {
		blocks := make([]Block, len(m.Blocks))
		copy(blocks, m.Blocks)
		out[i] = Message{Author: m.Author, Blocks: blocks}
	}
	return out
}

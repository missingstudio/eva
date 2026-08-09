package core

import (
	"context"
	"errors"
	"sync"

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

// Block is one piece of what a Message says.
//
// The single method is unexported, so the set is closed by the compiler for the
// reason the Event schema's payloads are: a transcript is what the next request
// is built from, and a block a wire has never heard of is a request no provider
// accepts. Adding one is a decision taken here, beside the wires that have to
// send it.
//
// A Message is a list of these rather than a string because a turn that calls a
// tool says two things at once — words, and the call — and the answer to that
// call has to arrive back in the same entry it was asked from. A transcript of
// strings can hold what was said and not what was done, so a fold over a Trace
// holding tool records could rebuild that something happened and could not
// rebuild the conversation.
type Block interface{ isBlock() }

// Text is words, and is what an ordinary answer is made of.
type Text struct{ Text string }

func (Text) isBlock() {}

// ToolCall is the assistant asking for a tool to run.
//
// ID is the provider's own identifier for the call, and Args are the arguments
// as the provider stated them. Both cross unread: core does not parse a tool's
// arguments, because the schema they satisfy is the tool's rather than the
// domain's, and a domain that opened them would be a domain with an opinion
// about what tools exist.
type ToolCall struct {
	ID   string
	Name string
	Args string
}

func (ToolCall) isBlock() {}

// ToolResult is how a call ended, in the entry that answers it.
//
// Call names the ToolCall it answers. Every call has one whatever happened to
// it — a refusal and a crash are both results the model can act on — so a
// transcript never carries a call the next request cannot pair.
type ToolResult struct {
	Call        string
	Name        string
	Disposition events.Disposition
	Content     string
}

func (ToolResult) isBlock() {}

// Message is one entry in the transcript: who said it, and what they said.
type Message struct {
	Author Author
	Blocks []Block
}

// Say is an entry that is nothing but words, which is what most of them are.
func Say(author Author, text string) Message {
	return Message{Author: author, Blocks: []Block{Text{Text: text}}}
}

// Said is everything this entry said in words, with the rest left out.
//
// It is for a caller that wants what was said and not what was done. A caller
// that has to send this entry somewhere reads Blocks instead, because leaving a
// tool call out of a request is how a transcript stops being valid.
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
//
// # What it costs to rebuild
//
// Rebuilding a Session costs one pass over its records, and every turn hands
// back a copy of the whole transcript. Both are linear in the Session, which is
// nothing at the length a person types and something at the length an
// unattended Run reaches — and the fix is not a cache beside the fold, which
// would be the second source of truth this type exists to prevent. It is a
// checkpoint the fold resumes from, keyed by the Cursor that already names a
// position a consumer durably reached. The trigger is resume over a Trace long
// enough to measure; until then this is a known cost rather than a bug.
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
	//
	// The flag is not redundant with an empty openRun: a Run identifier is a
	// string, and "no Run is open" must not be a value a Run could hold.
	openRun   events.RunID
	runIsOpen bool

	// openAuthor is who the open Message belongs to, and is empty when the next
	// block starts a new one. A Run says two things in turn once it calls a
	// tool — the assistant asks, and the results come back as the next entry —
	// so which entry is open is not answered by the Run alone.
	openAuthor Author
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
//
// A Session may hold several open Runs at once, and its fold is safe under
// them: each Recorder publishes under its own lock, so the Session is the one
// thing two Runs of it touch together.
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
// Only the kinds the next request is built from fold: Started carries the
// Spec's intent and opens the transcript with it, Text is what the assistant
// said, and a tool call and its result are what it did. Every other kind is
// real and recorded and simply is not a Message — usage is a cost, a retry is
// an attempt, and neither belongs in what the next provider call is conditioned
// on.
//
// A call and its result are committed as one group, so this sees both or
// neither. That is what makes "no tool_use without its tool_result" a property
// of the fold as well as of the writer: a transcript rebuilt from a Trace that
// was cut between the two would carry a call nothing answers, and every
// provider rejects that request rather than the turn that produced it.
//
// An Event for another Session is ignored rather than rejected, so that one
// Subscriber can sit on a Trace that carries more than one.
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

// say appends one block to the open Message, or opens one.
//
// A Message stays open while the Run and the Author both hold, which is what
// puts an answer and the calls it made in one entry and the results of those
// calls in the next. Consecutive words join the block in front of them, for the
// reason the sink folds chunks: a transcript entry is what was said, not how
// many pieces it arrived in.
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
//
// Each entry's blocks are copied too. A Message holds a slice, so copying the
// outer one alone would hand back entries sharing the fold's own memory — and
// the next chunk appended to an open entry would reach through a transcript a
// caller was already reading.
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

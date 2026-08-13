package api

import "github.com/missingstudio/eva/internal/events"

// The shapes the Remote Transport sends. They are this package's own: nothing
// is promoted out of internal/, and the promise Eva makes to code it did not
// write is a document generated from the schema rather than these structs.

const (
	pathAnswer = "/session/answer"
	pathWatch  = "/session/watch"
	pathModel  = "/session/model"
	pathClear  = "/session/clear"
)

type answerRequest struct {
	Intent string `json:"intent"`
}

// answerReply carries both halves of what Answer returns. A turn that failed
// and a record that failed are different facts, and a Run can produce both at
// once, so neither is folded into the status code: the status says whether the
// request was understood and served, and these say what happened to the turn.
type answerReply struct {
	Result  events.Result     `json:"result"`
	Summary string            `json:"summary"`
	Class   events.ErrorClass `json:"class,omitempty"`

	// Error is the record failing, which is the one thing no Trace holds. It
	// crosses as its own words, because an error's identity does not survive a
	// wire and its account of itself does.
	Error string `json:"error,omitempty"`
}

type modelReply struct {
	Model string `json:"model"`
}

type modelRequest struct {
	Model string `json:"model"`
}

// failure is what a request the Server would not serve answers with.
type failure struct {
	Error string `json:"error"`
}

// frame is one line of the watch stream, and it is one of three things. Ready
// says the watcher is attached. Event is a record the Trace holds, and only a
// record moves a Cursor. Chunk is a piece of a Block arriving.
//
// A chunk is written as itself rather than as an Event with no Trace position:
// that shape is not in the schema, and telling them apart would need a rule.
type frame struct {
	Ready bool          `json:"ready,omitempty"`
	Event *events.Event `json:"event,omitempty"`
	Chunk string        `json:"chunk,omitempty"`
}

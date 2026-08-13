package harness

import (
	"context"

	"github.com/missingstudio/eva/internal/core"
)

// Harness is something that owns a tool-calling loop and can be driven behind
// one contract. Eva is one, and the tools this project will drive instead are
// others. A registry selects one by name, so the layer that opens a Run learns
// no implementation's name.
type Harness interface {
	// Answer answers one Prompt in the Run that is already open for it, and
	// returns the claim it makes about how it went. An answer that failed says so
	// in its Outcome; an error here is the record failing, which is the one thing
	// no Trace can hold.
	Answer(ctx context.Context, prompt Prompt) (core.Outcome, error)
}

// Prompt is one prompt to answer, and the Run that is open to answer it in. It
// is not named Turn: a turn is one exchange with a Provider, and answering one
// prompt holds as many of those as there are tools to call between them.
type Prompt struct {
	// Spec is what to answer, and the identity it is answered under.
	Spec core.Spec

	// Recorder is the one path what happens takes to the Trace. The Run is
	// already open when a Harness is given one, and closing it with a claim is
	// the Harness's own act: the claim is its account of the Run, and nothing
	// else is in a position to make it.
	Recorder *core.Recorder

	// Session is read, never written. The transcript a turn is conditioned on
	// is a fold over committed Events, so the Recorder is what puts anything
	// into it.
	Session *core.Session

	// Model is which model answers this prompt.
	Model string

	// Interrupt says whether a cancellation is a clean cancel: whether something
	// is listening for it and lets the Run close, rather than the process dying
	// under it. It is a property of the Frontend that asked, so it is told rather
	// than worked out here.
	Interrupt bool

	// Arriving is told each chunk as it arrives, before any of it is committed.
	// It is nil when nobody is watching the answer happen.
	Arriving func(chunk string)
}

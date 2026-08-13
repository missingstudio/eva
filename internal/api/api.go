package api

import (
	"context"

	"github.com/missingstudio/eva/internal/core"
)

// Session is what a client drives, and what a Transport carries unchanged:
// answer a prompt, watch what happens, read the model, set the model, and clear
// the transcript. Every method takes a context and returns an error where the
// distance can fail, because a method that cannot be expressed over the wire
// does not belong here. What a Frontend answers about its own machine is a
// Local fact instead, and no Transport carries one.
type Session interface {
	// Answer runs one prompt as one Run, and returns when the Run is closed. A
	// turn that failed says so in its Outcome; an error is the record failing.
	Answer(ctx context.Context, intent string) (core.Outcome, error)

	// Watch attaches a Frontend to what happens: what was committed after the
	// Trace holds it, and what is arriving before any of it is. It returns once
	// the attachment is in place, and the Frontend is told until ctx ends.
	//
	// Watching claims the Interrupt capability, because something following a
	// turn is something that can stop one.
	Watch(ctx context.Context, sub core.Subscriber, arriving func(chunk string)) error

	// Model is which model the turns that follow will use.
	Model(ctx context.Context) (string, error)

	// UseModel switches it, from the next turn on. The transcript is not
	// disturbed.
	UseModel(ctx context.Context, model string) error

	// Clear empties the transcript. Nothing is destroyed: a new Session opens
	// over the same identity, and the Trace keeps every record of the old one.
	Clear(ctx context.Context) error
}

package providers

import (
	"context"

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
)

// Call is one model call. CONTEXT.md retires "request", which belongs to Spec.
type Call struct {
	Model string
	// Messages is the transcript the answer is conditioned on.
	Messages []core.Message
}

// Provider is a model behind one contract, so that a test is deterministic,
// free, and needs no API key. Substitution is the point of the interface: the
// scripted implementation replays recorded output, and the network ones sit
// behind the same three methods.
type Provider interface {
	// Name is what configuration selects this Provider by.
	Name() string

	// Stream begins one turn. The caller reads the Stream to completion or
	// closes it.
	Stream(ctx context.Context, call Call) (Stream, error)
}

// Stream is one turn in progress.
//
// It yields payloads of the one Event schema rather than a shape of its own.
// A provider knows what happened; it does not know the Run, the Session, or
// the tenant it happened under, so it does not fill in an envelope. There is
// no second vocabulary to normalize from (invariant 8).
type Stream interface {
	// Next returns the next payload of the turn, or io.EOF when the turn is
	// complete. A provider failure arrives here as an error rather than as a
	// panic.
	Next(ctx context.Context) (events.Payload, error)

	// Close releases the turn, whether or not it ran to completion.
	Close() error
}

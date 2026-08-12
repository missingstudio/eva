package providers

import (
	"context"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

type Call struct {
	Model    string
	Messages []core.Message
}

// Provider is a model behind one contract, so that a test is deterministic,
// free, and needs no API key. Substitution is the point of the interface: the
// fake implementation replays recorded output, and the network ones sit behind
// the same one method.
type Provider interface {
	// Stream begins one turn. The caller reads the Stream to completion or
	// closes it.
	Stream(ctx context.Context, call Call) Stream
}

type Stream interface {
	// Next returns the next payload of the turn, or io.EOF when the turn is
	// complete. A provider failure arrives here as an error rather than as a
	// panic.
	Next(ctx context.Context) (events.Payload, error)

	// Close releases the turn, whether or not it ran to completion. Closing
	// twice is not an error.
	Close() error
}

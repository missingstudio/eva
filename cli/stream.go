package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
)

// eventStream writes each committed Event as one line of JSON.
//
// It is a Subscriber rather than something the turn writes to directly,
// because what --json prints is a projection of the Trace and every projection
// is a fold over it. An Event reaches this writer only after the sink has
// committed it, so the position printed here is the position the Trace holds —
// and so a consumer reading stdout and a consumer reading the file cannot be
// shown two different turns.
type eventStream struct {
	out io.Writer
}

var _ core.Subscriber = eventStream{}

// Committed prints one Event.
func (s eventStream) Committed(_ context.Context, e events.Event) error {
	line, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("encode %s event: %w", e.Kind, err)
	}
	if _, err := fmt.Fprintf(s.out, "%s\n", line); err != nil {
		return fmt.Errorf("write %s event: %w", e.Kind, err)
	}
	return nil
}

package core

import (
	"context"

	"github.com/missingstudio/eva/internal/events"
)

// TraceSink is the append-only store every Event lands in. core declares it;
// trace implements it, because a sink writes files and core is pure.
type TraceSink interface {
	// Append commits a group as one unit and returns the committed Events
	// with their Trace positions assigned. A group is never partially
	// written: either every Event in it is stored or none is.
	Append(ctx context.Context, group []events.Event) ([]events.Event, error)

	// Close releases the sink. A Trace that has been closed still parses.
	Close() error
}

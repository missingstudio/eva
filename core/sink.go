package core

import (
	"context"

	"github.com/missingstudio/eva/events"
)

// TraceSink is the append-only store every Event lands in. core declares it;
// trace implements it, because a sink writes files and core is pure.
//
// The sink owns the Trace position. It assigns Seq at commit, per Session,
// which is what makes ordering reflect what was durably written rather than
// what was sent — and what will later make "no tool_use is ever persisted
// without its tool_result" a property of the writer rather than a rule
// contributors are expected to remember. See docs/adr/0008.
type TraceSink interface {
	// Append commits a group as one unit and returns the committed Events
	// with their Trace positions assigned. A group is never partially
	// written: either every Event in it is stored or none is.
	//
	// Stored is not the same as flushed to the platter. A Trace survives the
	// process dying, which is what kill -9 tests; surviving the machine dying
	// is a stronger promise, and the stage that makes it will say so here.
	//
	// The returned Events are what a consumer should read, because the
	// positions on them are the ones the Trace holds.
	Append(ctx context.Context, group []events.Event) ([]events.Event, error)

	// Close releases the sink. A Trace that has been closed still parses.
	Close() error
}

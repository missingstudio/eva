package harness

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

// What a Run is stamped with, and where it comes from: the clock a person
// reads, the monotonic one a latency is computed from, and identifiers minted
// without a central allocator.

// origin is the clock and the identifiers every Event of a Run is stamped with.
func origin() core.Origin {
	return core.Origin{
		Now:     now,
		RunID:   func() events.RunID { return events.RunID(newID("run")) },
		EventID: func() events.EventID { return events.EventID(newID("evt")) },
	}
}

func newSessionID() events.SessionID { return events.SessionID(newID("sess")) }

// start is when this process began, and the origin the monotonic reading on
// every Event is measured from.
var start = time.Now()

// now is the reading every Event of a Run is stamped with: the wall clock a
// person reads, and the monotonic one a latency is computed from.
func now() events.Timestamp {
	return events.Timestamp{Wall: time.Now().UTC(), Mono: time.Since(start).Nanoseconds()}
}

// newID makes an identifier that is unique without a central allocator,
// because a Worker somewhere else will one day mint these too.
func newID(prefix string) string {
	var b [8]byte
	// crypto/rand.Read fills the slice or crashes the program: a process that
	// cannot generate an identifier cannot write a Trace either, so there is
	// nothing here to recover from.
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

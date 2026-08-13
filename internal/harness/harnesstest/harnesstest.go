// Package harnesstest is one Session's worth of assembly, for a test that needs
// a running one: a Session on a clock that does not move, a sink whose records
// the test can read back, and the Assembly the two make with a Harness.
//
// It is here rather than per package because a fixture that differs per package
// is a difference a reader must rule out before trusting two tests that differ.
package harnesstest

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/harness"
)

// Model is the model these Sessions answer with, named so that a test asserting
// on it and a test switching away from it mean the same string.
const Model = "test-model"

// Session opens a Session for the turns under test, on a clock that does not
// move and identifiers that count. It is safe to use from more than one
// goroutine, because a turn carried over the wire is answered on another.
func Session() *core.Session {
	var (
		mu      sync.Mutex
		runs    uint64
		records uint64
	)
	return core.NewSession("sess_test", "tenant_test",
		events.Identity{ID: "test", Kind: events.ActorAgent},
		core.Origin{
			Now: func() events.Timestamp { return events.Timestamp{} },
			RunID: func() events.RunID {
				mu.Lock()
				defer mu.Unlock()
				runs++
				return events.RunID(fmt.Sprintf("run_%d", runs))
			},
			EventID: func() events.EventID {
				mu.Lock()
				defer mu.Unlock()
				records++
				return events.EventID(fmt.Sprintf("evt_%d", records))
			},
		})
}

// Sink keeps what it was appended and assigns the Trace position, which is the
// sink's own to assign.
type Sink struct {
	// Refuse is asked about each group before it is kept, and a group it
	// answers for is one the Trace does not hold. It is what a test breaks the
	// record with, so that the record failing can be told from the turn
	// failing. Nil takes everything.
	Refuse func(group []events.Event) error

	mu      sync.Mutex
	next    uint64
	records []events.Event
	closed  bool
}

var _ core.TraceSink = (*Sink)(nil)

func (s *Sink) Append(_ context.Context, group []events.Event) ([]events.Event, error) {
	if s.Refuse != nil {
		if err := s.Refuse(group); err != nil {
			return nil, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]events.Event, len(group))
	for i, e := range group {
		s.next++
		e.Seq = s.next
		out[i] = e
		s.records = append(s.records, e)
	}
	return out, nil
}

func (s *Sink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return nil
}

// Records is everything the Trace holds, in the order it took it.
func (s *Sink) Records() []events.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]events.Event(nil), s.records...)
}

// Closed says whether the Trace was closed, for a test that asks whether
// something that opened a sink let go of it.
func (s *Sink) Closed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// Kinds is what the Trace holds, as kinds, for a test about the shape of a Run
// rather than its contents.
func Kinds(records []events.Event) []events.Kind {
	out := make([]events.Kind, 0, len(records))
	for _, e := range records {
		out = append(out, e.Kind)
	}
	return out
}

// Assemble builds the Assembly a test drives: this Harness, this sink, and a
// Session of the kind above. The Trace is closed when the test ends.
func Assemble(t testing.TB, unit harness.Harness, sink core.TraceSink) *harness.Assembly {
	t.Helper()

	var cleared uint64
	assembly, err := harness.New(harness.AssemblyOptions{
		Harness: unit,
		Sink:    sink,
		Session: Session(),
		Model:   Model,
		NewSessionID: func() events.SessionID {
			cleared++
			return events.SessionID(fmt.Sprintf("sess_cleared_%d", cleared))
		},
	})
	if err != nil {
		t.Fatalf("build the Assembly: %v", err)
	}
	t.Cleanup(func() { _ = assembly.Close() })
	return assembly
}

package api

import (
	"errors"
	"testing"

	"github.com/missingstudio/eva/internal/events"
)

// A client that cannot keep up must never hold up the turn, and the two facts
// get two answers. A record it did not take is a projection that stopped
// following, and the Run closes saying so — core asserts that half, where a
// Subscriber that fails degrades the Run. A chunk that did not fit is a moment
// of the turn this client did not see.

func TestAClientThatFellBehindStopsFollowingRatherThanHoldingUpTheTurn(t *testing.T) {
	var left int
	pending := newBacklog(1, func() { left++ })

	if err := pending.record(frame{Event: &events.Event{Seq: 1}}); err != nil {
		t.Fatalf("the first record did not fit a backlog with room for it: %v", err)
	}

	// The second has nowhere to go. It is turned away rather than waited on,
	// which is the turn not being held up.
	err := pending.record(frame{Event: &events.Event{Seq: 2}})
	if !errors.Is(err, errBehind) {
		t.Errorf("a record that did not fit was answered with %v, want the client stopped following", err)
	}
	if left != 1 {
		t.Errorf("the watcher was detached %d times, want once: a client that stopped following must stop being told", left)
	}
	select {
	case <-pending.done:
	default:
		t.Error("the stream was left open behind a client that stopped following it")
	}
}

// Stopping is one act however many records arrive after it, because the
// watcher is detached once and a second detach would be a second act on
// something that has already gone.
func TestAClientStopsFollowingOnce(t *testing.T) {
	var left int
	pending := newBacklog(0, func() { left++ })

	for range 3 {
		if err := pending.record(frame{Event: &events.Event{Seq: 1}}); !errors.Is(err, errBehind) {
			t.Fatalf("a record into a backlog with no room was answered with %v", err)
		}
	}
	if left != 1 {
		t.Errorf("the watcher was detached %d times, want once", left)
	}
}

// A chunk that does not fit is dropped, and nothing about the turn changes: the
// Live area is replaced by the fold over what was committed as soon as the Run
// closes, so what was missed is a moment rather than a record.
func TestAChunkThatDoesNotFitIsDroppedAndNothingStops(t *testing.T) {
	var left int
	pending := newBacklog(1, func() { left++ })

	pending.chunk("this one fits")
	pending.chunk("this one does not")

	if left != 0 {
		t.Errorf("a dropped chunk detached the watcher %d times, want none", left)
	}
	select {
	case <-pending.done:
		t.Error("a dropped chunk ended the stream")
	default:
	}

	got := <-pending.frames
	if got.Chunk != "this one fits" {
		t.Errorf("the backlog holds %q, want the chunk that fitted", got.Chunk)
	}
	if got.Event != nil {
		t.Error("a chunk was queued as a record, and only a record moves a Cursor")
	}
}

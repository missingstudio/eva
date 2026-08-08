package trace_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/trace"
)

func open(t *testing.T) (*trace.Sink, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "nested", "trace.jsonl")
	sink, err := trace.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() {
		if err := sink.Close(); err != nil {
			t.Errorf("close: %v", err)
		}
	})
	return sink, path
}

// wired builds an Event whose wire position is deliberately nothing like the
// Trace position it should be given.
func wired(session events.SessionID, wire uint64, p events.Payload) events.Event {
	kind, _ := events.KindOf(p)
	return events.Event{
		ID:      events.EventID(fmt.Sprintf("evt_%s_%d", session, wire)),
		WireSeq: wire,
		At:      events.Timestamp{Wall: time.Now().UTC(), Mono: int64(wire)},
		Version: events.SchemaVersion,
		Kind:    kind,
		Tenant:  "tenant_1",
		Actor:   events.Identity{ID: "agent", Kind: events.ActorAgent},
		Run:     "run_1",
		Session: session,
		Payload: p,
	}
}

func readTrace(t *testing.T, path string) []events.Event {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open trace: %v", err)
	}
	defer func() { _ = f.Close() }()

	var out []events.Event
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		var e events.Event
		if err := json.Unmarshal(scan.Bytes(), &e); err != nil {
			t.Fatalf("line %d does not parse: %v\n%s", len(out)+1, err, scan.Bytes())
		}
		out = append(out, e)
	}
	if err := scan.Err(); err != nil {
		t.Fatalf("read trace: %v", err)
	}
	return out
}

// ADR 0008: the sink assigns Trace position at commit. It is not the wire
// position passed through, and the naming apart is the decision.
func TestTracePositionIsAssignedBySinkNotPassedThrough(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	group := []events.Event{
		wired("sess_1", 900, events.Started{}),
		wired("sess_1", 901, events.Text{Chunk: "hello"}),
	}
	committed, err := sink.Append(ctx, group)
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	for i, e := range committed {
		if want := uint64(i + 1); e.Seq != want {
			t.Errorf("committed[%d].Seq = %d, want %d", i, e.Seq, want)
		}
		if e.WireSeq != group[i].WireSeq {
			t.Errorf("committed[%d].WireSeq = %d, want %d", i, e.WireSeq, group[i].WireSeq)
		}
		if e.Seq == e.WireSeq {
			t.Errorf("committed[%d] has one number where there should be two", i)
		}
	}

	// The caller's own values are untouched: a sink that mutated its argument
	// would make the wire stream and the Trace the same object.
	for i, e := range group {
		if e.Seq != 0 {
			t.Errorf("group[%d].Seq = %d, want the caller's event left alone", i, e.Seq)
		}
	}

	stored := readTrace(t, path)
	if len(stored) != 2 {
		t.Fatalf("trace holds %d records, want 2", len(stored))
	}
	for i, e := range stored {
		if e.Seq != committed[i].Seq || e.ID != committed[i].ID {
			t.Errorf("stored[%d] = %+v, want %+v", i, e, committed[i])
		}
	}
}

func TestTracePositionIsDenseAndGaplessPerSession(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	for i := range 5 {
		if _, err := sink.Append(ctx, []events.Event{
			wired("sess_a", uint64(i), events.Text{Chunk: "a"}),
			wired("sess_b", uint64(i), events.Text{Chunk: "b"}),
		}); err != nil {
			t.Fatalf("append: %v", err)
		}
	}

	next := map[events.SessionID]uint64{}
	for _, e := range readTrace(t, path) {
		next[e.Session]++
		if e.Seq != next[e.Session] {
			t.Fatalf("session %s: Seq = %d, want %d — the sequence has a gap", e.Session, e.Seq, next[e.Session])
		}
	}
	if next["sess_a"] != 5 || next["sess_b"] != 5 {
		t.Fatalf("counts = %v, want 5 each", next)
	}
}

func TestAnEmptyGroupWritesNothing(t *testing.T) {
	sink, path := open(t)

	committed, err := sink.Append(context.Background(), nil)
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if len(committed) != 0 {
		t.Errorf("committed %d events, want 0", len(committed))
	}
	if got := readTrace(t, path); len(got) != 0 {
		t.Errorf("trace holds %d records, want 0", len(got))
	}
}

// Fail closed: a group that cannot be encoded is not half-written, and it does
// not consume a Trace position that a later record would then be missing.
func TestARejectedGroupLeavesNoTraceAndNoGap(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	unversioned := wired("sess_1", 1, events.Text{Chunk: "bad"})
	unversioned.Version = 0

	if _, err := sink.Append(ctx, []events.Event{
		wired("sess_1", 0, events.Text{Chunk: "good"}),
		unversioned,
	}); err == nil {
		t.Fatal("append accepted an unencodable group, want an error")
	}
	if got := readTrace(t, path); len(got) != 0 {
		t.Fatalf("trace holds %d records after a rejected group, want 0", len(got))
	}

	committed, err := sink.Append(ctx, []events.Event{wired("sess_1", 2, events.Text{Chunk: "next"})})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if committed[0].Seq != 1 {
		t.Errorf("Seq = %d after a rejected group, want 1 — the rejected group burned a position", committed[0].Seq)
	}
}

// Package tracetest is the TraceSink contract, written as tests.
package tracetest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

type Contract struct {
	// Open builds a sink holding nothing, and the way to read what it has
	// committed. It builds one rather than being one because every case here
	// needs a Trace of its own: position counts from 1 over the life of a
	// Trace, so a sink another case has already written to has no 1 left to
	// give.
	Open func(t *testing.T) (core.TraceSink, Records)

	// Refuses spoils an Event so that this sink will not store it, which is
	// how the suite asks for a group that has to be rejected whole. What a
	// store cannot hold is the store's own business — a file has an encoding
	// to fail, a table has a column to violate — so the suite cannot build one
	// itself. Nil when a sink can be made to refuse nothing, and the atomicity
	// of a group then goes unasserted.
	Refuses func(events.Event) events.Event
}

type Records func(t *testing.T) []events.Event

func Run(t *testing.T, c Contract) {
	t.Helper()

	if c.Open == nil {
		t.Fatal("tracetest: a Contract needs a way to open a sink")
	}

	t.Run("the sink assigns Trace position and leaves the wire's alone", func(t *testing.T) {
		sink, records := c.Open(t)

		group := []events.Event{
			wired("sess_1", 900, events.Started{Intent: "answer"}),
			wired("sess_1", 901, events.Usage{InputTokens: events.Tokens(10)}),
		}
		committed := commit(t, sink, group...)
		if len(committed) != len(group) {
			t.Fatalf("committed %d records of %d, and none of these folds", len(committed), len(group))
		}

		for i, e := range committed {
			if want := uint64(i + 1); e.Seq != want {
				t.Errorf("committed[%d].Seq = %d, want %d", i, e.Seq, want)
			}
			if e.WireSeq != group[i].WireSeq {
				t.Errorf("committed[%d].WireSeq = %d, want the producer's %d", i, e.WireSeq, group[i].WireSeq)
			}
			if e.Seq == e.WireSeq {
				t.Errorf("committed[%d] has one number where there should be two", i)
			}
		}

		// A sink that numbered its argument would make the wire stream and the
		// Trace one object, and the producer's cursor would move on a commit it
		// never saw.
		for i, e := range group {
			if e.Seq != 0 {
				t.Errorf("group[%d].Seq = %d, want the caller's Event left alone", i, e.Seq)
			}
		}

		stored := records(t)
		if len(stored) != len(committed) {
			t.Fatalf("the sink holds %d records and Append reported %d", len(stored), len(committed))
		}
		for i, e := range stored {
			if e.Seq != committed[i].Seq || e.ID != committed[i].ID {
				t.Errorf("stored[%d] is %s at Seq %d, want %s at Seq %d",
					i, e.ID, e.Seq, committed[i].ID, committed[i].Seq)
			}
		}
	})

	t.Run("position counts from 1 without a gap over every group", func(t *testing.T) {
		sink, records := c.Open(t)

		for i := range 5 {
			commit(t, sink,
				wired("sess_1", 900+uint64(i)*2, events.Text{Block: i, Chunk: "a"}),
				wired("sess_1", 901+uint64(i)*2, events.ToolCall{Name: "read_file", Args: json.RawMessage(`{}`)}),
			)
		}

		stored := records(t)
		if len(stored) != 10 {
			t.Fatalf("the sink holds %d records, want 10", len(stored))
		}
		for i, e := range stored {
			if want := uint64(i + 1); e.Seq != want {
				t.Fatalf("stored[%d].Seq = %d, want %d — the sequence has a gap", i, e.Seq, want)
			}
		}
	})

	t.Run("two Sessions in one sink count apart", func(t *testing.T) {
		sink, records := c.Open(t)

		for i := range 4 {
			commit(t, sink,
				wired("sess_a", 900+uint64(i), events.Text{Block: i, Chunk: "a"}),
				wired("sess_b", 800+uint64(i), events.Text{Block: i, Chunk: "b"}),
			)
		}

		// One counter over the sink would give the second Session positions
		// that start wherever the first one had got to, and every projection
		// that reads position as identity would be wrong from there on.
		seen := map[events.SessionID]uint64{}
		for i, e := range records(t) {
			seen[e.Session]++
			if e.Seq != seen[e.Session] {
				t.Fatalf("record %d of Session %s has Seq %d, want %d", i, e.Session, e.Seq, seen[e.Session])
			}
		}
		if seen["sess_a"] != 4 || seen["sess_b"] != 4 {
			t.Fatalf("the sink holds %v, want 4 records of each Session", seen)
		}
	})

	t.Run("consecutive chunks of one block come back as one record", func(t *testing.T) {
		sink, records := c.Open(t)

		group := []events.Event{
			wired("sess_1", 900, events.Started{Intent: "answer"}),
			wired("sess_1", 901, events.Text{Block: 0, Chunk: "Eva is "}),
			wired("sess_1", 902, events.Text{Block: 0, Chunk: "a software "}),
			wired("sess_1", 903, events.Text{Block: 0, Chunk: "factory."}),
			wired("sess_1", 904, events.Usage{InputTokens: events.Tokens(10)}),
		}
		committed := commit(t, sink, group...)
		if len(committed) != 3 {
			t.Fatalf("committed %d records, want 3 — the chunks did not fold", len(committed))
		}

		text, ok := committed[1].Payload.(events.Text)
		if !ok {
			t.Fatalf("the folded record carries %#v, want Text", committed[1].Payload)
		}
		if want := "Eva is a software factory."; text.Chunk != want {
			t.Errorf("the folded chunk is %q, want %q", text.Chunk, want)
		}

		// The merged record is the first chunk's. What was sent began there,
		// and the stamp is the one time-to-first-token is measured from.
		first := group[1]
		if committed[1].ID != first.ID || committed[1].WireSeq != first.WireSeq {
			t.Errorf("the folded record is %s at wire position %d, want the first chunk's %s at %d",
				committed[1].ID, committed[1].WireSeq, first.ID, first.WireSeq)
		}
		if !committed[1].At.Wall.Equal(first.At.Wall) || committed[1].At.Mono != first.At.Mono {
			t.Errorf("the folded record is stamped %v, want the first chunk's %v", committed[1].At, first.At)
		}

		// Position is dense over what was written rather than over what was
		// sent, so the chunks the fold merged leave no hole behind them.
		for i, e := range committed {
			if want := uint64(i + 1); e.Seq != want {
				t.Errorf("committed[%d].Seq = %d, want %d", i, e.Seq, want)
			}
		}
		if stored := records(t); len(stored) != len(committed) {
			t.Fatalf("the sink holds %d records, want the %d that were committed", len(stored), len(committed))
		}
	})

	t.Run("the fold stops at every boundary a reader tells apart", func(t *testing.T) {
		parent := events.RunID("run_2")

		for _, boundary := range []struct {
			name   string
			second func(events.Event) events.Event
		}{
			{"another content block", func(e events.Event) events.Event {
				e.Payload = events.Text{Block: 1, Chunk: "b"}
				return e
			}},
			{"another Run", func(e events.Event) events.Event {
				e.Run = "run_9"
				return e
			}},
			{"another Session", func(e events.Event) events.Event {
				e.Session = "sess_2"
				return e
			}},
			{"another tenant", func(e events.Event) events.Event {
				e.Tenant = "tenant_2"
				return e
			}},
			{"another actor", func(e events.Event) events.Event {
				e.Actor = events.Identity{ID: "someone-else", Kind: events.ActorHuman}
				return e
			}},
			{"another schema version", func(e events.Event) events.Event {
				e.Version = events.SchemaVersion + 1
				return e
			}},
			{"a parent Run", func(e events.Event) events.Event {
				e.Parent = &parent
				return e
			}},
		} {
			t.Run(boundary.name, func(t *testing.T) {
				sink, _ := c.Open(t)

				committed := commit(t, sink,
					wired("sess_1", 900, events.Text{Block: 0, Chunk: "a"}),
					boundary.second(wired("sess_1", 901, events.Text{Block: 0, Chunk: "b"})),
				)
				if len(committed) != 2 {
					t.Fatalf("committed %d records, want 2 — the fold merged across %s", len(committed), boundary.name)
				}
			})
		}
	})

	t.Run("a chunk of another block between two of one block is a boundary", func(t *testing.T) {
		sink, _ := c.Open(t)

		committed := commit(t, sink,
			wired("sess_1", 900, events.Text{Block: 0, Chunk: "a"}),
			wired("sess_1", 901, events.Text{Block: 1, Chunk: "x"}),
			wired("sess_1", 902, events.Text{Block: 0, Chunk: "b"}),
		)
		if len(committed) != 3 {
			t.Fatalf("committed %d records, want 3 — the fold reached past a block boundary", len(committed))
		}

		var got []string
		for i, e := range committed {
			text, ok := e.Payload.(events.Text)
			if !ok {
				t.Fatalf("committed[%d] carries %#v, want Text", i, e.Payload)
			}
			got = append(got, text.Chunk)
		}
		if want := []string{"a", "x", "b"}; !slices.Equal(got, want) {
			t.Errorf("the chunks came back %v, want %v — the fold reordered the group", got, want)
		}
	})

	t.Run("an empty group is a no-op", func(t *testing.T) {
		sink, records := c.Open(t)

		for _, group := range [][]events.Event{nil, {}} {
			committed, err := sink.Append(t.Context(), group)
			if err != nil {
				t.Fatalf("an empty group was refused: %v", err)
			}
			if len(committed) != 0 {
				t.Errorf("an empty group came back as %d records", len(committed))
			}
		}
		if stored := records(t); len(stored) != 0 {
			t.Fatalf("the sink holds %d records after two empty groups, want 0", len(stored))
		}

		// Nothing was written, so nothing was numbered, and the first real
		// record still takes the first position.
		if committed := commit(t, sink, wired("sess_1", 900, events.Text{Chunk: "first"})); committed[0].Seq != 1 {
			t.Errorf("the first record took Seq %d, want 1 — an empty group burned a position", committed[0].Seq)
		}
	})

	t.Run("a cancelled append is reported and commits nothing", func(t *testing.T) {
		sink, records := c.Open(t)

		// The commonest way a Run ends early is somebody pressing ctrl+c, and a
		// sink that wrote anyway would put records in the Trace after the Run
		// that produced them was over.
		ctx, cancel := context.WithCancel(t.Context())
		cancel()

		_, err := sink.Append(ctx, []events.Event{wired("sess_1", 900, events.Text{Chunk: "gone"})})
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("a cancelled append returned %v, want context.Canceled", err)
		}
		if stored := records(t); len(stored) != 0 {
			t.Fatalf("the sink holds %d records after a cancelled append, want 0", len(stored))
		}
		if committed := commit(t, sink, wired("sess_1", 901, events.Text{Chunk: "after"})); committed[0].Seq != 1 {
			t.Errorf("the record after a cancelled append took Seq %d, want 1", committed[0].Seq)
		}
	})

	t.Run("a closed sink still holds what it committed", func(t *testing.T) {
		sink, records := c.Open(t)

		committed := commit(t, sink,
			wired("sess_1", 900, events.Started{Intent: "answer"}),
			wired("sess_1", 901, events.Text{Chunk: "hello"}),
		)
		if err := sink.Close(); err != nil {
			t.Fatalf("close: %v", err)
		}

		// The records outlive the writer. A store that had to be closed by hand
		// to be readable would lose the Trace to the crash the Trace exists to
		// survive.
		stored := records(t)
		if len(stored) != len(committed) {
			t.Fatalf("a closed sink holds %d records, want the %d it committed", len(stored), len(committed))
		}
		for i, e := range stored {
			if e.Seq != committed[i].Seq || e.ID != committed[i].ID {
				t.Errorf("stored[%d] is %s at Seq %d, want %s at Seq %d",
					i, e.ID, e.Seq, committed[i].ID, committed[i].Seq)
			}
		}

		// A caller closes on a defer and may close again on its way out of a
		// failure, so the second one is not an error.
		if err := sink.Close(); err != nil {
			t.Errorf("closing twice returned %v, want nil", err)
		}
	})

	t.Run("a closed sink reports an append rather than panicking", func(t *testing.T) {
		sink, records := c.Open(t)
		if err := sink.Close(); err != nil {
			t.Fatalf("close: %v", err)
		}

		// A record arriving after the close is the caller's mistake, and one
		// mistake must not take the process down with it.
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("appending to a closed sink panicked: %v", r)
			}
		}()

		if _, err := sink.Append(t.Context(), []events.Event{wired("sess_1", 900, events.Text{Chunk: "late"})}); err == nil {
			t.Error("a closed sink accepted an append, want a report")
		}
		if stored := records(t); len(stored) != 0 {
			t.Errorf("a closed sink holds %d records, want 0 — the late append was stored", len(stored))
		}
	})

	if c.Refuses == nil {
		return
	}

	t.Run("a rejected group leaves no record and no gap", func(t *testing.T) {
		sink, records := c.Open(t)

		// Both records are chunks of one block, so a sink whose fold ran before
		// its check would absorb the one it must reject into the one before it
		// and store a group it was told it could not have.
		good := wired("sess_1", 900, events.Text{Block: 0, Chunk: "good"})
		bad := c.Refuses(wired("sess_1", 901, events.Text{Block: 0, Chunk: "bad"}))

		if _, err := sink.Append(t.Context(), []events.Event{good, bad}); err == nil {
			t.Fatal("the sink accepted a group holding a record it cannot store")
		}
		if stored := records(t); len(stored) != 0 {
			t.Fatalf("the sink holds %d records after a rejected group, want 0 — the group was half committed", len(stored))
		}

		// The rejected group took no position with it. A sink that numbered as
		// it went would start the next record at 3 and leave the Trace with a
		// hole no reader can tell from a lost record.
		committed := commit(t, sink, wired("sess_1", 902, events.Text{Chunk: "next"}))
		if committed[0].Seq != 1 {
			t.Errorf("Seq = %d after a rejected group, want 1 — the rejected group burned a position", committed[0].Seq)
		}
	})
}

func commit(t *testing.T, sink core.TraceSink, group ...events.Event) []events.Event {
	t.Helper()

	committed, err := sink.Append(t.Context(), group)
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	return committed
}

// wired builds an Event as a producer hands one over: numbered on the wire,
// stamped, and carrying no Trace position at all.
func wired(session events.SessionID, wire uint64, payload events.Payload) events.Event {
	kind, _ := events.KindOf(payload)
	return events.Event{
		ID:      events.EventID(fmt.Sprintf("evt_%s_%d", session, wire)),
		WireSeq: wire,
		At:      events.Timestamp{Wall: time.Unix(int64(wire), 0).UTC(), Mono: int64(wire)},
		Version: events.SchemaVersion,
		Kind:    kind,
		Tenant:  "tenant_1",
		Actor:   events.Identity{ID: "agent", Kind: events.ActorAgent},
		Run:     "run_1",
		Session: session,
		Payload: payload,
	}
}

package trace_test

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/trace"
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

// The sink assigns Trace position at commit. It is not the wire position
// passed through, and the naming apart is the decision.
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
// The rejected record is last in both cases, because that is the ordering a
// sink writing as it went would already have got wrong: everything before it
// would be in the Trace, and in the second case that is a tool call stored
// with no result.
func TestARejectedGroupLeavesNoTraceAndNoGap(t *testing.T) {
	for _, c := range []struct {
		name     string
		first    events.Event
		rejected events.Event
	}{
		{
			name:     "a chunk with no schema version",
			first:    wired("sess_1", 0, events.Text{Chunk: "good"}),
			rejected: wired("sess_1", 1, events.Text{Chunk: "bad"}),
		},
		{
			name:     "a tool result with no schema version",
			first:    wired("sess_1", 0, events.ToolCall{Name: "read_file", Args: json.RawMessage(`{}`)}),
			rejected: wired("sess_1", 1, events.ToolResult{Name: "read_file", Disposition: events.DispositionOK}),
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			sink, path := open(t)
			ctx := context.Background()

			c.rejected.Version = 0
			if _, err := sink.Append(ctx, []events.Event{c.first, c.rejected}); err == nil {
				t.Fatal("append accepted an unencodable group, want an error")
			}
			if got := readTrace(t, path); len(got) != 0 {
				t.Fatalf("the Trace holds %d records after a rejected group, want 0 — the group was half written", len(got))
			}

			committed, err := sink.Append(ctx, []events.Event{wired("sess_1", 2, events.Text{Chunk: "next"})})
			if err != nil {
				t.Fatalf("append: %v", err)
			}
			if committed[0].Seq != 1 {
				t.Errorf("Seq = %d after a rejected group, want 1 — the rejected group burned a position", committed[0].Seq)
			}
		})
	}
}

// Consecutive chunks of one content block become a single record, so a Trace
// record is a unit of meaning rather than a token.
func TestConsecutiveChunksOfOneBlockFoldIntoOneRecord(t *testing.T) {
	sink, path := open(t)

	committed, err := sink.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Started{}),
		wired("sess_1", 1, events.Text{Block: 0, Chunk: "Eva is "}),
		wired("sess_1", 2, events.Text{Block: 0, Chunk: "a software "}),
		wired("sess_1", 3, events.Text{Block: 0, Chunk: "factory."}),
		wired("sess_1", 4, events.Usage{InputTokens: events.Tokens(10)}),
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	if len(committed) != 3 {
		t.Fatalf("committed %d records, want 3 — the chunks did not fold", len(committed))
	}
	text, ok := committed[1].Payload.(events.Text)
	if !ok {
		t.Fatalf("payload = %#v, want Text", committed[1].Payload)
	}
	if want := "Eva is a software factory."; text.Chunk != want {
		t.Errorf("chunk = %q, want %q", text.Chunk, want)
	}

	// The merged record keeps the first chunk's identity and wire position:
	// what was sent began there, and the timestamp is what time-to-first-token
	// is measured from.
	if committed[1].WireSeq != 1 {
		t.Errorf("WireSeq = %d, want the first chunk's 1", committed[1].WireSeq)
	}
	if committed[1].ID != "evt_sess_1_1" {
		t.Errorf("ID = %q, want the first chunk's", committed[1].ID)
	}

	// The Trace position stays dense over what was actually written.
	for i, e := range committed {
		if want := uint64(i + 1); e.Seq != want {
			t.Errorf("committed[%d].Seq = %d, want %d", i, e.Seq, want)
		}
	}
	if stored := readTrace(t, path); len(stored) != 3 {
		t.Fatalf("the Trace holds %d records, want 3", len(stored))
	}
}

// The fold merges what a reader would not have to tell apart, and nothing
// else. Everything here is a reason two adjacent chunks stay two records.
func TestTheFoldNeverMergesRecordsAReaderMustTellApart(t *testing.T) {
	other := events.RunID("run_2")

	cases := []struct {
		name   string
		second func(events.Event) events.Event
	}{
		{"another content block", func(e events.Event) events.Event {
			e.Payload = events.Text{Block: 1, Chunk: "b"}
			return e
		}},
		{"another session", func(e events.Event) events.Event {
			e.Session = "sess_2"
			return e
		}},
		{"another run", func(e events.Event) events.Event {
			e.Run = "run_9"
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
		{"a parent run", func(e events.Event) events.Event {
			e.Parent = &other
			return e
		}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sink, _ := open(t)

			first := wired("sess_1", 0, events.Text{Block: 0, Chunk: "a"})
			second := c.second(wired("sess_1", 1, events.Text{Block: 0, Chunk: "b"}))

			committed, err := sink.Append(context.Background(), []events.Event{first, second})
			if err != nil {
				t.Fatalf("append: %v", err)
			}
			if len(committed) != 2 {
				t.Fatalf("committed %d records, want 2 — the fold merged across %s", len(committed), c.name)
			}
		})
	}
}

// A chunk between two chunks of another block is a boundary, not something to
// reorder around. The fold is consecutive-only, so it can never move a record.
func TestTheFoldIsConsecutiveOnlyAndNeverReorders(t *testing.T) {
	sink, _ := open(t)

	committed, err := sink.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Text{Block: 0, Chunk: "a"}),
		wired("sess_1", 1, events.Text{Block: 1, Chunk: "x"}),
		wired("sess_1", 2, events.Text{Block: 0, Chunk: "b"}),
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if len(committed) != 3 {
		t.Fatalf("committed %d records, want 3", len(committed))
	}

	var got []string
	for _, e := range committed {
		got = append(got, e.Payload.(events.Text).Chunk)
	}
	if fmt.Sprint(got) != fmt.Sprint([]string{"a", "x", "b"}) {
		t.Errorf("chunks = %v, want [a x b]", got)
	}
}

// The rule stage 2 will depend on is that no tool call is ever persisted
// without its result. That is a property of the writer rather than of the
// caller: the assistant message and every result belonging to it are one
// group, and a group is written whole or not at all.
//
// Stage 0 builds no tools, so the group is constructed here rather than
// produced by a run. Testing it now is the point — stage 2 inherits a
// guarantee that is already measured.
func TestAGroupCarryingToolResultsIsWrittenAsOneUnit(t *testing.T) {
	sink, path := open(t)

	group := []events.Event{
		wired("sess_1", 10, events.Text{Block: 0, Chunk: "I will read "}),
		wired("sess_1", 11, events.Text{Block: 0, Chunk: "both files."}),
		wired("sess_1", 12, events.ToolCall{Name: "read_file", Args: json.RawMessage(`{"path":"a.go"}`)}),
		wired("sess_1", 13, events.ToolCall{Name: "read_file", Args: json.RawMessage(`{"path":"b.go"}`)}),
		wired("sess_1", 14, events.ToolResult{Name: "read_file", Disposition: events.DispositionOK, Bytes: 120}),
		wired("sess_1", 15, events.ToolResult{Name: "read_file", Disposition: events.DispositionDenied}),
	}

	committed, err := sink.Append(context.Background(), group)
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	// The two chunks of the assistant message fold; the tool records do not,
	// because each one is something a reader has to tell apart.
	want := []events.Kind{
		events.KindText,
		events.KindToolCall, events.KindToolCall,
		events.KindToolResult, events.KindToolResult,
	}
	stored := readTrace(t, path)
	if fmt.Sprint(kinds(stored)) != fmt.Sprint(want) {
		t.Fatalf("the Trace holds %v, want %v", kinds(stored), want)
	}
	if len(committed) != len(stored) {
		t.Fatalf("committed %d records and the Trace holds %d", len(committed), len(stored))
	}

	var calls, results int
	for i, e := range stored {
		if e.Seq != uint64(i+1) {
			t.Errorf("stored[%d].Seq = %d, want %d", i, e.Seq, i+1)
		}
		switch e.Kind {
		case events.KindToolCall:
			calls++
		case events.KindToolResult:
			results++
		}
	}
	if calls != results {
		t.Errorf("the Trace holds %d tool calls and %d results", calls, results)
	}
}

// An Event kind this build does not recognise reaches the Trace with the bytes
// it arrived with. Dropping it would produce a Trace that is structurally
// valid and quietly wrong, and the Trace is the only instrument the project
// has.
//
// The path here is the one a foreign Harness takes: a record arrives as bytes,
// is decoded into an Event this build cannot name, and is committed. Eva's own
// loop cannot produce one, so the record is written out by hand — which is the
// only way to drive this at stage 0.
//
// What is stored is the preserving envelope: the record is kept under the
// unknown kind, holding the kind it arrived as and its payload untouched. A
// later build that does know quantum_flux can read both back out of a Trace
// written by this one.
func TestAnUnrecognisedKindReachesTheTraceWithItsBytes(t *testing.T) {
	sink, path := open(t)
	payload := `{"nested":{"b":[1,2]},"a":1}`
	arrived := `{"id":"evt_9","seq":0,"wire_seq":4,"at":{"wall":"2026-08-08T12:00:00Z","mono_ns":1},` +
		`"version":1,"kind":"quantum_flux","tenant":"tenant_1","actor":{"id":"agent","kind":"agent"},` +
		`"run":"run_1","session":"sess_1","parent":null,"payload":` + payload + `}`

	var foreign events.Event
	if err := json.Unmarshal([]byte(arrived), &foreign); err != nil {
		t.Fatalf("a foreign record did not decode: %v", err)
	}

	committed, err := sink.Append(context.Background(), []events.Event{foreign})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if len(committed) != 1 {
		t.Fatalf("committed %d records, want 1 — the unrecognised record was dropped", len(committed))
	}

	stored := readTrace(t, path)
	if len(stored) != 1 {
		t.Fatalf("the Trace holds %d records, want 1", len(stored))
	}
	if stored[0].Seq != 1 {
		t.Errorf("Seq = %d, want 1 — an unrecognised record takes a Trace position like any other", stored[0].Seq)
	}
	if stored[0].Kind != events.KindUnknown {
		t.Errorf("kind = %q, want %q", stored[0].Kind, events.KindUnknown)
	}

	unknown, ok := stored[0].Payload.(events.Unknown)
	if !ok {
		t.Fatalf("payload = %#v, want events.Unknown", stored[0].Payload)
	}
	if unknown.Kind != "quantum_flux" {
		t.Errorf("preserved kind = %q, want %q", unknown.Kind, "quantum_flux")
	}
	if string(unknown.Raw) != payload {
		t.Errorf("preserved bytes = %s, want %s", unknown.Raw, payload)
	}

	// The envelope the record arrived under is the envelope it is stored
	// under. A sink that re-attributed a foreign record would make the Trace
	// disagree with the Harness it came from.
	if stored[0].Run != "run_1" || stored[0].Session != "sess_1" || stored[0].WireSeq != 4 {
		t.Errorf("stored envelope = %+v, want the one it arrived with", stored[0])
	}
}

// The stage-0 assertion in full: an unrecognised kind survives the JSONL sink
// with its bytes intact, and the Run that committed it says so when it closes.
//
// The two halves are asserted together and against a real Trace file, because
// separately they are two facts about two packages and neither is the promise:
// the promise is that a Run cannot end up claiming a clean finish while its
// Trace holds a record nobody understood.
func TestARunThatCommittedAnUnrecognisedKindIsDegradedInTheTrace(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	var n int
	rec, err := core.NewRecorder(core.RecorderOptions{
		Sink:    sink,
		Tenant:  "tenant_1",
		Actor:   events.Identity{ID: "agent", Kind: events.ActorAgent},
		Run:     "run_1",
		Session: "sess_1",
		Now: func() events.Timestamp {
			n++
			return events.Timestamp{Wall: time.Unix(int64(n), 0).UTC(), Mono: int64(n)}
		},
		NewID: func() events.EventID {
			n++
			return events.EventID(fmt.Sprintf("evt_%d", n))
		},
	})
	if err != nil {
		t.Fatalf("new recorder: %v", err)
	}

	if err := rec.Record(ctx, events.Started{Intent: "answer"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	// An unrecognised record does not fail the Run: it is committed like any
	// other, and the Run goes on to claim what it did.
	if err := rec.Record(ctx, events.Unknown{Kind: "quantum_flux", Raw: json.RawMessage(`{"a":1}`)}); err != nil {
		t.Fatalf("an unrecognised kind failed the Run: %v", err)
	}
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone, Summary: "answered"}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	stored := readTrace(t, path)
	want := []events.Kind{events.KindStarted, events.KindUnknown, events.KindDegraded, events.KindFinished}
	if fmt.Sprint(kinds(stored)) != fmt.Sprint(want) {
		t.Fatalf("the Trace holds %v, want %v", kinds(stored), want)
	}

	if got := stored[1].Payload.(events.Unknown); got.Kind != "quantum_flux" || string(got.Raw) != `{"a":1}` {
		t.Errorf("the preserved record = %#v, want its kind and bytes", got)
	}

	degraded, ok := stored[2].Payload.(events.Degraded)
	if !ok {
		t.Fatalf("payload = %#v, want events.Degraded", stored[2].Payload)
	}
	wantMissing := []string{`unknown event kind "quantum_flux"`}
	if fmt.Sprint(degraded.Missing) != fmt.Sprint(wantMissing) {
		t.Errorf("Missing = %v, want %v", degraded.Missing, wantMissing)
	}

	// Degrading a Run does not fail it. The claim in the Trace is the one the
	// Unit made, and the caveat sits beside it rather than replacing it.
	finished := stored[3].Payload.(events.Finished)
	if finished.Claim.Result != events.ResultDone || finished.Claim.Summary != "answered" {
		t.Errorf("claim = %+v, want the Run's own", finished.Claim)
	}
}

// Degraded is absent when the Run is clean, so its presence in a Trace is on
// its own the flag a gate reads.
func TestACleanRunLeavesNoDegradedRecordInTheTrace(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	rec, err := core.NewRecorder(core.RecorderOptions{
		Sink:    sink,
		Run:     "run_1",
		Session: "sess_1",
		Now:     func() events.Timestamp { return events.Timestamp{Wall: time.Unix(1, 0).UTC(), Mono: 1} },
		NewID:   func() events.EventID { return "evt_1" },
	})
	if err != nil {
		t.Fatalf("new recorder: %v", err)
	}

	if err := rec.Record(ctx, events.Text{Chunk: "hello"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	want := []events.Kind{events.KindText, events.KindFinished}
	if got := kinds(readTrace(t, path)); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("the Trace holds %v, want %v", got, want)
	}
}

// Written as one unit, observed from outside: whatever else is committing, the
// records of one group land together and in order. Stage 2 runs parallel tool
// groups against one Trace, so this is the property that keeps a tool call
// beside its result once there is more than one goroutine.
func TestGroupsFromManyGoroutinesAreNeverInterleaved(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	const (
		writers   = 8
		perWriter = 25
		size      = 4
	)

	var wg sync.WaitGroup
	for w := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for g := range perWriter {
				tag := fmt.Sprintf("w%d_g%d", w, g)
				wire := uint64(w*perWriter*size + g*size)
				if _, err := sink.Append(ctx, []events.Event{
					wired("sess_1", wire, events.ToolCall{Name: tag, Args: json.RawMessage(`{}`)}),
					wired("sess_1", wire+1, events.ToolCall{Name: tag, Args: json.RawMessage(`{}`)}),
					wired("sess_1", wire+2, events.ToolResult{Name: tag, Disposition: events.DispositionOK}),
					wired("sess_1", wire+3, events.ToolResult{Name: tag, Disposition: events.DispositionOK}),
				}); err != nil {
					t.Errorf("append %s: %v", tag, err)
					return
				}
			}
		}()
	}
	wg.Wait()

	stored := readTrace(t, path)
	if want := writers * perWriter * size; len(stored) != want {
		t.Fatalf("the Trace holds %d records, want %d", len(stored), want)
	}

	seen := map[string]bool{}
	for at := 0; at < len(stored); at += size {
		tag := nameOf(t, stored[at])
		if seen[tag] {
			t.Fatalf("group %s appears twice — a group was split around another", tag)
		}
		seen[tag] = true

		for i := range size {
			e := stored[at+i]
			if got := nameOf(t, e); got != tag {
				t.Fatalf("record %d belongs to %s, want %s — two groups interleaved", at+i, got, tag)
			}
			if e.Seq != uint64(at+i+1) {
				t.Fatalf("record %d has Seq %d, want %d", at+i, e.Seq, at+i+1)
			}
		}
	}
}

// groupSize is how many records the crash helper writes per group. Four is the
// smallest number that can show a group torn in the middle rather than only at
// an edge.
const groupSize = 4

// helperTrace names the Trace the crash helper below writes to. Its presence in
// the environment is also what tells the helper that it is the helper.
const helperTrace = "EVA_CRASH_HELPER_TRACE"

// A process that is killed outright cannot flush, cannot close, and cannot run
// a deferred anything. What is in the Trace at that moment is what the Trace
// keeps, so this is the test that says what "durable" means here.
//
// It runs against a real process and a real signal, because a fake one would
// only prove that the fake stops where the test says it stops.
func TestAKilledWriterLeavesNoPartialRecordAndNoPartialGroup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "killed.jsonl")

	helper := exec.Command(os.Args[0], "-test.run=^TestCrashHelperAppendsGroupsUntilKilled$")
	helper.Env = append(os.Environ(), helperTrace+"="+path)
	// The helper's own output says nothing this test asserts on, and it is
	// killed before it could report anything anyway.
	helper.Stdout, helper.Stderr = io.Discard, io.Discard
	if err := helper.Start(); err != nil {
		t.Fatalf("start the helper: %v", err)
	}

	// The kill lands once the helper is demonstrably in the middle of the run:
	// enough groups are already durable that a torn one would be visible.
	deadline := time.Now().Add(30 * time.Second)
	for {
		if info, err := os.Stat(path); err == nil && info.Size() > 32*1024 {
			break
		}
		if time.Now().After(deadline) {
			_ = helper.Process.Kill()
			t.Fatal("the helper wrote nothing in 30s")
		}
		time.Sleep(time.Millisecond)
	}

	if err := helper.Process.Kill(); err != nil {
		t.Fatalf("kill the helper: %v", err)
	}

	// A signal, not an exit: a helper that returned on its own would have closed
	// the file, and this test would be measuring an orderly shutdown. An exit
	// code of -1 is what Go reports for a process a signal ended.
	//
	// Windows has no signals. Kill there is TerminateProcess, and Go reports its
	// exit code as 1 — which a helper that failed on its own could also produce.
	// So the assertion is weaker on that platform, and deliberately: what it
	// still rules out is the orderly shutdown, which is the one ending that would
	// make the rest of this test prove nothing.
	wantExit := -1
	if runtime.GOOS == "windows" {
		wantExit = 1
	}

	var exit *exec.ExitError
	if err := helper.Wait(); !errors.As(err, &exit) || exit.ExitCode() != wantExit {
		t.Fatalf("the helper ended with %v, want a kill (exit %d) — it was never killed mid-stream", err, wantExit)
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	// A record is a line. A file that does not end on a line boundary ends in
	// half a record, whatever the parser makes of it.
	if len(body) == 0 || body[len(body)-1] != '\n' {
		t.Fatal("the Trace does not end on a record boundary")
	}

	// Parses completely: every line, not merely the ones before the last.
	stored := readTrace(t, path)
	if len(stored) < groupSize {
		t.Fatalf("the Trace holds %d records, want at least one whole group", len(stored))
	}
	if len(stored)%groupSize != 0 {
		t.Fatalf("the Trace holds %d records, which is not whole groups of %d", len(stored), groupSize)
	}

	for at := 0; at < len(stored); at += groupSize {
		want := fmt.Sprintf("g%d", at/groupSize)
		for i := range groupSize {
			e := stored[at+i]
			if got := nameOf(t, e); got != want {
				t.Fatalf("record %d belongs to %s, want %s — a group was torn", at+i, got, want)
			}
			if e.Seq != uint64(at+i+1) {
				t.Fatalf("record %d has Seq %d, want %d — the sequence has a gap", at+i, e.Seq, at+i+1)
			}
		}
	}
}

// TestCrashHelperAppendsGroupsUntilKilled is the process the test above kills.
// It is a test function because that is how a Go test package gets a second
// process of itself; it does nothing when it is not the one being driven.
func TestCrashHelperAppendsGroupsUntilKilled(t *testing.T) {
	path := os.Getenv(helperTrace)
	if path == "" {
		t.Skip("the crash helper for TestAKilledWriterLeavesNoPartialRecordAndNoPartialGroup")
	}

	sink, err := trace.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	ctx := context.Background()

	// The bound is a fuse rather than a target: the parent kills this process
	// after the first few dozen groups, and the bound only stops a helper whose
	// parent died from filling the disk.
	for g := range 50_000 {
		tag := fmt.Sprintf("g%d", g)
		wire := uint64(g * groupSize)
		if _, err := sink.Append(ctx, []events.Event{
			wired("sess_1", wire, events.ToolCall{Name: tag, Args: json.RawMessage(`{}`)}),
			wired("sess_1", wire+1, events.ToolCall{Name: tag, Args: json.RawMessage(`{}`)}),
			wired("sess_1", wire+2, events.ToolResult{Name: tag, Disposition: events.DispositionOK}),
			wired("sess_1", wire+3, events.ToolResult{Name: tag, Disposition: events.DispositionOK}),
		}); err != nil {
			t.Fatalf("append %s: %v", tag, err)
		}
	}
}

func kinds(es []events.Event) []events.Kind {
	out := make([]events.Kind, len(es))
	for i, e := range es {
		out[i] = e.Kind
	}
	return out
}

// nameOf is the tool name a record carries, which is what says the group it
// belongs to.
func nameOf(t *testing.T, e events.Event) string {
	t.Helper()
	switch p := e.Payload.(type) {
	case events.ToolCall:
		return p.Name
	case events.ToolResult:
		return p.Name
	default:
		t.Fatalf("record %s carries %#v, want a tool record", e.ID, e.Payload)
		return ""
	}
}

// A group that folds to nothing writeable still must not burn a position, and
// a malformed chunk must not disappear into the chunk before it.
func TestTheFoldDoesNotAbsorbAMalformedChunk(t *testing.T) {
	sink, path := open(t)

	unversioned := wired("sess_1", 1, events.Text{Block: 0, Chunk: "bad"})
	unversioned.Version = 0

	if _, err := sink.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Text{Block: 0, Chunk: "good"}),
		unversioned,
	}); err == nil {
		t.Fatal("append accepted a chunk with no schema version, want an error")
	}
	if got := readTrace(t, path); len(got) != 0 {
		t.Fatalf("the Trace holds %d records after a rejected group, want 0", len(got))
	}
}

// A Session resumed in a second process continues where the Trace left off.
//
// The counter used to start at 1 in every process, so a second sink over one
// file gave a Session positions it had already used. Nothing failed and nothing
// said so: the file held two records at Seq 1, and every projection that reads
// position as identity was quietly wrong from there on.
func TestASecondSinkContinuesTheSeqTheTraceReached(t *testing.T) {
	first, path := open(t)

	if _, err := first.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Started{Intent: "before"}),
		wired("sess_1", 1, events.Usage{InputTokens: events.Tokens(10)}),
		wired("sess_2", 0, events.Started{Intent: "another Session"}),
	}); err != nil {
		t.Fatalf("the first sink's append failed: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	second, err := trace.Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	if _, err := second.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Finished{Claim: events.Claim{Result: events.ResultDone}}),
		wired("sess_2", 1, events.Finished{Claim: events.Claim{Result: events.ResultDone}}),
	}); err != nil {
		t.Fatalf("the second sink's append failed: %v", err)
	}

	// Every Session in the file counts from 1 without a repeat and without a
	// gap, across both processes that wrote it.
	seen := map[events.SessionID][]uint64{}
	for _, e := range readTrace(t, path) {
		seen[e.Session] = append(seen[e.Session], e.Seq)
	}
	for session, got := range seen {
		for i, seq := range got {
			if seq != uint64(i+1) {
				t.Errorf("Session %s holds Seq %v, want them dense and gapless from 1", session, got)
				break
			}
		}
	}
}

// A Trace whose last write was cut short still opens, and the Session it
// belongs to still continues past the records that did survive.
func TestATornTailDoesNotStopTheTraceBeingContinued(t *testing.T) {
	sink, path := open(t)

	if _, err := sink.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Started{Intent: "before the kill"}),
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := sink.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	whole, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if err := os.WriteFile(path, append(whole, []byte(`{"seq":2,"session":"sess_1","kin`)...), 0o600); err != nil {
		t.Fatalf("tear the tail: %v", err)
	}

	second, err := trace.Open(path)
	if err != nil {
		t.Fatalf("a Trace with a torn tail did not open: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	got, err := second.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Finished{Claim: events.Claim{Result: events.ResultDone}}),
	})
	if err != nil {
		t.Fatalf("append after a torn tail: %v", err)
	}
	if got[0].Seq != 2 {
		t.Errorf("the record after a torn tail took Seq %d, want 2 — the position the whole records reached", got[0].Seq)
	}
}

// A closed Trace says it is closed. Writing to the closed file reports too,
// but it reports the standard library's "invalid argument" — which reads as
// something being wrong with the group rather than with the Trace.
func TestAppendingToAClosedTraceSaysSo(t *testing.T) {
	sink, _ := open(t)
	if err := sink.Close(); err != nil {
		t.Fatal(err)
	}

	_, err := sink.Append(context.Background(), []events.Event{wired("sess_1", 1, events.Text{Chunk: "late"})})
	if err == nil {
		t.Fatal("an append to a closed Trace was accepted")
	}
	if !strings.Contains(err.Error(), "closed") {
		t.Errorf("the refusal does not say the Trace is closed: %v", err)
	}
}

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
	"sync"
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

// Consecutive chunks of one content block become a single record, so a Trace
// record is a unit of meaning rather than a token.
func TestConsecutiveChunksOfOneBlockFoldIntoOneRecord(t *testing.T) {
	sink, path := open(t)

	committed, err := sink.Append(context.Background(), []events.Event{
		wired("sess_1", 0, events.Started{}),
		wired("sess_1", 1, events.Text{Block: 0, Chunk: "Eva is "}),
		wired("sess_1", 2, events.Text{Block: 0, Chunk: "a software "}),
		wired("sess_1", 3, events.Text{Block: 0, Chunk: "factory."}),
		wired("sess_1", 4, events.Usage{InputTokens: 10}),
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
	if fmt.Sprint(kindsOf(stored)) != fmt.Sprint(want) {
		t.Fatalf("the Trace holds %v, want %v", kindsOf(stored), want)
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

// The group is atomic in the direction that matters: a record the encoder
// rejects takes the whole group with it, so the tool calls before it are not
// left in the Trace with no results.
func TestARejectedResultTakesItsWholeGroupWithIt(t *testing.T) {
	sink, path := open(t)
	ctx := context.Background()

	// The unencodable record is last, so a sink that wrote as it went would
	// already have stored the call it belongs to.
	orphaned := wired("sess_1", 21, events.ToolResult{Name: "read_file", Disposition: events.DispositionOK})
	orphaned.Version = 0

	if _, err := sink.Append(ctx, []events.Event{
		wired("sess_1", 20, events.ToolCall{Name: "read_file", Args: json.RawMessage(`{}`)}),
		orphaned,
	}); err == nil {
		t.Fatal("append accepted a result with no schema version, want an error")
	}
	if got := readTrace(t, path); len(got) != 0 {
		t.Fatalf("the Trace holds %d records after a rejected group, want 0 — a tool call is stored with no result", len(got))
	}

	committed, err := sink.Append(ctx, []events.Event{wired("sess_1", 22, events.Text{Chunk: "next"})})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if committed[0].Seq != 1 {
		t.Errorf("Seq = %d after a rejected group, want 1 — the rejected group burned a position", committed[0].Seq)
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
	var exit *exec.ExitError
	if err := helper.Wait(); !errors.As(err, &exit) || exit.ExitCode() != -1 {
		t.Fatalf("the helper ended with %v, want a signal — it was never killed mid-stream", err)
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

func kindsOf(es []events.Event) []events.Kind {
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

package core_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
)

// These tests observe the Recorder through its interface: what reached the
// sink, and what the Subscribers were shown. Nothing asserts on the order in
// which functions were called.

// sink records the groups it was handed and assigns Trace position the way the
// real one does, so that a test can tell a wire position from a Trace one.
type sink struct {
	mu       sync.Mutex
	groups   [][]events.Event
	next     uint64
	fail     error
	foldText bool
}

func (s *sink) Append(ctx context.Context, group []events.Event) ([]events.Event, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.fail != nil {
		return nil, s.fail
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.groups = append(s.groups, group)

	committed := make([]events.Event, 0, len(group))
	for _, e := range group {
		// The real sink folds consecutive chunks of one block. A Recorder must
		// publish what came back rather than what it sent, so a test needs a
		// sink that can return fewer Events than it was given.
		if s.foldText && len(committed) > 0 {
			prev, prevIsText := committed[len(committed)-1].Payload.(events.Text)
			if text, isText := e.Payload.(events.Text); isText && prevIsText && prev.Block == text.Block {
				prev.Chunk += text.Chunk
				committed[len(committed)-1].Payload = prev
				continue
			}
		}
		s.next++
		e.Seq = s.next
		committed = append(committed, e)
	}
	return committed, nil
}

func (s *sink) Close() error { return nil }

func (s *sink) committed() []events.Event {
	s.mu.Lock()
	defer s.mu.Unlock()

	var out []events.Event
	for _, g := range s.groups {
		out = append(out, g...)
	}
	return out
}

// collector is a Subscriber that keeps what it was shown.
type collector struct {
	seen []events.Event
	fail error
}

func (c *collector) Committed(_ context.Context, e events.Event) error {
	if c.fail != nil {
		return c.fail
	}
	c.seen = append(c.seen, e)
	return nil
}

func options(s core.TraceSink, subs ...core.Subscriber) core.RecorderOptions {
	var n int
	return core.RecorderOptions{
		Sink:    s,
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
		Subscribers: subs,
	}
}

func recorder(t *testing.T, o core.RecorderOptions) *core.Recorder {
	t.Helper()
	rec, err := core.NewRecorder(o)
	if err != nil {
		t.Fatalf("new recorder: %v", err)
	}
	return rec
}

// A Recorder built without what it needs says so, rather than failing on the
// Event that mattered.
func TestARecorderReportsWhatItIsMissing(t *testing.T) {
	full := options(&sink{})

	cases := []struct {
		name string
		bend func(*core.RecorderOptions)
		want string
	}{
		{"no sink", func(o *core.RecorderOptions) { o.Sink = nil }, "TraceSink"},
		{"no clock", func(o *core.RecorderOptions) { o.Now = nil }, "clock"},
		{"no identifiers", func(o *core.RecorderOptions) { o.NewID = nil }, "identifier"},
		{"no run", func(o *core.RecorderOptions) { o.Run = "" }, "Run"},
		{"no session", func(o *core.RecorderOptions) { o.Session = "" }, "Session"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			o := full
			c.bend(&o)

			rec, err := core.NewRecorder(o)
			if err == nil {
				t.Fatal("built a recorder with a hole in it")
			}
			if rec != nil {
				t.Error("a failed build returned a recorder")
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("error is %q, want it to name %q", err, c.want)
			}
		})
	}
}

// Every Event carries the whole envelope, so a projection can fold or filter
// without replaying the stream.
func TestEveryRecordedEventCarriesTheWholeEnvelope(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	if err := rec.Record(context.Background(), events.Started{Intent: "go"}, events.Usage{InputTokens: 3}); err != nil {
		t.Fatalf("record: %v", err)
	}

	got := s.committed()
	if len(got) != 2 {
		t.Fatalf("the sink was handed %d events, want 2", len(got))
	}
	for i, e := range got {
		switch {
		case e.ID == "":
			t.Errorf("event %d has no id", i)
		case e.Version != events.SchemaVersion:
			t.Errorf("event %d version = %d, want %d", i, e.Version, events.SchemaVersion)
		case e.Tenant != "tenant_1":
			t.Errorf("event %d tenant = %q", i, e.Tenant)
		case e.Actor.ID != "agent" || e.Actor.Kind != events.ActorAgent:
			t.Errorf("event %d actor = %+v", i, e.Actor)
		case e.Run != "run_1" || e.Session != "sess_1":
			t.Errorf("event %d run/session = %q/%q", i, e.Run, e.Session)
		case e.At.Wall.IsZero():
			t.Errorf("event %d has no wall clock reading", i)
		case e.Parent != nil:
			t.Errorf("event %d parent = %v, want nil on the main conversation", i, *e.Parent)
		}
	}
	if got[0].Kind != events.KindStarted || got[1].Kind != events.KindUsage {
		t.Errorf("kinds = %q, %q", got[0].Kind, got[1].Kind)
	}
}

// The Kind on an Event is derived from its payload, so a producer cannot make
// the two disagree.
func TestTheRecorderDerivesKindFromThePayload(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	if err := rec.Record(context.Background(), events.Text{Chunk: "hello"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if got := s.committed()[0].Kind; got != events.KindText {
		t.Errorf("kind = %q, want %q", got, events.KindText)
	}
}

// The wire position counts what was sent, and the Trace position counts what
// was durably committed. The Recorder assigns the first and never the second.
func TestTheWirePositionCountsUpAndTheTracePositionIsLeftToTheSink(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	if err := rec.Record(ctx, events.Started{}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := rec.Record(ctx, events.Text{Chunk: "a"}, events.Text{Chunk: "b"}); err != nil {
		t.Fatalf("record: %v", err)
	}

	for i, e := range s.committed() {
		if want := uint64(i); e.WireSeq != want {
			t.Errorf("event %d WireSeq = %d, want %d — the wire position skipped", i, e.WireSeq, want)
		}
		if e.Seq != 0 {
			t.Errorf("event %d reached the sink with Seq = %d, want 0 — only the sink assigns it", i, e.Seq)
		}
	}
}

// The group is the unit the sink commits, which is what makes "written whole
// or not at all" possible.
func TestRecordCommitsItsPayloadsAsOneGroup(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	if err := rec.Record(ctx, events.Text{Chunk: "a"}, events.Text{Chunk: "b"}, events.Text{Chunk: "c"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := rec.Record(ctx, events.Finished{}); err != nil {
		t.Fatalf("record: %v", err)
	}

	if len(s.groups) != 2 {
		t.Fatalf("the sink saw %d groups, want 2", len(s.groups))
	}
	if len(s.groups[0]) != 3 || len(s.groups[1]) != 1 {
		t.Errorf("group sizes = %d, %d, want 3, 1", len(s.groups[0]), len(s.groups[1]))
	}
}

// unknown is an Event kind this build does not recognise. Eva's own loop
// cannot emit one — it arrives from a foreign Harness — so a test that wants
// one records it directly.
func unknown(kind string) events.Unknown {
	return events.Unknown{Kind: kind, Raw: json.RawMessage(`{"a":1}`)}
}

// A record nobody understood degrades the Run rather than failing it, and the
// Run says so when it closes. The caveat and the claim are one group, so a
// reader that has the claim has already been shown what qualifies it — and the
// caveat cannot be lost by a caller that forgot to add it.
func TestAnUnrecognisedKindDegradesTheRunRatherThanFailingIt(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	if err := rec.Record(ctx, unknown("quantum_flux")); err != nil {
		t.Fatalf("an unrecognised kind failed the Run: %v", err)
	}
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone, Summary: "answered"}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	if len(s.groups) != 2 {
		t.Fatalf("the sink saw %d groups, want 2", len(s.groups))
	}
	closing := s.groups[1]
	want := []events.Kind{events.KindDegraded, events.KindFinished}
	if fmt.Sprint(kinds(closing)) != fmt.Sprint(want) {
		t.Fatalf("the Run closed with %v, want %v", kinds(closing), want)
	}

	degraded, ok := closing[0].Payload.(events.Degraded)
	if !ok {
		t.Fatalf("payload = %#v, want events.Degraded", closing[0].Payload)
	}
	wantMissing := []string{`unknown event kind "quantum_flux"`}
	if fmt.Sprint(degraded.Missing) != fmt.Sprint(wantMissing) {
		t.Errorf("Missing = %v, want %v", degraded.Missing, wantMissing)
	}

	// Degrading a Run does not change what it claimed.
	finished, ok := closing[1].Payload.(events.Finished)
	if !ok {
		t.Fatalf("payload = %#v, want events.Finished", closing[1].Payload)
	}
	if finished.Claim.Result != events.ResultDone {
		t.Errorf("claim = %+v, want the Run's own", finished.Claim)
	}

	// The record itself is kept. Preserving it is the whole point; the flag
	// says it was not understood, and dropping it would leave a Trace that is
	// structurally valid and quietly wrong.
	if got := s.committed()[0].Payload.(events.Unknown); got.Kind != "quantum_flux" {
		t.Errorf("the unrecognised record reached the sink as %#v", got)
	}
}

// Degraded is absent when the Run is clean, so its presence alone is the flag
// and a gate needs no separate boolean to read.
func TestACleanRunClosesWithNoDegradedRecord(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	if err := rec.Record(ctx, events.Text{Chunk: "hello"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	want := []events.Kind{events.KindText, events.KindFinished}
	if got := kinds(s.committed()); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("the Run holds %v, want %v", got, want)
	}
}

// One kind is one entry however many records of it arrive, and the entries are
// in the order the Run met them. A list that repeated itself would report the
// size of the stream rather than what was not understood.
func TestEachUnrecognisedKindIsNamedOnceInTheOrderItWasMet(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	for _, kind := range []string{"quantum_flux", "warp_field", "quantum_flux"} {
		if err := rec.Record(ctx, unknown(kind)); err != nil {
			t.Fatalf("record %s: %v", kind, err)
		}
	}
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	if len(s.groups) != 4 {
		t.Fatalf("the sink saw %d groups, want 3 records and the close", len(s.groups))
	}
	closing := s.groups[3]
	degraded, ok := closing[0].Payload.(events.Degraded)
	if !ok {
		t.Fatalf("the Run closed with %#v, want a Degraded record first", closing[0].Payload)
	}

	want := []string{`unknown event kind "quantum_flux"`, `unknown event kind "warp_field"`}
	if fmt.Sprint(degraded.Missing) != fmt.Sprint(want) {
		t.Errorf("Missing = %v, want %v — one entry per kind, in the order they were met", degraded.Missing, want)
	}
}

// kinds is what a group says it holds.
func kinds(es []events.Event) []events.Kind {
	out := make([]events.Kind, len(es))
	for i, e := range es {
		out[i] = e.Kind
	}
	return out
}

func TestRecordingNothingCommitsNothing(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	if err := rec.Record(context.Background()); err != nil {
		t.Fatalf("record: %v", err)
	}
	if len(s.groups) != 0 {
		t.Errorf("the sink saw %d groups, want none", len(s.groups))
	}
}

// A Subscriber is shown what the Trace holds, not what the producer sent. The
// sink folds, so the two are not the same list.
func TestSubscribersSeeWhatWasCommittedNotWhatWasSent(t *testing.T) {
	s := &sink{foldText: true}
	seen := &collector{}
	rec := recorder(t, options(s, seen))

	err := rec.Record(context.Background(),
		events.Text{Block: 0, Chunk: "Eva is "},
		events.Text{Block: 0, Chunk: "a factory."},
	)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	if len(seen.seen) != 1 {
		t.Fatalf("the subscriber saw %d events, want the 1 the sink committed", len(seen.seen))
	}
	if got := seen.seen[0].Payload.(events.Text).Chunk; got != "Eva is a factory." {
		t.Errorf("chunk = %q, want the folded answer", got)
	}
	if seen.seen[0].Seq == 0 {
		t.Error("the subscriber was shown an event with no Trace position")
	}
}

// Subscribers run in the order they were given, so a caller can decide which
// projection is built first.
func TestSubscribersRunInOrder(t *testing.T) {
	var order []string
	note := func(name string) core.Subscriber {
		return core.SubscriberFunc(func(_ context.Context, _ events.Event) error {
			order = append(order, name)
			return nil
		})
	}

	rec := recorder(t, options(&sink{}, note("first"), note("second")))
	if err := rec.Record(context.Background(), events.Started{}); err != nil {
		t.Fatalf("record: %v", err)
	}

	if fmt.Sprint(order) != fmt.Sprint([]string{"first", "second"}) {
		t.Errorf("order = %v, want [first second]", order)
	}
}

// A sink that refused the group is the end of it: nothing is published,
// because a Subscriber shown an Event the Trace does not hold would be reading
// a claim rather than a record.
func TestNothingIsPublishedWhenTheSinkRefusesTheGroup(t *testing.T) {
	refused := errors.New("disk is gone")
	seen := &collector{}
	rec := recorder(t, options(&sink{fail: refused}, seen))

	err := rec.Record(context.Background(), events.Started{})
	if !errors.Is(err, refused) {
		t.Fatalf("error = %v, want the sink's", err)
	}
	if len(seen.seen) != 0 {
		t.Errorf("the subscriber saw %d events after a refused group, want none", len(seen.seen))
	}
}

// A broken output stream is a real failure and is reported. The Trace still
// holds the record, because the Trace is the source of truth and it was
// written first.
func TestASubscriberFailureIsReportedAndTheRecordStands(t *testing.T) {
	broken := errors.New("broken pipe")
	s := &sink{}
	rec := recorder(t, options(s, &collector{fail: broken}))

	err := rec.Record(context.Background(), events.Started{})
	if !errors.Is(err, broken) {
		t.Fatalf("error = %v, want the subscriber's", err)
	}
	if len(s.committed()) != 1 {
		t.Error("the record did not reach the sink")
	}
}

// A payload this schema does not know is refused before anything is written,
// rather than reaching a Trace as a record with no kind.
func TestAForgedPayloadNeverReachesTheSink(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	if err := rec.Record(context.Background(), forged{}); err == nil {
		t.Fatal("a forged payload was accepted")
	}
	if err := rec.Record(context.Background(), nil); err == nil {
		t.Fatal("a nil payload was accepted")
	}
	if len(s.groups) != 0 {
		t.Errorf("the sink saw %d groups, want none", len(s.groups))
	}
}

// forged borrows isPayload by embedding, which is the one hole the compiler
// leaves open in the sealed set.
type forged struct{ events.Payload }

// A cancelled context stops the commit, and the sink is the thing that sees it.
func TestACancelledContextStopsTheCommit(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := rec.Record(ctx, events.Started{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}

// Stage 2 runs parallel tool groups against one Recorder, so the wire position
// has to be safe under concurrency. Run this with -race.
func TestConcurrentRecordsTakeDistinctWirePositions(t *testing.T) {
	const writers = 8

	s := &sink{}
	rec := recorder(t, options(s))

	var wg sync.WaitGroup
	for range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := rec.Record(context.Background(), events.Text{Chunk: "x"}); err != nil {
				t.Errorf("record: %v", err)
			}
		}()
	}
	wg.Wait()

	seen := map[uint64]bool{}
	for _, e := range s.committed() {
		if seen[e.WireSeq] {
			t.Fatalf("wire position %d was handed out twice", e.WireSeq)
		}
		seen[e.WireSeq] = true
	}
	if len(seen) != writers {
		t.Fatalf("%d distinct wire positions, want %d", len(seen), writers)
	}
}

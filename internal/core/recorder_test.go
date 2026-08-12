package core_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
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

// origin is a clock and identifier source safe to open Runs from concurrently.
// The counters in options above close over a plain int, which is all a test
// driving one Recorder needs and is a data race the moment two Runs open at
// once.
func origin() core.Origin {
	var n atomic.Int64
	return core.Origin{
		Now: func() events.Timestamp {
			at := n.Add(1)
			return events.Timestamp{Wall: time.Unix(at, 0).UTC(), Mono: at}
		},
		RunID:   func() events.RunID { return events.RunID(fmt.Sprintf("run_%d", n.Add(1))) },
		EventID: func() events.EventID { return events.EventID(fmt.Sprintf("evt_%d", n.Add(1))) },
	}
}

func payloadOf[T events.Payload](es []events.Event) (T, bool) {
	var found T
	for _, e := range es {
		if p, ok := e.Payload.(T); ok {
			return p, true
		}
	}
	return found, false
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

	if err := rec.Record(context.Background(), events.Started{Intent: "go"}, events.Usage{InputTokens: events.Tokens(3)}); err != nil {
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

// A Recorder can only raise what it sees for itself. A cost the provider never
// reported, or an answer the model cut off, is a degradation nothing about the
// committed stream reveals — so the Recorder is told, and it still composes the
// one caveat that commits with the claim.
func TestARecorderCanBeToldWhatItCannotSeeForItself(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	if err := rec.Record(ctx, events.Text{Chunk: "half an answer"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	rec.Degrade("the usage figures for this turn")
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone, Summary: "answered"}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	closing := s.groups[len(s.groups)-1]
	want := []events.Kind{events.KindDegraded, events.KindFinished}
	if fmt.Sprint(kinds(closing)) != fmt.Sprint(want) {
		t.Fatalf("the Run closed with %v, want %v", kinds(closing), want)
	}

	degraded, ok := closing[0].Payload.(events.Degraded)
	if !ok {
		t.Fatalf("payload = %#v, want events.Degraded", closing[0].Payload)
	}
	if fmt.Sprint(degraded.Missing) != fmt.Sprint([]string{"the usage figures for this turn"}) {
		t.Errorf("Missing = %v, want what the Recorder was told", degraded.Missing)
	}

	// Being told does not change what the Run claimed.
	if claim := closing[1].Payload.(events.Finished).Claim; claim.Result != events.ResultDone {
		t.Errorf("claim = %+v, want the Run's own", claim)
	}
}

// One caveat closes a Run, whether its entries were seen or supplied. Two
// Degraded records would make a reader ask which one qualified the claim.
func TestWhatTheRecorderWasToldJoinsWhatItSaw(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))
	ctx := context.Background()

	rec.Degrade("the usage figures for this turn")
	if err := rec.Record(ctx, unknown("quantum_flux")); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := rec.Finish(ctx, events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	closing := s.groups[len(s.groups)-1]
	if len(closing) != 2 {
		t.Fatalf("the Run closed with %d records, want the caveat and the claim", len(closing))
	}
	degraded := closing[0].Payload.(events.Degraded)
	want := []string{"the usage figures for this turn", `unknown event kind "quantum_flux"`}
	if fmt.Sprint(degraded.Missing) != fmt.Sprint(want) {
		t.Errorf("Missing = %v, want %v", degraded.Missing, want)
	}
}

func TestTheSameDegradationIsNamedOnce(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	rec.Degrade("the usage figures for this turn")
	rec.Degrade("the usage figures for this turn", "the answer, cut off at the model's token cap")
	if err := rec.Finish(context.Background(), events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	degraded := s.groups[len(s.groups)-1][0].Payload.(events.Degraded)
	want := []string{"the usage figures for this turn", "the answer, cut off at the model's token cap"}
	if fmt.Sprint(degraded.Missing) != fmt.Sprint(want) {
		t.Errorf("Missing = %v, want %v", degraded.Missing, want)
	}
}

// Nothing said is a clean Run. An empty call must not be the thing that puts a
// caveat on a Trace that has nothing to caveat.
func TestBeingToldNothingLeavesTheRunClean(t *testing.T) {
	s := &sink{}
	rec := recorder(t, options(s))

	rec.Degrade()
	rec.Degrade("")
	if err := rec.Finish(context.Background(), events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	if got := kinds(s.committed()); fmt.Sprint(got) != fmt.Sprint([]events.Kind{events.KindFinished}) {
		t.Fatalf("the Run holds %v, want only the claim", got)
	}
}

// A projection that breaks takes itself out of the fan-out. It does not take
// the projections registered behind it.
func TestABrokenSubscriberDoesNotStarveTheOnesBehindIt(t *testing.T) {
	s := &sink{}
	broken := errors.New("the pipe is closed")

	var seenByBroken, seenByWorking int
	failing := core.SubscriberFunc(func(context.Context, events.Event) error {
		seenByBroken++
		return broken
	})
	working := core.SubscriberFunc(func(context.Context, events.Event) error {
		seenByWorking++
		return nil
	})

	rec := recorder(t, options(s, failing, working))

	if err := rec.Record(context.Background(), events.Started{Intent: "first"}); err == nil {
		t.Fatal("the record reports no failure, want the one the Subscriber returned")
	} else if !errors.Is(err, broken) {
		t.Errorf("the failure is %v, and it does not carry what the Subscriber said", err)
	}
	if err := rec.Record(context.Background(), events.Text{Block: 0, Chunk: "second"}); err != nil {
		t.Errorf("the second record failed: %v — a Subscriber that already broke must not fail it again", err)
	}

	if seenByWorking != 2 {
		t.Errorf("the working Subscriber saw %d of 2 Events — a broken projection ahead of it stopped its feed", seenByWorking)
	}
	if seenByBroken != 1 {
		t.Errorf("the broken Subscriber saw %d Events, want 1: it missed a record and cannot be made whole by the ones after it", seenByBroken)
	}
}

// A Run one of whose projections stopped following says so when it closes. The
// screen that went blank cannot report its own absence, so the Trace does.
func TestARunWhoseProjectionStoppedFollowingIsDegraded(t *testing.T) {
	s := &sink{}
	failing := core.SubscriberFunc(func(context.Context, events.Event) error {
		return errors.New("the pipe is closed")
	})
	rec := recorder(t, options(s, failing))

	_ = rec.Record(context.Background(), events.Started{Intent: "watched by nobody"})
	if err := rec.Finish(context.Background(), events.Claim{Result: events.ResultDone}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	degraded, ok := payloadOf[events.Degraded](s.committed())
	if !ok {
		t.Fatal("the Run closed clean, and one of its projections had stopped following")
	}
	if len(degraded.Missing) != 1 || !strings.Contains(degraded.Missing[0], "projection") {
		t.Errorf("the caveat is %q, and it does not say a projection stopped following", degraded.Missing)
	}
}

// Two Runs of one Session commit at once, which is what a Session that opens a
// Recorder per Run invites. The transcript is the one thing they both touch.
func TestTwoRunsOfOneSessionFoldTogether(t *testing.T) {
	session := core.NewSession("sess_1", "tenant", events.Identity{ID: "actor", Kind: events.ActorAgent}, origin())

	var runs sync.WaitGroup
	for i := range 2 {
		rec, err := session.Open(&sink{})
		if err != nil {
			t.Fatalf("open run %d: %v", i, err)
		}
		runs.Add(1)
		go func() {
			defer runs.Done()
			_ = rec.Record(context.Background(), events.Started{Intent: fmt.Sprintf("run %d", i)})
			_ = rec.Record(context.Background(), events.Text{Block: 0, Chunk: "answering"})
			_ = session.Messages()
			_ = rec.Finish(context.Background(), events.Claim{Result: events.ResultDone})
		}()
	}
	runs.Wait()

	// Both Runs said something and both were folded. What order they interleaved
	// in is not this test's business — that they did not race is.
	if got := len(session.Messages()); got != 4 {
		t.Errorf("the transcript holds %d messages, want the 2 prompts and 2 answers both Runs committed", got)
	}
}

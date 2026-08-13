package harness_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/harness"
	"github.com/missingstudio/eva/internal/harness/harnesstest"
)

// These tests are about what the assembly decides, which is everything a turn is
// answered with and nothing about how it is answered: which Session it opens a
// Run on, who is told what happened, which capabilities the act of watching
// claims, and that the Run it opened closes whatever the Harness does.

// answering is a Harness that records what it was handed and closes the Run
// exactly as a real one does. What it does not do is call a Provider: what a
// Provider yields is asserted where the Loop is.
type answering struct {
	mu      sync.Mutex
	prompts []harness.Prompt
	say     []string

	// abandon leaves the Run open, as a Harness with a bug in it would.
	abandon bool
}

var _ harness.Harness = (*answering)(nil)

func (a *answering) Answer(ctx context.Context, prompt harness.Prompt) (core.Outcome, error) {
	a.mu.Lock()
	a.prompts = append(a.prompts, prompt)
	a.mu.Unlock()

	if err := prompt.Recorder.Record(ctx, events.Started{Intent: prompt.Spec.Intent, Capabilities: events.Capabilities{Interrupt: prompt.Interrupt}}); err != nil {
		return core.Outcome{}, err
	}
	for _, chunk := range a.say {
		if prompt.Arriving != nil {
			prompt.Arriving(chunk)
		}
		if err := prompt.Recorder.Record(ctx, events.Text{Chunk: chunk}); err != nil {
			return core.Outcome{}, err
		}
	}

	outcome := core.Outcome{Result: events.ResultDone, Summary: "answered"}
	if a.abandon {
		return outcome, nil
	}
	return outcome, prompt.Recorder.Finish(ctx, outcome.Claim())
}

func (a *answering) taken() []harness.Prompt {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]harness.Prompt(nil), a.prompts...)
}

func newAssembly(t *testing.T, unit harness.Harness) *harness.Assembly {
	t.Helper()
	return harnesstest.Assemble(t, unit, &harnesstest.Sink{})
}

func TestAnAssemblyNeedsEveryPartOfItself(t *testing.T) {
	whole := harness.AssemblyOptions{
		Harness:      &answering{},
		Sink:         &harnesstest.Sink{},
		Session:      harnesstest.Session(),
		NewSessionID: func() events.SessionID { return "sess_next" },
	}

	for _, c := range []struct {
		name    string
		missing func(*harness.AssemblyOptions)
	}{
		{name: "no Harness", missing: func(o *harness.AssemblyOptions) { o.Harness = nil }},
		{name: "no sink", missing: func(o *harness.AssemblyOptions) { o.Sink = nil }},
		{name: "no Session", missing: func(o *harness.AssemblyOptions) { o.Session = nil }},
		{name: "no Session identifiers", missing: func(o *harness.AssemblyOptions) { o.NewSessionID = nil }},
	} {
		t.Run(c.name, func(t *testing.T) {
			opts := whole
			c.missing(&opts)
			if _, err := harness.New(opts); err == nil {
				t.Error("an assembly was built with a part of it missing")
			}
		})
	}
}

func TestEveryWatchingProjectionSeesEveryEvent(t *testing.T) {
	assembly := newAssembly(t, &answering{say: []string{"answered"}})

	var first, second int
	watch(t, assembly, core.SubscriberFunc(func(context.Context, events.Event) error { first++; return nil }), nil)
	watch(t, assembly, core.SubscriberFunc(func(context.Context, events.Event) error { second++; return nil }), nil)

	if _, err := assembly.Answer(context.Background(), "say something"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	if first == 0 || second == 0 {
		t.Fatalf("projections saw %d and %d Events, want both fed", first, second)
	}
	if first != second {
		t.Errorf("projections saw %d and %d Events, want the same Trace", first, second)
	}
}

// A capability is claimed on purpose. A Session nobody is watching claims
// nothing, because a claim that is made and absent corrupts a Run where a
// missing one only degrades it.
func TestTheInterruptCapabilityIsClaimedByWatching(t *testing.T) {
	unit := &answering{}
	assembly := newAssembly(t, unit)

	if _, err := assembly.Answer(context.Background(), "one"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if taken := unit.taken(); taken[0].Interrupt {
		t.Error("a turn nobody watched claimed it can be cleanly cancelled")
	}

	watch(t, assembly, nil, nil)
	if _, err := assembly.Answer(context.Background(), "two"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if taken := unit.taken(); !taken[1].Interrupt {
		t.Error("watching did not claim the Interrupt capability")
	}
}

func TestEveryAttachedWatcherIsToldWhatIsArriving(t *testing.T) {
	unit := &answering{say: []string{"a chunk"}}
	assembly := newAssembly(t, unit)

	var first, second int
	watch(t, assembly, nil, func(string) { first++ })
	watch(t, assembly, nil, func(string) { second++ })

	if _, err := assembly.Answer(context.Background(), "say something"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if first != 1 || second != 1 {
		t.Errorf("the watchers were told %d and %d chunks, want both told once", first, second)
	}
}

// Nobody watching is nil, and not a fan-out over nothing.
func TestNobodyWatchingIsToldNothing(t *testing.T) {
	unit := &answering{say: []string{"a chunk"}}
	assembly := newAssembly(t, unit)

	if _, err := assembly.Answer(context.Background(), "one"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if taken := unit.taken(); taken[0].Arriving != nil {
		t.Error("a Harness is told a turn is being watched when nothing is")
	}

	watch(t, assembly, nil, nil)
	if _, err := assembly.Answer(context.Background(), "two"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if taken := unit.taken(); taken[1].Arriving != nil {
		t.Error("a watcher that is nothing counted as somebody watching")
	}
}

// A watcher stops when the context it attached under ends, which is what makes
// a Frontend leaving one act rather than two.
func TestAWatcherIsDroppedWhenItsContextEnds(t *testing.T) {
	unit := &answering{say: []string{"a chunk"}}
	assembly := newAssembly(t, unit)

	ctx, leave := context.WithCancel(context.Background())
	var told int
	if err := assembly.Watch(ctx, nil, func(string) { told++ }); err != nil {
		t.Fatalf("watch the Session: %v", err)
	}

	if _, err := assembly.Answer(context.Background(), "one"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if told != 1 {
		t.Fatalf("the watcher was told %d chunks, want 1", told)
	}

	leave()
	if _, err := assembly.Answer(context.Background(), "two"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if told != 1 {
		t.Errorf("a watcher that left was told %d chunks, want the 1 it heard before", told)
	}
	if watching := assembly.Watching(); watching != 0 {
		t.Errorf("%d watchers are following this Session, want none", watching)
	}
}

// A model change reaches the next turn and leaves the transcript alone.
func TestASwitchedModelAnswersTheNextTurn(t *testing.T) {
	unit := &answering{}
	assembly := newAssembly(t, unit)
	ctx := context.Background()

	if err := assembly.UseModel(ctx, "another-model"); err != nil {
		t.Fatalf("switch the model: %v", err)
	}
	if got, err := assembly.Model(ctx); err != nil || got != "another-model" {
		t.Errorf("the assembly reports model %q (%v), want the switched one", got, err)
	}
	if _, err := assembly.Answer(ctx, "one"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if got := unit.taken()[0].Model; got != "another-model" {
		t.Errorf("the turn ran against %q, want the switched model", got)
	}
}

// Clearing opens a Session rather than emptying one, so what the Trace holds of
// the old one is untouched and the next turn is answered against a new identity.
func TestClearingAnswersTheNextTurnInANewSession(t *testing.T) {
	unit := &answering{}
	assembly := newAssembly(t, unit)
	ctx := context.Background()

	if _, err := assembly.Answer(ctx, "one"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	was := assembly.Session()

	if err := assembly.Clear(ctx); err != nil {
		t.Fatalf("clear the transcript: %v", err)
	}
	if _, err := assembly.Answer(ctx, "two"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	if assembly.Session() == was {
		t.Error("clearing kept the Session, so the transcript was emptied in place")
	}
	taken := unit.taken()
	if len(taken[1].Session.Messages()) != 1 {
		t.Errorf("the second turn was conditioned on %d messages, want only its own prompt",
			len(taken[1].Session.Messages()))
	}
}

// The Run was opened here, so it is closed here whatever the Harness does with
// it. A Run left open is one a reader cannot tell from a Run still going, and
// this is the only layer that knows one was abandoned.
func TestARunTheHarnessAbandonsIsClosedByTheAssemblyThatOpenedIt(t *testing.T) {
	sink := &harnesstest.Sink{}
	assembly := harnesstest.Assemble(t, &answering{abandon: true, say: []string{"an answer"}}, sink)

	outcome, err := assembly.Answer(context.Background(), "say something")
	if err != nil {
		t.Fatalf("closing the Run reported: %v", err)
	}

	// The claim the caller is handed is the close that was written, and not the
	// Harness's own account of a turn it did not finish.
	if outcome.Result != events.ResultFailed {
		t.Errorf("the turn closed %q, want %q", outcome.Result, events.ResultFailed)
	}
	if !strings.Contains(outcome.Summary, "without closing") {
		t.Errorf("the claim reads %q, want it to say the Run was left open", outcome.Summary)
	}

	var closed int
	var claim events.Claim
	for _, e := range sink.Records() {
		if finished, is := e.Payload.(events.Finished); is {
			closed++
			claim = finished.Claim
		}
	}
	if closed != 1 {
		t.Fatalf("the Trace holds %d Finished records, want exactly the one close", closed)
	}
	if claim.Summary != outcome.Summary {
		t.Errorf("the Trace claims %q and the caller was told %q", claim.Summary, outcome.Summary)
	}
}

// And a Harness that closed its own Run is left alone: the repair above must not
// become a second account of a turn that went fine.
func TestARunTheHarnessClosedIsNotClosedTwice(t *testing.T) {
	sink := &harnesstest.Sink{}
	assembly := harnesstest.Assemble(t, &answering{}, sink)

	outcome, err := assembly.Answer(context.Background(), "say something")
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if outcome.Result != events.ResultDone {
		t.Errorf("the turn closed %q, want %q", outcome.Result, events.ResultDone)
	}

	closed := 0
	for _, e := range sink.Records() {
		if _, is := e.Payload.(events.Finished); is {
			closed++
		}
	}
	if closed != 1 {
		t.Errorf("the Trace holds %d Finished records, want one", closed)
	}
}

// Closing twice is the ordinary shape of a deferred close beside an explicit
// one, and it must not report a Trace that failed to flush.
func TestClosingTwiceReportsNothingTheSecondTime(t *testing.T) {
	assembly := newAssembly(t, &answering{})

	if err := assembly.Close(); err != nil {
		t.Fatalf("close the Trace: %v", err)
	}
	if err := assembly.Close(); err != nil {
		t.Errorf("closing an already closed Trace reported %v", err)
	}
}

// A Harness the registry does not have is a configuration mistake, and the
// refusal lists what a person may write instead.
func TestAnUnknownHarnessNamesTheOnesThereAre(t *testing.T) {
	_, err := harness.Open("nothing-by-that-name", harness.Options{})
	if err == nil {
		t.Fatal("a Harness nobody registered was opened")
	}
	for _, name := range harness.Names() {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("the refusal does not offer %q:\n%v", name, err)
		}
	}
}

func watch(t *testing.T, assembly *harness.Assembly, sub core.Subscriber, arriving func(string)) {
	t.Helper()

	if err := assembly.Watch(context.Background(), sub, arriving); err != nil {
		t.Fatalf("watch the Session: %v", err)
	}
}

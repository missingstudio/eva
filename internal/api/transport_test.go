package api_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/api"
	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/harness"
	"github.com/missingstudio/eva/internal/harness/harnesstest"
	"github.com/missingstudio/eva/internal/providers"

	// The Harness these turns are answered by, registering itself as it loads.
	_ "github.com/missingstudio/eva/internal/harness/eva"
)

// This is ADR 0047's falsifier, written as a test rather than as a sentence.
// One suite runs against every Transport and asserts the same outcomes for the
// same inputs. A behaviour that appears on one and not the other fails here,
// which is how the decision stays true rather than remembered. Where the two
// genuinely cannot agree, the case that meets it names the difference.

// transport is one way a client reaches a Session.
type transport struct {
	name string
	open func(t *testing.T, assembly *harness.Assembly) api.Session
}

func transports() []transport {
	return []transport{
		{
			// No adapter and no distance: in this process the Session API is
			// the assembly, which is what lets one turn on a command line cost
			// nothing to serve.
			name: "direct",
			open: func(_ *testing.T, assembly *harness.Assembly) api.Session {
				return assembly
			},
		},
		{
			// A real listener on a real socket, reached by a real client. What
			// is not here is what makes a Server: a Credential, a Registration,
			// and a person's decision to run one.
			name: "remote",
			open: func(t *testing.T, assembly *harness.Assembly) api.Session {
				server := httptest.NewServer(api.Handler(assembly))
				t.Cleanup(server.Close)
				return api.Remote(server.URL, server.Client())
			},
		},
	}
}

// world is one Session's worth of assembly, with the Provider under the test's
// hand and the Trace where the test can read it.
type world struct {
	session  api.Session
	assembly *harness.Assembly
	provider *scripted
	sink     *harnesstest.Sink
}

func (w *world) records() []events.Event { return w.sink.Records() }

func (w *world) kinds() []events.Kind { return harnesstest.Kinds(w.records()) }

// each runs one case against every Transport. The body may not know which one
// it is on, which is the whole of what this suite asserts.
func each(t *testing.T, script []turn, run func(t *testing.T, w *world)) {
	t.Helper()

	for _, carrier := range transports() {
		t.Run(carrier.name, func(t *testing.T) {
			w := open(t, script)
			w.session = carrier.open(t, w.assembly)
			run(t, w)
		})
	}
}

func open(t *testing.T, script []turn) *world {
	t.Helper()

	provider := &scripted{script: script}
	unit, err := harness.Open(config.DefaultHarness, harness.Options{
		Provider:     provider,
		ProviderName: "scripted",
	})
	if err != nil {
		t.Fatalf("open the Harness: %v", err)
	}

	sink := &harnesstest.Sink{}
	return &world{assembly: harnesstest.Assemble(t, unit, sink), provider: provider, sink: sink}
}

func TestAPromptIsAnsweredAndTheClaimClosesTheRun(t *testing.T) {
	each(t, []turn{{chunks: []string{"Eva is a ", "software factory."}}}, func(t *testing.T, w *world) {
		outcome, err := w.session.Answer(t.Context(), "what is eva")
		if err != nil {
			t.Fatalf("the record failed: %v", err)
		}
		if outcome.Result != events.ResultDone {
			t.Errorf("the turn closed %q, want %q", outcome.Result, events.ResultDone)
		}
		if outcome.Summary != "answered" {
			t.Errorf("the claim reads %q, want %q", outcome.Summary, "answered")
		}
		if outcome.Class != "" {
			t.Errorf("a turn that answered carries the class %q", outcome.Class)
		}

		// Repeats collapse, because how many records one answer becomes is the
		// sink's to decide and is asserted where the sink is. What this asks is
		// that a turn reached the Trace as the same account, whichever Transport
		// carried the request.
		want := []events.Kind{events.KindStarted, events.KindText, events.KindUsage, events.KindFinished}
		if got := runOf(w.kinds()); !sameKinds(got, want) {
			t.Errorf("the Trace holds %v, want %v", got, want)
		}
	})
}

// The intent rides on Started, which is what puts the prompt in the Trace and
// therefore in the transcript.
func TestThePromptReachesTheTrace(t *testing.T) {
	each(t, []turn{{chunks: []string{"an answer"}}}, func(t *testing.T, w *world) {
		if _, err := w.session.Answer(t.Context(), "the prompt a person typed"); err != nil {
			t.Fatalf("the record failed: %v", err)
		}

		for _, e := range w.records() {
			if started, is := e.Payload.(events.Started); is {
				if started.Intent != "the prompt a person typed" {
					t.Errorf("Started carries the intent %q", started.Intent)
				}
				return
			}
		}
		t.Error("the Trace holds no Started record, so the prompt is in no transcript")
	})
}

func TestASecondPromptIsAnsweredInTheLightOfTheFirst(t *testing.T) {
	script := []turn{{chunks: []string{"first answer"}}, {chunks: []string{"second answer"}}}

	each(t, script, func(t *testing.T, w *world) {
		if _, err := w.session.Answer(t.Context(), "first prompt"); err != nil {
			t.Fatalf("the first turn failed: %v", err)
		}
		if _, err := w.session.Answer(t.Context(), "second prompt"); err != nil {
			t.Fatalf("the second turn failed: %v", err)
		}

		conditioning := w.provider.calls()[1].Messages
		var said []string
		for _, message := range conditioning {
			said = append(said, message.Said())
		}
		for _, want := range []string{"first prompt", "first answer", "second prompt"} {
			if !holds(said, want) {
				t.Errorf("the second turn was not conditioned on %q:\n%v", want, said)
			}
		}
	})
}

// A turn that failed is an Outcome carrying the class, not an error. The class
// is what a projection spends, and it has to survive the distance.
func TestAFailedTurnCarriesItsClassRatherThanAnError(t *testing.T) {
	script := []turn{{refusal: &providers.Fault{
		Err:   errors.New("the vendor refused the key"),
		Class: events.ErrorAuthFailed,
	}}}

	each(t, script, func(t *testing.T, w *world) {
		outcome, err := w.session.Answer(t.Context(), "anything")
		if err != nil {
			t.Fatalf("a turn that failed reported the record failing: %v", err)
		}
		if outcome.Result != events.ResultFailed {
			t.Errorf("the turn closed %q, want %q", outcome.Result, events.ResultFailed)
		}
		if outcome.Class != events.ErrorAuthFailed {
			t.Errorf("the claim carries the class %q, want %q", outcome.Class, events.ErrorAuthFailed)
		}
	})
}

// Only a durable Event moves a Cursor. A watcher is told both, and what tells
// them apart is the Trace position the record carries.
func TestAWatcherIsToldWhatWasCommittedAndWhatIsArriving(t *testing.T) {
	each(t, []turn{{chunks: []string{"one ", "two"}}}, func(t *testing.T, w *world) {
		watcher := &watching{}
		if err := w.session.Watch(t.Context(), watcher, watcher.chunk); err != nil {
			t.Fatalf("watch the Session: %v", err)
		}

		if _, err := w.session.Answer(t.Context(), "say something"); err != nil {
			t.Fatalf("the record failed: %v", err)
		}
		watcher.settle(t, len(w.records()))

		if got := watcher.said(); got != "one two" {
			t.Errorf("the watcher was told %q arriving, want %q", got, "one two")
		}
		for _, e := range watcher.committed() {
			if e.Seq == 0 {
				t.Errorf("a %s record reached a Subscriber with no Trace position", e.Kind)
			}
		}
		if len(watcher.committed()) != len(w.records()) {
			t.Errorf("the watcher was told %d records and the Trace holds %d",
				len(watcher.committed()), len(w.records()))
		}
	})
}

// Watching claims the Interrupt capability, and it rides on Started so that a
// reader of the Trace knows what the turn could have done.
func TestWatchingClaimsTheInterruptCapability(t *testing.T) {
	each(t, []turn{{chunks: []string{"an answer"}}}, func(t *testing.T, w *world) {
		if err := w.session.Watch(t.Context(), nil, nil); err != nil {
			t.Fatalf("watch the Session: %v", err)
		}
		if _, err := w.session.Answer(t.Context(), "say something"); err != nil {
			t.Fatalf("the record failed: %v", err)
		}

		for _, e := range w.records() {
			if started, is := e.Payload.(events.Started); is {
				if !started.Capabilities.Interrupt {
					t.Error("a watched turn claims it cannot be cleanly cancelled")
				}
				return
			}
		}
		t.Error("the Trace holds no Started record")
	})
}

func TestTheModelIsReadAndSwitched(t *testing.T) {
	script := []turn{{chunks: []string{"first"}}, {chunks: []string{"second"}}}

	each(t, script, func(t *testing.T, w *world) {
		got, err := w.session.Model(t.Context())
		if err != nil {
			t.Fatalf("read the model: %v", err)
		}
		if got != harnesstest.Model {
			t.Errorf("the Session reports model %q, want %q", got, harnesstest.Model)
		}

		if err := w.session.UseModel(t.Context(), "another-model"); err != nil {
			t.Fatalf("switch the model: %v", err)
		}
		if got, err = w.session.Model(t.Context()); err != nil || got != "another-model" {
			t.Fatalf("the Session reports model %q (%v), want the switched one", got, err)
		}

		if _, err := w.session.Answer(t.Context(), "one"); err != nil {
			t.Fatalf("the record failed: %v", err)
		}
		if used := w.provider.calls()[0].Model; used != "another-model" {
			t.Errorf("the turn ran against %q, want the switched model", used)
		}
	})
}

// Clearing opens a Session rather than emptying one, so the next turn is
// conditioned on its own prompt and nothing before it.
func TestClearingLeavesTheNextTurnUnconditioned(t *testing.T) {
	script := []turn{{chunks: []string{"first answer"}}, {chunks: []string{"second answer"}}}

	each(t, script, func(t *testing.T, w *world) {
		if _, err := w.session.Answer(t.Context(), "first prompt"); err != nil {
			t.Fatalf("the first turn failed: %v", err)
		}
		if err := w.session.Clear(t.Context()); err != nil {
			t.Fatalf("clear the transcript: %v", err)
		}
		if _, err := w.session.Answer(t.Context(), "second prompt"); err != nil {
			t.Fatalf("the second turn failed: %v", err)
		}

		var said []string
		for _, message := range w.provider.calls()[1].Messages {
			said = append(said, message.Said())
		}
		if holds(said, "first prompt") || holds(said, "first answer") {
			t.Errorf("a cleared transcript still conditioned the next turn:\n%v", said)
		}
	})
}

// An interrupted Run closes, whatever carried the request.
//
// Here the two Transports cannot agree on everything, and the difference is the
// distance rather than a second code path: a client that cancelled its own
// request cannot also be handed the reply. So what is asserted is the record,
// which is identical on both.
func TestAnInterruptedTurnClosesTheRunOnEitherTransport(t *testing.T) {
	each(t, []turn{{chunks: []string{"the start of an answer"}, hold: true}}, func(t *testing.T, w *world) {
		ctx, interrupt := context.WithCancel(t.Context())

		done := make(chan struct{})
		go func() {
			defer close(done)
			_, _ = w.session.Answer(ctx, "say something long")
		}()

		w.provider.reached(t)
		interrupt()
		<-done

		settle(t, func() bool { return closedRuns(w.records()) == 1 })

		var claim events.Claim
		for _, e := range w.records() {
			if finished, is := e.Payload.(events.Finished); is {
				claim = finished.Claim
			}
		}
		if claim.Result != events.ResultFailed {
			t.Errorf("an interrupted Run closed %q, want %q", claim.Result, events.ResultFailed)
		}
		if claim.Summary != "interrupted" {
			t.Errorf("an interrupted Run closed with the claim %q, want %q", claim.Summary, "interrupted")
		}
	})
}

// A watcher stops when the context it attached under ends, on either Transport.
func TestAWatcherThatLeftIsToldNothingMore(t *testing.T) {
	script := []turn{{chunks: []string{"first"}}, {chunks: []string{"second"}}}

	each(t, script, func(t *testing.T, w *world) {
		ctx, leave := context.WithCancel(t.Context())
		watcher := &watching{}
		if err := w.session.Watch(ctx, watcher, watcher.chunk); err != nil {
			t.Fatalf("watch the Session: %v", err)
		}

		if _, err := w.session.Answer(t.Context(), "one"); err != nil {
			t.Fatalf("the first turn failed: %v", err)
		}
		watcher.settle(t, len(w.records()))
		heard := len(watcher.committed())

		leave()
		// The far side learns a client has gone when its connection ends, which
		// is not the instant it was asked to.
		settle(t, func() bool { return w.assembly.Watching() == 0 })

		if _, err := w.session.Answer(t.Context(), "two"); err != nil {
			t.Fatalf("the second turn failed: %v", err)
		}
		settle(t, func() bool { return closedRuns(w.records()) == 2 })

		if got := len(watcher.committed()); got != heard {
			t.Errorf("a watcher that left was told %d records, want the %d it heard before", got, heard)
		}
	})
}

// A request the Server cannot make sense of is refused rather than acted on,
// and the refusal reaches the client in the Server's own words. Nothing is
// asserted about the Direct Transport here: there is no wire for a request to
// arrive malformed on, which is what makes this the Remote Transport's own case
// rather than a behaviour one of them lacks.
func TestTheRemoteTransportRefusesARequestItCannotRead(t *testing.T) {
	w := open(t, nil)
	server := httptest.NewServer(api.Handler(w.assembly))
	t.Cleanup(server.Close)

	response, err := server.Client().Post(server.URL+"/session/answer", "application/json",
		strings.NewReader(`{"intent":"hello","something":"else"}`))
	if err != nil {
		t.Fatalf("reach the server: %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("the server answered %s, want %s", response.Status, http.StatusText(http.StatusBadRequest))
	}
	if got := closedRuns(w.records()); got != 0 {
		t.Errorf("a refused request opened %d Run(s)", got)
	}
}

// Helpers, and the fakes the suite drives.

// runOf collapses a repeated kind to one, so that a group written as two
// records and a group written as one read alike.
func runOf(kinds []events.Kind) []events.Kind {
	out := make([]events.Kind, 0, len(kinds))
	for i, kind := range kinds {
		if i == 0 || kinds[i-1] != kind {
			out = append(out, kind)
		}
	}
	return out
}

func sameKinds(got, want []events.Kind) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func holds(said []string, want string) bool {
	for _, one := range said {
		if one == want {
			return true
		}
	}
	return false
}

func closedRuns(records []events.Event) int {
	n := 0
	for _, e := range records {
		if e.Kind == events.KindFinished {
			n++
		}
	}
	return n
}

// settle waits for something to become true, because a Transport with a
// distance in it does not finish everything before the call returns.
func settle(t *testing.T, done func() bool) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("waited 5s and it did not happen")
}

// turn is one recorded turn the Provider replays.
type turn struct {
	chunks  []string
	refusal *providers.Fault
	// hold keeps the turn open once its chunks are out, so a test can stop one
	// that is still running.
	hold bool
}

type scripted struct {
	mu     sync.Mutex
	script []turn
	at     int
	seen   []providers.Call
}

var _ providers.Provider = (*scripted)(nil)

func (s *scripted) Stream(_ context.Context, call providers.Call) providers.Stream {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.at >= len(s.script) {
		return providers.Failed(fmt.Errorf("scripted: %d turn(s) recorded and this is turn %d", len(s.script), s.at+1))
	}
	rec := s.script[s.at]
	s.at++
	s.seen = append(s.seen, call)

	if rec.refusal != nil {
		return providers.Failed(rec.refusal)
	}
	return &replay{rec: rec}
}

func (s *scripted) calls() []providers.Call {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]providers.Call(nil), s.seen...)
}

// reached waits until a turn has started, so that a test stopping one stops a
// turn that is running rather than one that has not begun.
func (s *scripted) reached(t *testing.T) {
	t.Helper()
	settle(t, func() bool { return len(s.calls()) > 0 })
}

type replay struct {
	rec    turn
	at     int
	priced bool
	held   bool
}

func (r *replay) Next(ctx context.Context) (events.Payload, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if r.at < len(r.rec.chunks) {
		chunk := r.rec.chunks[r.at]
		r.at++
		return events.Text{Chunk: chunk}, nil
	}
	if r.rec.hold && !r.held {
		r.held = true
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if !r.priced {
		r.priced = true
		return events.Usage{InputTokens: events.Tokens(10), OutputTokens: events.Tokens(20)}, nil
	}
	return nil, io.EOF
}

func (r *replay) Close() error { return nil }

// watching is a Frontend: told what the Trace holds, and told what is arriving
// before any of it is.
type watching struct {
	mu    sync.Mutex
	saw   []events.Event
	heard string
}

var _ core.Subscriber = (*watching)(nil)

func (w *watching) Committed(_ context.Context, e events.Event) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.saw = append(w.saw, e)
	return nil
}

func (w *watching) chunk(text string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.heard += text
}

func (w *watching) committed() []events.Event {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]events.Event(nil), w.saw...)
}

func (w *watching) said() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.heard
}

func (w *watching) settle(t *testing.T, records int) {
	t.Helper()
	settle(t, func() bool { return len(w.committed()) >= records })
}

// The Trace refusing a record is the one failure that reaches a caller as an
// error rather than as an Outcome: a turn's own account of itself is in the
// Trace, and this is the fact no Trace holds. It reaches one on either
// Transport, and it says what the sink said.
func TestARecordThatCannotBeWrittenReachesTheCallerOnEitherTransport(t *testing.T) {
	each(t, []turn{{chunks: []string{"an answer"}}}, func(t *testing.T, w *world) {
		w.sink.Refuse = func([]events.Event) error { return errRefused }

		if _, err := w.session.Answer(t.Context(), "say something"); err == nil {
			t.Fatal("a Trace that took nothing was reported as a turn that went fine")
		} else if !strings.Contains(err.Error(), errRefused.Error()) {
			t.Errorf("the failure reads %q, want it to carry what the sink said", err)
		}
	})
}

// And here the two Transports genuinely cannot agree. An error's identity does
// not survive a wire and its account of itself does, so a client that matched
// on the identity would be matching on a sentence — which is why the Remote
// Transport hands back the words and never the original.
func TestAnErrorKeepsItsIdentityInThisProcessAndItsWordsOverTheWire(t *testing.T) {
	near := open(t, []turn{{chunks: []string{"an answer"}}})
	near.sink.Refuse = func([]events.Event) error { return errRefused }

	_, err := near.assembly.Answer(t.Context(), "say something")
	if !errors.Is(err, errRefused) {
		t.Errorf("in this process the failure is %v, want the sink's own error", err)
	}

	far := open(t, []turn{{chunks: []string{"an answer"}}})
	far.sink.Refuse = func([]events.Event) error { return errRefused }
	server := httptest.NewServer(api.Handler(far.assembly))
	t.Cleanup(server.Close)

	_, err = api.Remote(server.URL, server.Client()).Answer(t.Context(), "say something")
	if err == nil {
		t.Fatal("a Trace that took nothing was reported over the wire as a turn that went fine")
	}
	if errors.Is(err, errRefused) {
		t.Error("an error's identity survived a wire, which is a promise nothing can keep")
	}
	if !strings.Contains(err.Error(), errRefused.Error()) {
		t.Errorf("the failure reads %q, want the far side's own words", err)
	}
}

// The Server's half serves the Session API rather than an implementation of it,
// so what holds Sessions is the Server's business — and a test can put anything
// at all behind it.
func TestTheServerServesWhateverSatisfiesTheSessionAPI(t *testing.T) {
	server := httptest.NewServer(api.Handler(&stubborn{model: "a-model-nothing-assembled"}))
	t.Cleanup(server.Close)

	client := api.Remote(server.URL, server.Client())
	got, err := client.Model(t.Context())
	if err != nil {
		t.Fatalf("read the model: %v", err)
	}
	if got != "a-model-nothing-assembled" {
		t.Errorf("the Session reports model %q, want the one behind the Handler", got)
	}

	// And a Session that cannot answer is the Server's failure to report, not
	// the client's request to fix.
	refusing := httptest.NewServer(api.Handler(&stubborn{refuse: errRefused}))
	t.Cleanup(refusing.Close)

	if _, err := api.Remote(refusing.URL, refusing.Client()).Model(t.Context()); err == nil {
		t.Error("a Session that could not answer was reported as one that did")
	} else if !strings.Contains(err.Error(), errRefused.Error()) {
		t.Errorf("the failure reads %q, want the Session's own words", err)
	}
}

var errRefused = errors.New("no space left on device")

// stubborn is a Session with nothing behind it, for the tests that ask what the
// Server does with what it was handed.
type stubborn struct {
	model  string
	refuse error
}

var _ api.Session = (*stubborn)(nil)

func (s *stubborn) Answer(context.Context, string) (core.Outcome, error) {
	return core.Outcome{}, s.refuse
}

func (s *stubborn) Watch(context.Context, core.Subscriber, func(string)) error { return s.refuse }

func (s *stubborn) Model(context.Context) (string, error) { return s.model, s.refuse }

func (s *stubborn) UseModel(context.Context, string) error { return s.refuse }

func (s *stubborn) Clear(context.Context) error { return s.refuse }

package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/harness"
	"github.com/missingstudio/eva/internal/harness/harnesstest"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/trace"
	"github.com/missingstudio/eva/internal/tui"

	// The Harness these turns are answered by, registering itself as it loads.
	_ "github.com/missingstudio/eva/internal/harness/eva"
)

// These tests run the interface itself, in this process, with input disabled
// and output redirected. That is the point of them: an interface that needed a
// terminal to run would be an interface CI cannot test, and the one thing this
// stage promises about interruption cannot be observed from outside a process
// that is not driving the keys.

type driven struct {
	mu     sync.Mutex
	script []recording
	turn   int
	calls  []providers.Call
}

type recording struct {
	// refusal, when it is not nil, is a turn that fails instead of answering,
	// carrying the class a real Provider would have classified it as. It is a
	// Fault rather than a plain error because the class is the thing under
	// test: an error alone would exercise the path where nothing classified
	// the failure, which is what the recording that runs out already covers.
	refusal *providers.Fault

	// chunks is the answer, split the way a stream would deliver it.
	chunks   []string
	degraded []string
	// gate, when it is not nil, is where the turn stops once its last chunk
	// is out — so that a test can look at a stream while it is still in
	// flight. The turn goes on when the gate is closed, and it ends early if
	// the Run is cancelled.
	gate chan struct{}
}

var _ providers.Provider = (*driven)(nil)

func (d *driven) Stream(_ context.Context, call providers.Call) providers.Stream {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.turn >= len(d.script) {
		return providers.Failed(fmt.Errorf("driven: the script records %d turn(s) and this is turn %d", len(d.script), d.turn+1))
	}
	rec := d.script[d.turn]
	d.turn++
	d.calls = append(d.calls, call)

	if rec.refusal != nil {
		return providers.Failed(rec.refusal)
	}
	return &drivenStream{rec: rec}
}

func (d *driven) transcripts() [][]core.Message {
	d.mu.Lock()
	defer d.mu.Unlock()

	out := make([][]core.Message, len(d.calls))
	for i, call := range d.calls {
		out[i] = call.Messages
	}
	return out
}

func (d *driven) models() []string {
	d.mu.Lock()
	defer d.mu.Unlock()

	out := make([]string, len(d.calls))
	for i, call := range d.calls {
		out[i] = call.Model
	}
	return out
}

func conversation(t *testing.T, call []core.Message) []core.Message {
	t.Helper()

	if len(call) == 0 || call[0].Author != core.AuthorSystem || call[0].Said() != prompt.Base() {
		t.Fatalf("the call is not headed by the base system prompt:\n%+v", call)
	}
	return call[1:]
}

// reported is the figure a counter carries, and a failure when it carries none.
// Asserting on a dereferenced absence would report a wrong number rather than a
// figure that never arrived, and those are different bugs.
func reported(t *testing.T, n *uint64) uint64 {
	t.Helper()

	if n == nil {
		t.Fatal("the counter reports no figure, want one")
	}
	return *n
}

type drivenStream struct {
	rec      recording
	at       int
	waited   bool
	priced   bool
	caveated bool
}

func (s *drivenStream) Next(ctx context.Context) (events.Payload, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.at < len(s.rec.chunks) {
		chunk := s.rec.chunks[s.at]
		s.at++
		return events.Text{Chunk: chunk}, nil
	}
	if s.rec.gate != nil && !s.waited {
		s.waited = true
		select {
		case <-s.rec.gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if !s.priced {
		s.priced = true
		return events.Usage{InputTokens: events.Tokens(10), OutputTokens: events.Tokens(20)}, nil
	}
	if len(s.rec.degraded) > 0 && !s.caveated {
		s.caveated = true
		return events.Degraded{Missing: s.rec.degraded}, nil
	}
	return nil, io.EOF
}

func (s *drivenStream) Close() error { return nil }

type heard struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (h *heard) Write(p []byte) (int, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.buf.Write(p)
}

func (h *heard) String() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.buf.String()
}

type dialogue struct {
	program  *tea.Program
	console  *tui.Console
	provider *driven
	out      *heard
	trace    string
	done     chan error
}

// escapes matches any terminal escape sequence, so that a test can assert on
// the words a person reads rather than on the bytes that place them.
var escapes = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][0-9A-B]|\x1b[=>]`)

func (d *dialogue) read() string { return escapes.ReplaceAllString(d.console.Screen(), "") }

// begin builds the interface with input disabled and output redirected, and
// starts it. Nothing here has a terminal.
func begin(t *testing.T, script ...recording) *dialogue {
	t.Helper()

	path := filepath.Join(t.TempDir(), "traces", "eva.jsonl")
	sink, err := trace.Open(path)
	if err != nil {
		t.Fatalf("open the Trace: %v", err)
	}
	t.Cleanup(func() { _ = sink.Close() })

	provider := &driven{script: script}
	unit, err := harness.Open(config.DefaultHarness, harness.Options{Provider: provider, ProviderName: "driven"})
	if err != nil {
		t.Fatalf("open the Harness: %v", err)
	}

	assembly := harnesstest.Assemble(t, unit, sink)

	out := &heard{}
	// The console drives the same Session API a browser would. In this process
	// that API is the assembly itself, and a browser typing the same prompt
	// reaches the same five methods over the wire.
	program, c, err := tui.NewConsole(context.Background(), assembly, &local{}, nil, out)
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}

	d := &dialogue{program: program, console: c, provider: provider, out: out, trace: path, done: make(chan error, 1)}
	go func() {
		_, err := program.Run()
		d.done <- err
	}()

	// A window size, as a terminal would send one, until the first frame comes
	// back.
	d.settle(t, func() bool {
		d.program.Send(tea.WindowSizeMsg{Width: 80, Height: 24})
		return strings.Contains(d.out.String(), "›")
	})

	t.Cleanup(func() { d.leave(t) })
	return d
}

func (d *dialogue) say(t *testing.T, prompt string) {
	t.Helper()
	d.settle(t, func() bool { return !d.console.Busy() })

	for _, r := range prompt {
		d.program.Send(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	d.program.Send(tea.KeyPressMsg{Code: tea.KeyEnter})
}

func (d *dialogue) interrupt() {
	d.program.Send(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
}

func (d *dialogue) leave(t *testing.T) {
	t.Helper()

	select {
	case err := <-d.done:
		if err != nil {
			t.Errorf("the interface ended with %v", err)
		}
		return
	default:
	}

	d.program.Send(tea.KeyPressMsg{Code: 'd', Mod: tea.ModCtrl})
	select {
	case err := <-d.done:
		if err != nil {
			t.Errorf("the interface ended with %v", err)
		}
	case <-time.After(5 * time.Second):
		d.program.Kill()
		t.Fatal("the interface did not end on ctrl+d")
	}
	d.console.Wait()
}

// settle waits for something to become true, because the turn runs beside the
// test rather than inside it.
func (d *dialogue) settle(t *testing.T, done func() bool) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("waited 5s and it did not happen\nread:\n%s\ntrace:\n%s", d.read(), d.stored(t))
}

func (d *dialogue) closed(t *testing.T, count int) {
	t.Helper()
	d.settle(t, func() bool { return len(d.of(t, events.KindFinished)) >= count })
}

func (d *dialogue) stored(t *testing.T) string {
	t.Helper()

	body, err := os.ReadFile(d.trace)
	if os.IsNotExist(err) {
		return ""
	}
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	return string(body)
}

func (d *dialogue) records(t *testing.T) []events.Event {
	t.Helper()

	var out []events.Event
	scan := bufio.NewScanner(strings.NewReader(d.stored(t)))
	scan.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scan.Scan() {
		if len(bytes.TrimSpace(scan.Bytes())) == 0 {
			continue
		}
		var e events.Event
		if err := json.Unmarshal(scan.Bytes(), &e); err != nil {
			t.Fatalf("record %d is not an Event: %v\n%s", len(out)+1, err, scan.Bytes())
		}
		out = append(out, e)
	}
	if err := scan.Err(); err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	return out
}

func (d *dialogue) of(t *testing.T, kind events.Kind) []events.Event {
	t.Helper()

	var out []events.Event
	for _, e := range d.records(t) {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

func TestTheInterfaceRunsWithInputDisabledAndOutputRedirected(t *testing.T) {
	d := begin(t, recording{chunks: []string{"Eva is a ", "software factory."}})

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "software factory.") })

	read := d.read()
	if !strings.Contains(read, "what is this project") {
		t.Errorf("the prompt was never shown back:\n%s", read)
	}
}

// The answer is on screen while the turn is still running. A turn that only
// appeared when it was over would be a turn a person waits out in silence.
func TestAnAnswerStreamsAsItArrivesRatherThanAtTheEnd(t *testing.T) {
	gate := make(chan struct{})
	d := begin(t, recording{chunks: []string{"Eva is a ", "software factory."}, gate: gate})

	d.say(t, "what is this project")
	d.settle(t, func() bool { return strings.Contains(d.read(), "software factory.") })

	// Still in flight: the answer is readable and the Run has not closed.
	if closed := d.of(t, events.KindFinished); len(closed) != 0 {
		t.Fatalf("the Run closed before the stream was released — this is not streaming")
	}

	close(gate)
	d.closed(t, 1)
}

// The Session is a conversation rather than a series of unrelated turns.
func TestASecondPromptIsAnsweredInTheLightOfTheFirst(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"Eva is a software factory."}},
		recording{chunks: []string{"It is autonomous."}},
	)

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.say(t, "and what else")
	d.closed(t, 2)

	calls := d.provider.transcripts()
	if len(calls) != 2 {
		t.Fatalf("the Provider was called %d time(s), want 2", len(calls))
	}
	if first := conversation(t, calls[0]); len(first) != 1 || first[0].Said() != "what is this project" {
		t.Fatalf("the first call was conditioned on %+v, want the first prompt alone", first)
	}

	want := []core.Message{
		core.Say(core.AuthorUser, "what is this project"),
		core.Say(core.AuthorAssistant, "Eva is a software factory."),
		core.Say(core.AuthorUser, "and what else"),
	}
	if second := conversation(t, calls[1]); fmt.Sprint(second) != fmt.Sprint(want) {
		t.Errorf("the second call was conditioned on\n%+v\nwant\n%+v", second, want)
	}
}

func TestCtrlCDuringAStreamReturnsThePromptAndLeavesTheSessionUsable(t *testing.T) {
	d := begin(t,
		recording{chunks: []string{"a long answer nobody wanted"}, gate: make(chan struct{})},
		recording{chunks: []string{"a short one."}},
	)

	d.say(t, "answer at length")
	d.settle(t, func() bool { return strings.Contains(d.read(), "a long answer nobody wanted") })

	d.interrupt()
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "interrupted") })

	// The prompt is back, and the next turn runs against a Session that holds
	// what did arrive.
	d.say(t, "shorter please")
	d.closed(t, 2)
	d.settle(t, func() bool { return strings.Contains(d.read(), "a short one.") })

	calls := d.provider.transcripts()
	if len(calls) != 2 {
		t.Fatalf("the Provider was called %d time(s), want 2 — the Session did not survive the interrupt", len(calls))
	}
	want := []core.Message{
		core.Say(core.AuthorUser, "answer at length"),
		core.Say(core.AuthorAssistant, "a long answer nobody wanted"),
		core.Say(core.AuthorUser, "shorter please"),
	}
	if after := conversation(t, calls[1]); fmt.Sprint(after) != fmt.Sprint(want) {
		t.Errorf("the turn after the interrupt was conditioned on\n%+v\nwant\n%+v", after, want)
	}
}

func TestATurnCancelledByCtrlCLeavesATraceThatParses(t *testing.T) {
	d := begin(t, recording{chunks: []string{"half an ", "answer"}, gate: make(chan struct{})})

	d.say(t, "answer at length")
	d.settle(t, func() bool { return strings.Contains(d.read(), "half an answer") })
	d.interrupt()
	d.closed(t, 1)

	stored := d.records(t)
	for i, e := range stored {
		switch {
		case e.Seq != uint64(i+1):
			t.Fatalf("record %d has Seq %d, want %d — the sequence has a gap", i, e.Seq, i+1)
		case e.ID == "" || e.Kind == "" || e.Session == "" || e.Run == "":
			t.Fatalf("record %d is missing part of its envelope: %+v", i, e)
		case e.Payload == nil:
			t.Fatalf("record %d carries no payload", i)
		}
	}

	var answered bool
	for _, e := range d.of(t, events.KindText) {
		if text, ok := e.Payload.(events.Text); ok && text.Chunk == "half an answer" {
			answered = true
		}
	}
	if !answered {
		t.Errorf("the Trace does not hold the part of the answer that arrived:\n%s", d.stored(t))
	}

	closed := d.of(t, events.KindFinished)
	if len(closed) != 1 {
		t.Fatalf("the Trace holds %d closed Runs, want 1 — a cancelled Run must still close", len(closed))
	}
	finished, ok := closed[0].Payload.(events.Finished)
	if !ok {
		t.Fatalf("payload = %#v, want Finished", closed[0].Payload)
	}
	if finished.Claim.Summary != "interrupted" {
		t.Errorf("the claim is %+v, want one that says the turn was interrupted", finished.Claim)
	}
}

func TestTheInteractiveRunClaimsThatItCanBeInterrupted(t *testing.T) {
	d := begin(t, recording{chunks: []string{"answered."}})

	d.say(t, "what is this project")
	d.closed(t, 1)

	opened := d.of(t, events.KindStarted)
	if len(opened) != 1 {
		t.Fatalf("the Trace holds %d opened Runs, want 1", len(opened))
	}
	started, ok := opened[0].Payload.(events.Started)
	if !ok {
		t.Fatalf("payload = %#v, want Started", opened[0].Payload)
	}
	if !started.Capabilities.Interrupt {
		t.Error("the interactive Run does not claim that it can be interrupted")
	}
}

// A turn nothing classified says only that nothing came back.
func TestATurnThatBrokeShowsTheClaimTheTraceHolds(t *testing.T) {
	// No recording at all, so the Provider refuses the call.
	d := begin(t)

	d.say(t, "what is this project")
	d.closed(t, 1)

	closed := d.of(t, events.KindFinished)
	finished, isFinished := closed[0].Payload.(events.Finished)
	if !isFinished {
		t.Fatalf("payload = %#v, want Finished", closed[0].Payload)
	}
	if finished.Claim.Result != events.ResultFailed {
		t.Errorf("result = %q, want %q", finished.Claim.Result, events.ResultFailed)
	}

	const said = "the script records 0 turn(s)"
	if !strings.Contains(finished.Claim.Summary, said) {
		t.Fatalf("the claim is %q, want it to carry what the Provider said", finished.Claim.Summary)
	}

	d.settle(t, func() bool { return strings.Contains(d.read(), "No response") })
	if shown := d.read(); strings.Contains(shown, said) {
		t.Errorf("the provider's own words are on screen:\n%s", shown)
	}

	// And the prompt is back. A console that ended on the first provider
	// failure would throw away a conversation over something the next prompt
	// might not hit.
	d.say(t, "try again")
	d.closed(t, 2)
}

func TestATurnThatBrokeNamesWhyWithoutQuotingTheProvider(t *testing.T) {
	// A credential the API rejected, in the shape a real one arrives in: the
	// class this Provider classified it as, and a message written for whoever
	// is debugging the provider.
	const said = "401 Unauthorized (Request-ID: req_011Cds): invalid x-api-key"
	d := begin(t, recording{refusal: &providers.Fault{
		Err:   fmt.Errorf("anthropic: %s: %s", events.ErrorAuthFailed, said),
		Class: events.ErrorAuthFailed,
	}})

	d.say(t, "what is this project")
	d.closed(t, 1)

	closed := d.of(t, events.KindFinished)
	finished, isFinished := closed[0].Payload.(events.Finished)
	if !isFinished {
		t.Fatalf("payload = %#v, want Finished", closed[0].Payload)
	}
	if finished.Claim.Result != events.ResultFailed {
		t.Errorf("result = %q, want %q", finished.Claim.Result, events.ResultFailed)
	}
	if finished.Claim.ErrorClass != events.ErrorAuthFailed {
		t.Errorf("class = %q, want %q", finished.Claim.ErrorClass, events.ErrorAuthFailed)
	}
	if !strings.Contains(finished.Claim.Summary, said) {
		t.Errorf("the claim is %q, want it to carry what the Provider said", finished.Claim.Summary)
	}

	d.settle(t, func() bool { return strings.Contains(d.read(), "the credential was refused") })
	if shown := d.read(); strings.Contains(shown, said) {
		t.Errorf("the provider's own words are on screen:\n%s", shown)
	}
	// The status line and the identifier are the two pieces most likely to
	// survive a careless rewording of the line above.
	for _, leaked := range []string{"401", "req_011Cds", "x-api-key"} {
		if strings.Contains(d.read(), leaked) {
			t.Errorf("%q is on screen:\n%s", leaked, d.read())
		}
	}
}

// The two projections describe one turn here too. What a person read as the
// cost of a turn is what the Usage record the Trace holds says it cost — and
// what they read as the answer is the Text record, not the chunks that arrived
// before one existed.
func TestWhatIsShownIsWhatTheTraceHolds(t *testing.T) {
	d := begin(t, recording{chunks: []string{"Eva is a ", "software factory."}})

	d.say(t, "what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "software factory.") })

	read := d.read()

	written := d.of(t, events.KindText)
	if len(written) != 1 {
		t.Fatalf("the Trace holds %d Text records, want the one the block folded to", len(written))
	}
	text, ok := written[0].Payload.(events.Text)
	if !ok {
		t.Fatalf("payload = %#v, want Text", written[0].Payload)
	}
	if !strings.Contains(read, text.Chunk) {
		t.Errorf("what was shown is not the Text the Trace holds:\nshown: %s\ntrace: %q", read, text.Chunk)
	}

	priced := d.of(t, events.KindUsage)
	if len(priced) != 1 {
		t.Fatalf("the Trace holds %d Usage records, want 1", len(priced))
	}
	usage, ok := priced[0].Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", priced[0].Payload)
	}
	// The figures are asked for rather than read off the turn: what a Session
	// has spent is on the footer now, and /cost is how a person asks for the
	// breakdown. It is the same fold either way, which is the point being made.
	said := d.answers(t, "/cost")
	for _, want := range []string{
		fmt.Sprintf("%d in", reported(t, usage.InputTokens)),
		fmt.Sprintf("%d out", reported(t, usage.OutputTokens)),
	} {
		if !strings.Contains(said, want) {
			t.Errorf("/cost does not report %q, which the Usage Event holds:\n%s", want, said)
		}
	}
}

func TestAPromptTypedDuringATurnIsAnsweredAfterIt(t *testing.T) {
	gate := make(chan struct{})
	d := begin(t,
		recording{chunks: []string{"the first answer."}, gate: gate},
		recording{chunks: []string{"the second answer."}},
	)

	d.say(t, "first question")
	d.settle(t, func() bool { return d.console.Busy() })

	// Typed without waiting, which is the case the queue exists for. say would
	// have waited for the turn, and waiting is what a person does not do.
	for _, r := range "second question" {
		d.program.Send(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	d.program.Send(tea.KeyPressMsg{Code: tea.KeyEnter})
	d.settle(t, func() bool { return d.console.Queued() == "second question" })

	// Nothing has been asked twice yet: the first turn is still open.
	if calls := d.provider.transcripts(); len(calls) != 1 {
		t.Fatalf("the Provider was called %d time(s) while the first turn was open, want 1", len(calls))
	}

	close(gate)
	d.closed(t, 2)

	calls := d.provider.transcripts()
	if len(calls) != 2 {
		t.Fatalf("the Provider was called %d time(s), want 2 — the queued prompt was dropped", len(calls))
	}

	after := conversation(t, calls[1])
	if len(after) == 0 || after[len(after)-1].Said() != "second question" {
		t.Fatalf("the second turn was conditioned on\n%+v\nwant the queued prompt last", after)
	}
	// And it was answered in the light of the turn it waited for.
	if len(after) < 3 || !strings.Contains(after[1].Said(), "the first answer") {
		t.Errorf("the queued turn does not carry the answer it waited for:\n%+v", after)
	}
}

// The Providers this build ships are selectable, because each put itself in the
// registry as it loaded. This layer names them as imports and knows nothing
// else about them.
func TestTheShippedProvidersAreSelectable(t *testing.T) {
	registered := map[string]bool{}
	for _, name := range providers.Names() {
		registered[name] = true
	}

	for _, want := range []string{"anthropic", "openai"} {
		if !registered[want] {
			t.Errorf("%q is not registered, so no configuration can select it", want)
		}
	}
}

// The console says where the provider's own account of a failure went, once per
// Session.

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
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/trace"
	"github.com/missingstudio/eva/internal/tui"
)

// These tests run the interface itself, in this process, with input disabled
// and output redirected. That is the point of them: an interface that needed a
// terminal to run would be an interface CI cannot test, and the one thing this
// stage promises about interruption cannot be observed from outside a process
// that is not driving the keys.
//
// What they assert on is what an outside reader could: the bytes a person
// would have read, the transcript the Provider was called with, and the
// records in the Trace. Nothing reaches into the model to ask what it thinks.

// driven is a Provider the test drives.
//
// It keeps the transcript each call was conditioned on, which is the only way
// to observe that a second prompt was answered in the light of the first: a
// Provider that replays a recording answers the same way either way.
type driven struct {
	mu     sync.Mutex
	script []recording
	turn   int
	calls  []providers.Call
}

// recording is one turn this Provider replays.
type recording struct {
	// chunks is the answer, split the way a stream would deliver it.
	chunks []string
	// degraded is what this turn's Provider could not tell Eva, and is empty
	// for a turn that was whole.
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

	return &drivenStream{rec: rec}
}

// transcripts is the transcript of every call so far.
func (d *driven) transcripts() [][]core.Message {
	d.mu.Lock()
	defer d.mu.Unlock()

	out := make([][]core.Message, len(d.calls))
	for i, call := range d.calls {
		out[i] = call.Messages
	}
	return out
}

// models is the model of every call so far.
func (d *driven) models() []string {
	d.mu.Lock()
	defer d.mu.Unlock()

	out := make([]string, len(d.calls))
	for i, call := range d.calls {
		out[i] = call.Model
	}
	return out
}

// conversation is what a call was conditioned on beyond the base system
// prompt, having first asserted that the prompt is what heads it.
//
// Every turn carries it, so a test about a transcript would otherwise restate
// a kilobyte of prose in order to say something about three messages. The
// assertion stays here rather than being skipped: it is what proves the
// frontend hands the prompt to every turn it opens.
func conversation(t *testing.T, call []core.Message) []core.Message {
	t.Helper()

	if len(call) == 0 || call[0].Author != core.AuthorSystem || call[0].Text != prompt.Base() {
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

// heard is a buffer two goroutines touch: the program renders into it and the
// test reads it.
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

// dialogue is one interactive Session under test.
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

// read is what the console has put in front of a person.
//
// It comes from the console rather than from the bytes it wrote. A console that
// draws a screen in place emits cursor moves and overwrites, so those bytes
// with their escapes stripped are the fragments of a transcript in the order
// the cursor visited them, not the transcript. See tui.Console.Screen.
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
	e := &eva{
		provider: provider,
		sink:     sink,
		session:  newTestSession(),
		model:    "test-model",
	}

	out := &heard{}
	program, c, err := tui.NewConsole(context.Background(), e, nil, out)
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
	//
	// Two things make this a loop rather than one call. A program takes
	// messages only once it is running, and nothing says when that is — so a
	// size sent too early is dropped. And with no terminal on the output, this
	// message is the only way the renderer learns how big the screen is: until
	// it has one it draws nothing at all, so there is no first key to wait for
	// either. Sending it until something is drawn settles both.
	// The prompt character is what says a frame has been drawn. It is looked
	// for in the bytes rather than through read, because read is the transcript
	// and a console that has drawn its first frame has an empty one — there is
	// nothing to keep until somebody says something.
	d.settle(t, func() bool {
		d.program.Send(tea.WindowSizeMsg{Width: 80, Height: 24})
		return strings.Contains(d.out.String(), "›")
	})

	t.Cleanup(func() { d.leave(t) })
	return d
}

// say types a prompt and sends it.
//
// It waits for the console to be idle first. A console answers one turn at a
// time and takes no keys while it is answering, so a key typed a moment too
// early is a key that is dropped — and a prompt missing its first character is
// a slash command that goes to the model instead. A person waits by reading the
// status line; this is the same wait.
func (d *dialogue) say(t *testing.T, prompt string) {
	t.Helper()
	d.settle(t, func() bool { return !d.console.Busy() })

	for _, r := range prompt {
		d.program.Send(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	d.program.Send(tea.KeyPressMsg{Code: tea.KeyEnter})
}

// interrupt is Ctrl-C.
func (d *dialogue) interrupt() {
	d.program.Send(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
}

// leave ends the Session and waits for the process to be done with it.
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

// closed waits until the Trace holds count Runs that have been closed.
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

// records is every Event the Trace holds, decoded.
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

// A prompt is answered, and the answer is shown.
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
	if first := conversation(t, calls[0]); len(first) != 1 || first[0].Text != "what is this project" {
		t.Fatalf("the first call was conditioned on %+v, want the first prompt alone", first)
	}

	want := []core.Message{
		{Author: core.AuthorUser, Text: "what is this project"},
		{Author: core.AuthorAssistant, Text: "Eva is a software factory."},
		{Author: core.AuthorUser, Text: "and what else"},
	}
	if second := conversation(t, calls[1]); fmt.Sprint(second) != fmt.Sprint(want) {
		t.Errorf("the second call was conditioned on\n%+v\nwant\n%+v", second, want)
	}
}

// Ctrl-C during a stream gives the prompt back, and the Session is a Session
// the next turn can still use.
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
		{Author: core.AuthorUser, Text: "answer at length"},
		{Author: core.AuthorAssistant, Text: "a long answer nobody wanted"},
		{Author: core.AuthorUser, Text: "shorter please"},
	}
	if after := conversation(t, calls[1]); fmt.Sprint(after) != fmt.Sprint(want) {
		t.Errorf("the turn after the interrupt was conditioned on\n%+v\nwant\n%+v", after, want)
	}
}

// A cancelled turn is a closed Run. The part of the answer that arrived is in
// the Trace, the claim that closes it is too, and every record parses.
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

// A Run driven from here can be cancelled cleanly, and says so.
//
// The claim is made by the frontend that does the listening rather than by the
// Turn, so it is a claim and not a constant: a frontend that let the process
// die under a Run would not make it. The console is the only frontend Eva has
// today, which is why this is the only place the claim is asserted.
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

// A turn that broke says so in the words the Trace holds.
//
// A turn that broke says so in one line, and the reason it broke is in the
// Trace.
//
// The provider's words used to go on screen. They are written for whoever is
// debugging the provider rather than for whoever asked the question, and a
// person who typed a prompt and got back a sentence about how many turns a
// recording holds has been handed the program's internals in place of an
// answer.
//
// So both halves are asserted here, and the second is the one that makes the
// first safe: the screen says only that nothing came back, and the claim the
// Trace holds still carries the provider's words verbatim. Losing the reason
// rather than moving it is what this test exists to catch.
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

	d.settle(t, func() bool { return strings.Contains(d.read(), "no response") })
	if shown := d.read(); strings.Contains(shown, said) {
		t.Errorf("the provider's own words are on screen:\n%s", shown)
	}

	// And the prompt is back. A console that ended on the first provider
	// failure would throw away a conversation over something the next prompt
	// might not hit.
	d.say(t, "try again")
	d.closed(t, 2)
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

// A prompt typed while a turn is running is answered when that turn closes.
//
// The keys used to be dropped, silently: a person watched the characters appear,
// pressed enter, and had nothing to show for either. What makes the queue worth
// the state it costs is the second assertion — the turn it opens is conditioned
// on the one it waited for, so waiting is the whole of what the queue does.
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
	if len(after) == 0 || after[len(after)-1].Text != "second question" {
		t.Fatalf("the second turn was conditioned on\n%+v\nwant the queued prompt last", after)
	}
	// And it was answered in the light of the turn it waited for.
	if len(after) < 3 || !strings.Contains(after[1].Text, "the first answer") {
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

// Every projection attached sees every committed Event.
//
// Attaching used to assign a slice of one, so a second projection silently
// replaced the first: no metrics tap beside a console, no second screen, and
// nothing anywhere to say the first had stopped being fed.
func TestEveryAttachedProjectionSeesEveryEvent(t *testing.T) {
	e := &eva{
		provider: &driven{script: []recording{{chunks: []string{"answered"}}}},
		sink:     &collecting{},
		session:  newTestSession(),
		model:    "test-model",
	}

	var first, second int
	e.Attach(core.SubscriberFunc(func(context.Context, events.Event) error { first++; return nil }))
	e.Attach(core.SubscriberFunc(func(context.Context, events.Event) error { second++; return nil }))

	if _, err := e.Answer(context.Background(), "say something"); err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	if first == 0 || second == 0 {
		t.Fatalf("projections saw %d and %d Events, want both fed", first, second)
	}
	if first != second {
		t.Errorf("projections saw %d and %d Events, want the same Trace", first, second)
	}
}

// A capability is claimed on purpose, and attaching a projection is not a claim.
func TestAttachingAProjectionClaimsNoCapability(t *testing.T) {
	e := &eva{}

	e.Attach(core.SubscriberFunc(func(context.Context, events.Event) error { return nil }))
	if e.interrupt {
		t.Error("attaching a projection claimed the Interrupt capability")
	}
	if e.arriving != nil {
		t.Error("attaching a projection said it watches a turn arrive")
	}

	e.Attach(nil, WithInterrupt())
	if !e.interrupt {
		t.Error("WithInterrupt did not claim the capability")
	}
}

// collecting is a sink that keeps what it was given, for a test that cares who
// was published to rather than what was written.
type collecting struct {
	mu   sync.Mutex
	next uint64
}

func (c *collecting) Append(_ context.Context, group []events.Event) ([]events.Event, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := make([]events.Event, len(group))
	for i, e := range group {
		c.next++
		e.Seq = c.next
		out[i] = e
	}
	return out, nil
}

func (c *collecting) Close() error { return nil }

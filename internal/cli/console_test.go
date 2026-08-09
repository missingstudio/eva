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

func (d *driven) Name() string { return "driven" }

func (d *driven) Stream(_ context.Context, call providers.Call) (providers.Stream, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.turn >= len(d.script) {
		return nil, fmt.Errorf("driven: the script records %d turn(s) and this is turn %d", len(d.script), d.turn+1)
	}
	rec := d.script[d.turn]
	d.turn++
	d.calls = append(d.calls, call)

	return &drivenStream{rec: rec}, nil
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
		return events.Usage{InputTokens: 10, OutputTokens: 20}, nil
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
	console  *console
	provider *driven
	out      *heard
	trace    string
	done     chan error
}

// escapes matches any terminal escape sequence, so that a test can assert on
// the words a person reads rather than on the bytes that place them.
var escapes = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][0-9A-B]|\x1b[=>]`)

func (d *dialogue) read() string { return escapes.ReplaceAllString(d.out.String(), "") }

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
	program, c, err := newConsole(context.Background(), e, nil, out)
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}

	d := &dialogue{program: program, console: c, provider: provider, out: out, trace: path, done: make(chan error, 1)}
	go func() {
		_, err := program.Run()
		d.done <- err
	}()
	// Nothing is sent to a program that has not started, so the first key
	// would block on a channel nobody is reading yet.
	d.settle(t, func() bool { return strings.Contains(d.read(), "eva") })

	// A window size, as a terminal would send one. Without it the program has
	// no room to draw the live area in, and the answer arriving would have
	// nowhere to arrive.
	d.program.Send(tea.WindowSizeMsg{Width: 80, Height: 24})

	t.Cleanup(func() { d.leave(t) })
	return d
}

// say types a prompt and sends it.
func (d *dialogue) say(prompt string) {
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
	d.console.running.Wait()
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

	d.say("what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "software factory.") })

	read := d.read()
	if !strings.Contains(read, "what is this project") {
		t.Errorf("the prompt was never shown back:\n%s", read)
	}
	if !strings.Contains(read, "turn ") || !strings.Contains(read, "session ") {
		t.Errorf("the turn reports no cost line:\n%s", read)
	}
}

// The answer is on screen while the turn is still running. A turn that only
// appeared when it was over would be a turn a person waits out in silence.
func TestAnAnswerStreamsAsItArrivesRatherThanAtTheEnd(t *testing.T) {
	gate := make(chan struct{})
	d := begin(t, recording{chunks: []string{"Eva is a ", "software factory."}, gate: gate})

	d.say("what is this project")
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

	d.say("what is this project")
	d.closed(t, 1)
	d.say("and what else")
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

	d.say("answer at length")
	d.settle(t, func() bool { return strings.Contains(d.read(), "a long answer nobody wanted") })

	d.interrupt()
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "interrupted") })

	// The prompt is back, and the next turn runs against a Session that holds
	// what did arrive.
	d.say("shorter please")
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

	d.say("answer at length")
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

	d.say("what is this project")
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
// The console reads the claim that closed the Run rather than working the
// reason out again from the error it was handed. The two are the same fact,
// and a console that classified it a second time could put a sentence on
// screen that no record supports — which is the one failure a person reading
// the screen has no way to detect.
func TestATurnThatBrokeShowsTheClaimTheTraceHolds(t *testing.T) {
	// No recording at all, so the Provider refuses the call.
	d := begin(t)

	d.say("what is this project")
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
	d.settle(t, func() bool { return strings.Contains(d.read(), said) })

	// And the prompt is back. A console that ended on the first provider
	// failure would throw away a conversation over something the next prompt
	// might not hit.
	d.say("try again")
	d.closed(t, 2)
}

// The two projections describe one turn here too. What a person read as the
// cost of a turn is what the Usage record the Trace holds says it cost — and
// what they read as the answer is the Text record, not the chunks that arrived
// before one existed.
func TestWhatIsShownIsWhatTheTraceHolds(t *testing.T) {
	d := begin(t, recording{chunks: []string{"Eva is a ", "software factory."}})

	d.say("what is this project")
	d.closed(t, 1)
	d.settle(t, func() bool { return strings.Contains(d.read(), "turn ") })

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
	for _, want := range []string{
		fmt.Sprintf("%d in", usage.InputTokens),
		fmt.Sprintf("%d out", usage.OutputTokens),
	} {
		if !strings.Contains(read, want) {
			t.Errorf("the cost line does not report %q, which the Usage Event holds:\n%s", want, read)
		}
	}
}

// The live area is a window on a stream, and it shows the end of it. An answer
// longer than the window would otherwise push the view past the screen while
// it arrives — and the whole of it goes above the view when the Run closes,
// rendered, which is what a person actually reads it as.
func TestTheLiveAreaShowsTheEndOfWhatHasArrived(t *testing.T) {
	lines := func(n int) string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("line %d", i)
		}
		return strings.Join(out, "\n")
	}

	for _, c := range []struct {
		name    string
		height  int
		arrived string
		want    string
	}{
		{
			name:    "an answer that fits is shown whole",
			height:  24,
			arrived: lines(3),
			want:    lines(3),
		},
		{
			name:    "a window that has said how tall it is keeps room for the rest of the view",
			height:  6,
			arrived: lines(20),
			want:    "line 16\nline 17\nline 18\nline 19",
		},
		{
			name:    "a window that has not said keeps to a length a screen will hold",
			height:  0,
			arrived: lines(20),
			want:    "line 10\nline 11\nline 12\nline 13\nline 14\nline 15\nline 16\nline 17\nline 18\nline 19",
		},
		{
			name:    "a window with no room at all still shows the last line",
			height:  1,
			arrived: lines(20),
			want:    "line 19",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := (&console{height: c.height}).tail(c.arrived)
			if got != c.want {
				t.Errorf("tail = %q, want %q", got, c.want)
			}
		})
	}
}

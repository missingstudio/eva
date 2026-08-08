package cli_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/missingstudio/eva/events"
)

// These tests observe only what something outside the program can observe: the
// Events on stdout, the bytes in the Trace file, and the exit code. They start
// the real binary as a separate process, because two of the requirements this
// stage is heading towards are about interruption, and a test can only
// interrupt a process it started.
//
// Nothing here reaches into a struct, and nothing asserts on the order in
// which functions were called. A test that would fail after a refactor that
// changed no behaviour is testing the wrong thing.

// binary is the eva under test, built once for the package.
var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "eva-seam-a")
	if err != nil {
		fmt.Fprintf(os.Stderr, "make a build directory: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = os.RemoveAll(dir) }()

	binary = filepath.Join(dir, "eva")
	build := exec.Command("go", "build", "-o", binary, "./cmd/eva")
	if out, err := build.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "build eva: %v\n%s", err, out)
		os.Exit(1)
	}

	os.Exit(m.Run())
}

type result struct {
	code   int
	stdout string
	stderr string
}

// world is one run's configuration file, Trace, and environment.
type world struct {
	dir    string
	config string
	trace  string
	env    []string
}

// provider is what a world's [provider] table says, with the model and the
// credential that belong beside it.
//
// It is the only thing that differs between the runs in this package. Where
// the Trace goes, who the actor is, and that no developer's home directory is
// in reach are the same whether a turn is answered from a recording or from an
// API — so they are written once, below, and a test names only the part that
// is about it.
type provider struct {
	model string
	table string
	// key is what reaches the process as $ANTHROPIC_API_KEY. It is empty for a
	// run that must not need one.
	key string
}

// fake answers from a recording on disk: no network, and no credential.
func fake(script string) provider {
	return provider{
		model: "test-model",
		table: fmt.Sprintf("[provider]\nname = \"fake\"\nscript = %q\n", script),
	}
}

// live answers from an API at base.
func live(base string) provider {
	return provider{
		model: "claude-test",
		table: fmt.Sprintf("[provider]\nname = \"anthropic\"\nbase_url = %q\n", base),
		key:   "sk-ant-test",
	}
}

// unnamed answers from an API at base with no provider named, so that whatever
// configuration defaults to is what runs.
func unnamed(base string) provider {
	return provider{
		model: "claude-test",
		table: fmt.Sprintf("[provider]\nbase_url = %q\n", base),
		key:   "sk-ant-test",
	}
}

// plus is this provider with one more line in its table.
func (p provider) plus(line string) provider {
	p.table += line + "\n"
	return p
}

// checkedIn is the recording this package answers from when a test does not
// generate one of its own.
func checkedIn(t *testing.T) string {
	t.Helper()

	script, err := filepath.Abs(filepath.Join("testdata", "script.toml"))
	if err != nil {
		t.Fatalf("locate the recording: %v", err)
	}
	return script
}

// newWorld writes a configuration and puts the Trace somewhere this test owns.
func newWorld(t *testing.T, p provider) *world {
	t.Helper()

	dir := t.TempDir()
	w := &world{
		dir:    dir,
		config: filepath.Join(dir, "config.toml"),
		trace:  filepath.Join(dir, "traces", "eva.jsonl"),
	}
	// The provider table comes last so that a test can add a line to it.
	body := fmt.Sprintf(""+
		"model = %q\n\n"+
		"[trace]\n"+
		"path = %q\n\n"+
		"[identity]\n"+
		"tenant = \"tenant_test\"\n"+
		"actor = \"seam-a\"\n"+
		"actor_kind = \"agent\"\n\n"+
		"%s",
		p.model, w.trace, p.table)
	if err := os.WriteFile(w.config, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// No home directory of the developer's, and a credential only where the run
	// is meant to have one: a test must need neither network access nor a key
	// unless it is the thing being tested.
	w.env = append(os.Environ(),
		"EVA_HOME="+filepath.Join(dir, "home"),
		"EVA_CONFIG="+w.config,
		"ANTHROPIC_API_KEY="+p.key,
	)
	return w
}

func (w *world) run(t *testing.T, args ...string) result {
	t.Helper()

	var stdout, stderr bytes.Buffer
	cmd := exec.Command(binary, args...)
	cmd.Env = w.env
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// A non-zero exit is a result to assert on, not a failure to run. Anything
	// else means the binary never started, and no assertion after this would
	// mean what it says.
	var exit *exec.ExitError
	if err := cmd.Run(); err != nil && !errors.As(err, &exit) {
		t.Fatalf("start eva: %v", err)
	}
	return result{code: cmd.ProcessState.ExitCode(), stdout: stdout.String(), stderr: stderr.String()}
}

// answer runs the one-shot machine-readable turn.
func (w *world) answer(t *testing.T, prompt string) result {
	t.Helper()
	got := w.run(t, "-p", prompt, "--json")
	if got.code != 0 {
		t.Fatalf("exit %d, want 0\nstderr: %s", got.code, got.stderr)
	}
	return got
}

// render runs the one-shot turn as a person sees it.
func (w *world) render(t *testing.T, prompt string) result {
	t.Helper()
	got := w.run(t, "-p", prompt)
	if got.code != 0 {
		t.Fatalf("exit %d, want 0\nstderr: %s", got.code, got.stderr)
	}
	return got
}

// escape matches an ANSI style sequence, so that a test can assert on the words
// a person reads rather than on the bytes that colour them.
var escape = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func plain(s string) string { return escape.ReplaceAllString(s, "") }

// recorded is the answer the checked-in recording replays, folded.
const recorded = "Eva is an autonomous, multi-tenant, AI-native software factory."

// costLine picks the cost line out of rendered output. It is the line that
// reports both figures, so that a line of the answer beginning with the same
// word cannot be mistaken for it.
func costLine(t *testing.T, out string) string {
	t.Helper()

	for _, line := range strings.Split(plain(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "turn ") && strings.Contains(line, "session ") {
			return line
		}
	}
	t.Fatalf("the output holds no cost line:\n%s", out)
	return ""
}

// figure is a token count as the cost line writes it. The rounding rule is
// stated here rather than borrowed from the renderer, so that a test comparing
// the two projections is comparing them rather than agreeing with one of them.
func figure(n uint64) string {
	if n < 1000 {
		return strconv.FormatUint(n, 10)
	}
	return strconv.FormatFloat(float64(n)/1000, 'f', 1, 64) + "k"
}

func decodeStream(t *testing.T, s string) []events.Event {
	t.Helper()
	var out []events.Event
	scan := bufio.NewScanner(strings.NewReader(s))
	for scan.Scan() {
		if len(bytes.TrimSpace(scan.Bytes())) == 0 {
			continue
		}
		var e events.Event
		if err := json.Unmarshal(scan.Bytes(), &e); err != nil {
			t.Fatalf("line %d is not an Event: %v\n%s", len(out)+1, err, scan.Bytes())
		}
		out = append(out, e)
	}
	if err := scan.Err(); err != nil {
		t.Fatalf("read the stream: %v", err)
	}
	return out
}

func kinds(es []events.Event) []events.Kind {
	out := make([]events.Kind, len(es))
	for i, e := range es {
		out[i] = e.Kind
	}
	return out
}

func TestHelpPrintsTheUsageBlock(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))

	got := w.run(t, "help")
	if got.code != 0 {
		t.Fatalf("exit %d, want 0\nstderr: %s", got.code, got.stderr)
	}
	for _, want := range []string{"USAGE:", "eva -p <prompt> --json", "eva help", "--config"} {
		if !strings.Contains(got.stdout, want) {
			t.Errorf("the usage block does not mention %q:\n%s", want, got.stdout)
		}
	}
}

// The recording delivers the answer in three chunks of one content block, and
// the sink folds them into one record at commit. A Trace record is a unit of
// meaning, so three chunks are one Text.
func TestAPlainTurnEmitsStartedTextUsageAndFinished(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))

	got := decodeStream(t, w.answer(t, "what is this project").stdout)

	want := []events.Kind{
		events.KindStarted,
		events.KindText,
		events.KindUsage,
		events.KindFinished,
	}
	if fmt.Sprint(kinds(got)) != fmt.Sprint(want) {
		t.Fatalf("kinds = %v, want %v", kinds(got), want)
	}

	text, ok := got[1].Payload.(events.Text)
	if !ok {
		t.Fatalf("payload = %#v, want Text", got[1].Payload)
	}
	if want := "Eva is an autonomous, multi-tenant, AI-native software factory."; text.Chunk != want {
		t.Errorf("the folded answer is %q, want %q", text.Chunk, want)
	}

	usage, ok := got[2].Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", got[2].Payload)
	}
	if usage.InputTokens != 1200 || usage.OutputTokens != 340 {
		t.Errorf("usage = %+v, want the recorded figures", usage)
	}
	if usage.CacheWriteTokens == 0 || usage.CacheReadTokens == 0 {
		t.Errorf("cache writes and reads = %d, %d — both should be non-zero on a cached turn",
			usage.CacheWriteTokens, usage.CacheReadTokens)
	}
	if usage.ReasoningTokens != nil {
		t.Errorf("ReasoningTokens = %d, want absent rather than zero", *usage.ReasoningTokens)
	}
	if usage.USD != nil {
		t.Errorf("USD = %v, want absent — it is never an estimate", *usage.USD)
	}

	finished, ok := got[3].Payload.(events.Finished)
	if !ok {
		t.Fatalf("payload = %#v, want Finished", got[3].Payload)
	}
	if finished.Claim.Result != events.ResultDone {
		t.Errorf("claim = %+v, want done", finished.Claim)
	}
}

// A signal to the one-shot command kills the process where it stands, which is
// not a clean cancel however it looks from outside. So this Run does not claim
// that it can be interrupted — a capability that is missing degrades a Run, and
// one that is claimed and absent corrupts it. The Run that does claim it is the
// interactive one, asserted in console_test.go.
func TestTheOneShotRunDoesNotClaimThatItCanBeInterrupted(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	got := decodeStream(t, w.answer(t, "what is this project").stdout)

	started, ok := got[0].Payload.(events.Started)
	if !ok {
		t.Fatalf("payload = %#v, want Started", got[0].Payload)
	}
	if started.Capabilities.Interrupt {
		t.Error("a Run nothing is listening for a cancellation on claims it can be interrupted")
	}
	// The capabilities that are real at this stage are still claimed, so this
	// is one capability reported honestly rather than a Run claiming nothing.
	if !started.Capabilities.StructuredEvents || !started.Capabilities.CostReport {
		t.Errorf("capabilities = %+v, want the two this stage does have", started.Capabilities)
	}
}

// The Trace is the single source of truth, so the prompt has to be in it.
// Without this the transcript's first message exists only in the process that
// answered it, and resume has nothing to resume from.
func TestThePromptReachesTheTrace(t *testing.T) {
	const prompt = "what is this project"

	w := newWorld(t, fake(checkedIn(t)))
	got := decodeStream(t, w.answer(t, prompt).stdout)

	started, ok := got[0].Payload.(events.Started)
	if !ok {
		t.Fatalf("payload = %#v, want Started", got[0].Payload)
	}
	if started.Intent != prompt {
		t.Errorf("intent = %q, want %q", started.Intent, prompt)
	}

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	if !bytes.Contains(body, []byte(prompt)) {
		t.Error("the Trace does not hold the prompt it answered")
	}
}

func TestEveryEventCarriesTheWholeEnvelope(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	out := w.answer(t, "what is this project").stdout

	scan := bufio.NewScanner(strings.NewReader(out))
	for line := 1; scan.Scan(); line++ {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(scan.Bytes(), &raw); err != nil {
			t.Fatalf("line %d: %v", line, err)
		}
		for _, key := range []string{
			"id", "seq", "wire_seq", "at", "version", "kind",
			"tenant", "actor", "run", "session", "parent",
		} {
			if _, ok := raw[key]; !ok {
				t.Fatalf("line %d carries no %q:\n%s", line, key, scan.Bytes())
			}
		}
	}

	for i, e := range decodeStream(t, out) {
		switch {
		case e.ID == "":
			t.Errorf("event %d has no id", i)
		case e.Version != events.SchemaVersion:
			t.Errorf("event %d version = %d, want %d", i, e.Version, events.SchemaVersion)
		case e.Tenant != "tenant_test":
			t.Errorf("event %d tenant = %q", i, e.Tenant)
		case e.Actor.ID != "seam-a" || e.Actor.Kind != events.ActorAgent:
			t.Errorf("event %d actor = %+v", i, e.Actor)
		case e.Run == "":
			t.Errorf("event %d has no run", i)
		case e.Session == "":
			t.Errorf("event %d has no session", i)
		case e.At.Wall.IsZero():
			t.Errorf("event %d has no wall clock reading", i)
		case e.Parent != nil:
			t.Errorf("event %d parent = %v, want nil on the main conversation", i, *e.Parent)
		}
	}
}

// The Trace position is the sink's, assigned at commit. The wire position is
// the producer's. They are two sequences, and now that the sink coalesces they
// diverge in a plain run: six payloads go out on the wire and four records
// reach the Trace, so the Trace sequence stays dense while the wire sequence
// skips the chunks the fold absorbed.
func TestTracePositionIsDenseAndIsNotTheWirePosition(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	got := decodeStream(t, w.answer(t, "what is this project").stdout)

	var skipped bool
	for i, e := range got {
		if want := uint64(i + 1); e.Seq != want {
			t.Errorf("event %d Seq = %d, want %d — the Trace sequence has a gap", i, e.Seq, want)
		}
		if e.Seq == e.WireSeq {
			t.Errorf("event %d has one number where the schema has two", i)
		}
		if i > 0 && e.WireSeq != got[i-1].WireSeq+1 {
			skipped = true
		}
	}
	if !skipped {
		t.Error("the wire sequence never skips — the fold absorbed no chunks")
	}
}

func TestTheOutputPathRendersNothing(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	got := w.answer(t, "what is this project")

	if strings.ContainsRune(got.stdout, 0x1b) {
		t.Errorf("stdout carries a terminal escape:\n%q", got.stdout)
	}
	if got.stderr != "" {
		t.Errorf("stderr = %q, want nothing on a turn that worked", got.stderr)
	}
	// Every line is an Event and there is nothing else. A cost line here would
	// mean the renderer had been built on the path a script parses.
	for i, line := range strings.Split(strings.TrimSuffix(got.stdout, "\n"), "\n") {
		if strings.HasPrefix(line, "turn ") {
			t.Fatalf("line %d of the machine-readable stream is a cost line:\n%s", i+1, line)
		}
	}
}

// The turn a person sees: the answer as styled markdown, and what it cost.
func TestARenderedTurnShowsTheAnswerAndWhatItCost(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	got := w.render(t, "what is this project")

	if !strings.Contains(plain(got.stdout), recorded) {
		t.Errorf("the rendered turn does not hold the answer:\n%s", got.stdout)
	}
	if got.stderr != "" {
		t.Errorf("stderr = %q, want nothing on a turn that worked", got.stderr)
	}

	// The recorded figures, per turn and cumulative, with cache writes and
	// cache reads apart and no dollar figure the provider never reported.
	line := costLine(t, got.stdout)
	turn, session, found := strings.Cut(line, "session")
	if !found {
		t.Fatalf("the cost line reports no cumulative spend: %s", line)
	}
	for _, want := range []string{"1.2k in", "340 out", "96 write", "1.0k read", "cost unreported"} {
		if !strings.Contains(turn, want) {
			t.Errorf("the turn does not report %q: %s", want, turn)
		}
	}
	for _, want := range []string{"1.2k in", "340 out", "cost unreported"} {
		if !strings.Contains(session, want) {
			t.Errorf("the Session does not report %q: %s", want, session)
		}
	}
	if strings.Contains(line, "$") {
		t.Errorf("the cost line shows a dollar figure the recording never reported: %s", line)
	}
}

// The two output modes are two projections of one Trace, so they describe one
// turn. A script that parses --json and a person reading the rendered turn
// cannot be shown different answers or different figures.
func TestTheRenderedTurnAndTheMachineReadableTurnDescribeTheSameTurn(t *testing.T) {
	const prompt = "what is this project"

	// One world, two runs: the recording holds one turn and a fresh process
	// replays it from the start, so both runs answer the same turn.
	w := newWorld(t, fake(checkedIn(t)))
	rendered := w.render(t, prompt)
	printed := decodeStream(t, w.answer(t, prompt).stdout)

	if len(printed) != 4 {
		t.Fatalf("the machine-readable turn is %d records of kinds %v, want the four of a plain turn",
			len(printed), kinds(printed))
	}

	text, ok := printed[1].Payload.(events.Text)
	if !ok {
		t.Fatalf("payload = %#v, want Text", printed[1].Payload)
	}
	if !strings.Contains(plain(rendered.stdout), text.Chunk) {
		t.Errorf("the rendered answer is not the Text the Trace holds:\nrendered: %s\ntrace: %q",
			plain(rendered.stdout), text.Chunk)
	}

	usage, ok := printed[2].Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", printed[2].Payload)
	}
	// Every figure the Usage Event carries, and not a subset of them: a cost
	// line that reported three of four would still describe a different turn
	// from the one on stdout.
	line := costLine(t, rendered.stdout)
	for _, want := range []string{
		figure(usage.InputTokens) + " in",
		figure(usage.OutputTokens) + " out",
		figure(usage.CacheWriteTokens) + " write",
		figure(usage.CacheReadTokens) + " read",
	} {
		if !strings.Contains(line, want) {
			t.Errorf("the cost line does not report %q, which the Usage Event holds: %s", want, line)
		}
	}
	if usage.USD != nil {
		t.Fatal("the recording reports a dollar figure, and the assertion below assumes it does not")
	}
	if !strings.Contains(line, "cost unreported") {
		t.Errorf("the Usage Event carries no dollar figure and the cost line does not say so: %s", line)
	}
}

// Colour is adapted to what the terminal can show rather than emitted as
// written. A 16-colour terminal is sent 16 colours, a 256-colour terminal is
// sent 256, and something that is not a terminal is sent none.
func TestColourIsAdaptedToTheTerminalRatherThanEmittedRaw(t *testing.T) {
	const (
		indexed   = "38;5;"
		trueColor = "38;2;"
	)

	for _, c := range []struct {
		name     string
		env      []string
		styled   bool
		rejected []string
	}{
		{
			name:     "a terminal of sixteen colours",
			env:      []string{"TERM=xterm", "CLICOLOR_FORCE=1"},
			styled:   true,
			rejected: []string{indexed, trueColor},
		},
		{
			name:     "a terminal of 256 colours",
			env:      []string{"TERM=xterm-256color", "CLICOLOR_FORCE=1"},
			styled:   true,
			rejected: []string{trueColor},
		},
		{
			name:   "no terminal at all",
			env:    nil,
			styled: false,
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			w := newWorld(t, fake(checkedIn(t)))
			w.env = append(w.env, c.env...)
			got := w.render(t, "what is this project")

			if styled := strings.ContainsRune(got.stdout, 0x1b); styled != c.styled {
				t.Fatalf("styled = %v, want %v:\n%q", styled, c.styled, got.stdout)
			}
			for _, rejected := range c.rejected {
				if strings.Contains(got.stdout, rejected) {
					t.Errorf("the output carries a %q colour this terminal cannot show:\n%q", rejected, got.stdout)
				}
			}
			// Whatever the colour, the words are the same words.
			if !strings.Contains(plain(got.stdout), recorded) {
				t.Errorf("the answer did not survive the colour adaptation:\n%q", got.stdout)
			}
		})
	}
}

func TestTheTurnIsAppendedToATraceThatParses(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	printed := decodeStream(t, w.answer(t, "what is this project").stdout)

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	stored := decodeStream(t, string(body))

	if len(stored) != len(printed) {
		t.Fatalf("the Trace holds %d records and stdout printed %d", len(stored), len(printed))
	}
	for i := range stored {
		if stored[i].ID != printed[i].ID || stored[i].Seq != printed[i].Seq || stored[i].Kind != printed[i].Kind {
			t.Errorf("record %d: Trace has %+v, stdout printed %+v", i, stored[i], printed[i])
		}
	}
	if !bytes.HasSuffix(body, []byte("\n")) {
		t.Error("the Trace does not end on a record boundary")
	}
}

// A second turn appends rather than replacing, so the Trace is a record the
// developer did not have to ask for.
func TestASecondRunAppendsToTheSameTrace(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	first := decodeStream(t, w.answer(t, "one").stdout)

	// The recording holds one turn, so the second run reports that it has run
	// out of script. What matters here is that the Trace of the first run is
	// still whole afterwards.
	w.run(t, "-p", "two", "--json")

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	stored := decodeStream(t, string(body))
	if len(stored) < len(first) {
		t.Fatalf("the Trace holds %d records, want at least the %d of the first run", len(stored), len(first))
	}
	for i := range first {
		if stored[i].ID != first[i].ID {
			t.Errorf("record %d was overwritten: %+v", i, stored[i])
		}
	}
}

// longRecording writes a turn of blocks, each split into chunks, and returns
// the recording's path with the text one block folds to.
//
// It is generated rather than checked in. A recording of thousands of chunks
// is a large file that records nothing real except its shape, and the shape is
// the only part these two tests read.
func longRecording(t *testing.T, blocks, chunks int) (path, folded string) {
	t.Helper()

	// Every block is the same chunks, so what one folds to is what all of them
	// fold to.
	var block strings.Builder
	for c := range chunks {
		fmt.Fprintf(&block, "chunk %d. ", c)
	}

	var body strings.Builder
	body.WriteString("# Generated by the test that needs it: a turn long enough to be\n")
	body.WriteString("# interrupted, and chunky enough to show what the fold is worth.\n\n")
	body.WriteString("[[turn]]\n")
	for range blocks {
		body.WriteString("\n  [[turn.block]]\n  chunks = [\n")
		for c := range chunks {
			fmt.Fprintf(&body, "    %s,\n", strconv.Quote(fmt.Sprintf("chunk %d. ", c)))
		}
		body.WriteString("  ]\n")
	}
	body.WriteString("\n  [turn.usage]\n  input_tokens = 10\n  output_tokens = 20\n")

	path = filepath.Join(t.TempDir(), "long.toml")
	if err := os.WriteFile(path, []byte(body.String()), 0o600); err != nil {
		t.Fatalf("write the recording: %v", err)
	}
	return path, block.String()
}

// The Trace stays proportionate to meaning rather than to tokens: thousands of
// chunks reach it as one record per content block. A Trace that kept every
// chunk would make a 50k-token turn 50k records, and replay, projection, and
// per-tenant encryption would pay that multiple forever.
func TestAChunkHeavyRunProducesOneRecordPerBlock(t *testing.T) {
	const (
		blocks = 4
		chunks = 1500
	)

	script, folded := longRecording(t, blocks, chunks)
	w := newWorld(t, fake(script))
	printed := decodeStream(t, w.answer(t, "answer at length").stdout)

	want := []events.Kind{events.KindStarted}
	for range blocks {
		want = append(want, events.KindText)
	}
	want = append(want, events.KindUsage, events.KindFinished)
	if fmt.Sprint(kinds(printed)) != fmt.Sprint(want) {
		t.Fatalf("the run produced %d records of kinds %v, want %d of %v",
			len(printed), kinds(printed), len(want), want)
	}

	// The chunks really were thousands. The wire position counts what was sent,
	// so it is what says the fold had something to fold.
	if last := printed[len(printed)-1]; last.WireSeq < uint64(blocks*chunks) {
		t.Fatalf("the last record has wire position %d, want at least the %d chunks that were streamed",
			last.WireSeq, blocks*chunks)
	}

	// Folding is not dropping: every chunk of a block is in the record it
	// became.
	for i, e := range printed[1 : 1+blocks] {
		text, ok := e.Payload.(events.Text)
		if !ok {
			t.Fatalf("record %d = %#v, want Text", i+1, e.Payload)
		}
		if text.Chunk != folded {
			t.Errorf("block %d folded to %d bytes, want the %d bytes of its chunks",
				i, len(text.Chunk), len(folded))
		}
	}

	// Dense and gapless per Session, over what the Trace holds rather than over
	// what was sent.
	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	stored := decodeStream(t, string(body))
	if len(stored) != len(printed) {
		t.Fatalf("the Trace holds %d records and stdout printed %d", len(stored), len(printed))
	}
	next := map[events.SessionID]uint64{}
	for i, e := range stored {
		next[e.Session]++
		if e.Seq != next[e.Session] {
			t.Fatalf("record %d of session %s has Seq %d, want %d — the sequence has a gap",
				i, e.Session, e.Seq, next[e.Session])
		}
	}
}

// kill -9 in mid-stream. What is in the Trace at that moment is what the Trace
// keeps: a killed process cannot flush, cannot close, and cannot run a deferred
// anything.
//
// Nothing here waits for the right moment to kill. The test reads a few records
// and then stops reading, so the run fills the pipe it prints to and blocks
// there. It is provably mid-stream when the signal lands, rather than probably.
//
// Every group this stage commits is one record once the chunks of a block have
// folded, so a torn group and a torn record are the same observation here. The
// multi-record group is killed in trace/sink_test.go, where a group can be
// constructed with the tool results stage 0 has no way to produce.
func TestAKilledRunLeavesATraceThatParsesCompletely(t *testing.T) {
	const blocks = 2000

	script, _ := longRecording(t, blocks, 3)
	w := newWorld(t, fake(script))

	cmd := exec.Command(binary, "-p", "answer at length", "--json")
	cmd.Env = w.env
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("open eva's output: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start eva: %v", err)
	}

	const read = 20
	reader := bufio.NewReader(stdout)
	for i := range read {
		if _, err := reader.ReadString('\n'); err != nil {
			t.Fatalf("record %d never arrived: %v\nstderr: %s", i+1, err, stderr.String())
		}
	}

	if err := cmd.Process.Kill(); err != nil {
		t.Fatalf("kill eva: %v", err)
	}
	// A signal, not an exit: a run that ended on its own closed the Trace, and
	// this test would be measuring an orderly shutdown. Go reports -1 for a
	// process a signal ended.
	var exit *exec.ExitError
	if err := cmd.Wait(); !errors.As(err, &exit) || exit.ExitCode() != -1 {
		t.Fatalf("eva ended with %v, want a signal — it was never killed mid-stream", err)
	}

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	// A record is a line. A file that does not end on a line boundary ends in
	// half a record, whatever a parser makes of the rest.
	if len(body) == 0 || body[len(body)-1] != '\n' {
		t.Fatal("the Trace does not end on a record boundary")
	}

	// Parses completely: every line, not merely the ones before the last.
	stored := decodeStream(t, string(body))
	if len(stored) < read {
		t.Fatalf("the Trace holds %d records, want at least the %d that were printed", len(stored), read)
	}
	if len(stored) >= blocks {
		t.Fatalf("the Trace holds %d records of a %d block turn — the run was not interrupted",
			len(stored), blocks)
	}

	for i, e := range stored {
		if e.Seq != uint64(i+1) {
			t.Fatalf("record %d has Seq %d, want %d — the sequence has a gap", i, e.Seq, i+1)
		}
		switch {
		case e.ID == "" || e.Kind == "" || e.Session == "" || e.Run == "":
			t.Fatalf("record %d is missing part of its envelope: %+v", i, e)
		case e.Version != events.SchemaVersion:
			t.Fatalf("record %d has version %d, want %d", i, e.Version, events.SchemaVersion)
		case e.Payload == nil:
			t.Fatalf("record %d carries no payload", i)
		case e.Kind == events.KindFinished:
			t.Fatalf("record %d claims the Run finished, and it was killed", i)
		}
	}
}

// A typo must not quietly disable the thing the user meant to set.
func TestAnUnknownConfigKeyExitsNonZeroNamingTheKey(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)).plus(`nmae = "anthropic"`))

	got := w.run(t, "-p", "hello", "--json")
	if got.code == 0 {
		t.Fatalf("exit 0 on an unknown key, want non-zero\nstdout: %s", got.stdout)
	}
	if !strings.Contains(got.stderr, "provider.nmae") {
		t.Errorf("stderr does not name the key:\n%s", got.stderr)
	}
	if !strings.Contains(got.stderr, w.config) {
		t.Errorf("stderr does not name the file:\n%s", got.stderr)
	}
	if got.stdout != "" {
		t.Errorf("stdout = %q, want nothing", got.stdout)
	}
}

func TestAMissingAPIKeyExitsNonZeroSayingHowToSetOne(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := fmt.Sprintf("[provider]\nname = \"anthropic\"\n\n[trace]\npath = %q\n",
		filepath.Join(dir, "eva.jsonl"))
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	w := &world{
		dir:    dir,
		config: path,
		env: append(os.Environ(),
			"EVA_HOME="+filepath.Join(dir, "home"),
			"EVA_CONFIG="+path,
			"ANTHROPIC_API_KEY=",
		),
	}

	got := w.run(t, "-p", "hello", "--json")
	if got.code == 0 {
		t.Fatal("exit 0 with no API key, want non-zero")
	}
	if !strings.Contains(got.stderr, "ANTHROPIC_API_KEY") {
		t.Errorf("stderr does not say which variable to set:\n%s", got.stderr)
	}
	if !strings.Contains(got.stderr, "api_key_env") {
		t.Errorf("stderr does not say how to name a different variable:\n%s", got.stderr)
	}
}

// A Trace is something a developer can share. A credential in one would make
// that untrue.
//
// The credential is resolved on every run, whatever provider is selected, so
// this canary is in a room the key does enter: the run below loads it into the
// configuration and then answers from a recording.
func TestTheAPIKeyNeverReachesTheTraceOrTheStream(t *testing.T) {
	const key = "sk-ant-canary-do-not-store-me"

	w := newWorld(t, fake(checkedIn(t)))
	w.env = append(w.env, "ANTHROPIC_API_KEY="+key)

	got := w.answer(t, "what is this project")
	if strings.Contains(got.stdout, key) || strings.Contains(got.stderr, key) {
		t.Error("the credential reached the output stream")
	}

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	if bytes.Contains(body, []byte(key)) {
		t.Error("the credential reached the Trace")
	}
}

// Configuration is a file, and the flag says which one. The environment names
// a default; the flag overrides it.
func TestTheConfigFlagChoosesTheFile(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))
	w.env = append(w.env, "EVA_CONFIG="+filepath.Join(w.dir, "there-is-no-such-file.toml"))

	got := w.run(t, "-p", "hello", "--json", "--config", w.config)
	if got.code != 0 {
		t.Fatalf("exit %d, want 0 — the flag did not win\nstderr: %s", got.code, got.stderr)
	}
	if len(decodeStream(t, got.stdout)) == 0 {
		t.Error("the turn produced no Events")
	}
}

// eva with no arguments is the console.
//
// It is driven here the way a terminal drives it, with keys on the input
// stream, and what it left behind is read from the Trace rather than from
// stdout: what a person saw was a screen redrawn in place, and the record is
// not. The interface itself is exercised in chat_test.go, in this process,
// where the keys and the Events can be told apart.
func TestNoArgumentsOpensAnInteractiveChat(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))

	cmd := exec.Command(binary)
	cmd.Env = w.env
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	keys, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("open eva's input: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start eva: %v", err)
	}

	if _, err := keys.Write([]byte("what is this project\r")); err != nil {
		t.Fatalf("type a prompt: %v", err)
	}

	// The turn happens beside this test, so the Trace is what says it is over.
	deadline := time.Now().Add(10 * time.Second)
	var stored []events.Event
	for time.Now().Before(deadline) {
		if body, err := os.ReadFile(w.trace); err == nil && bytes.Contains(body, []byte(`"kind":"finished"`)) {
			stored = decodeStream(t, string(body))
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(stored) == 0 {
		t.Fatalf("no turn was answered in 10s\nstderr: %s", stderr.String())
	}

	// No more keys. A chat whose input has ended has nothing left to read.
	if err := keys.Close(); err != nil {
		t.Fatalf("close eva's input: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("eva ended with %v\nstderr: %s", err, stderr.String())
		}
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("eva did not leave when its input ended")
	}

	var opened, answered bool
	for _, e := range stored {
		if started, ok := e.Payload.(events.Started); ok && started.Intent == "what is this project" {
			opened = true
		}
		if text, ok := e.Payload.(events.Text); ok && strings.Contains(text.Chunk, recorded) {
			answered = true
		}
	}
	if !opened {
		t.Errorf("the Trace does not hold the prompt that was typed:\n%v", kinds(stored))
	}
	if !answered {
		t.Errorf("the Trace does not hold the answer:\n%v", kinds(stored))
	}
}

func TestTheCommandLineFailsClosed(t *testing.T) {
	w := newWorld(t, fake(checkedIn(t)))

	for _, c := range []struct {
		name string
		args []string
	}{
		// No arguments at all is not here: it is the console, which is a command
		// rather than a mistake.
		{"the machine-readable stream with no prompt to answer", []string{"--json"}},
		{"a flag Eva does not have", []string{"-p", "hello", "--json", "--turbo"}},
		{"an argument that is not a flag", []string{"-p", "hello", "--json", "extra"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := w.run(t, c.args...)
			if got.code == 0 {
				t.Fatalf("exit 0, want non-zero\nstdout: %s", got.stdout)
			}
			if !strings.Contains(got.stderr, "USAGE:") {
				t.Errorf("stderr does not show what to do instead:\n%s", got.stderr)
			}
		})
	}
}

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
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/events"
)

// These tests observe only what something outside the program can observe: the
// bytes in the Trace file, what the process wrote to its streams, and the exit
// code. They start the real binary as a separate process, because two of the
// requirements this stage is heading towards are about interruption, and a test
// can only interrupt a process it started.
//
// eva is a console and nothing else, so a turn is driven the way a terminal
// drives one: a line is typed and sent. The Trace is what the assertions read.
// What a person saw was a screen redrawn in place and the record is not, and
// the Trace is the same Events the console itself is a fold over — so reading
// it is reading what the person was shown, without parsing a screen.
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

	// Windows will not execute a file with no extension, and `go build -o` writes
	// exactly the name it is given — so the name has to carry one. Without this,
	// every test in this package fails at the exec with "executable file not
	// found", which reads like a missing binary rather than a missing suffix.
	name := "eva"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}

	binary = filepath.Join(dir, name)
	build := exec.Command("go", "build", "-o", binary, "github.com/missingstudio/eva/cmd/eva")
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

// replayed answers one scripted turn from a local server speaking the API's
// own wire protocol.
//
// It is what a recording on disk used to be, and it is better in the way that
// matters: the turn runs through the Provider that answers in production, over
// the frames that Provider actually parses. A recording proved the machinery
// around a Provider; this proves the Provider too, and still needs no account
// and no network past the loopback.
func replayed(t *testing.T) provider {
	t.Helper()

	base, _ := api(t, oneTurn)
	return provider{
		model: "test-model",
		table: fmt.Sprintf("[provider]\nname = \"anthropic\"\nbase_url = %q\n", base),
		key:   "sk-ant-test",
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

// oneTurn is the turn this package answers from when a test does not generate
// one of its own, written as the frames the API sends.
//
// The figures are split the way the API splits them: what the input cost when
// the message opens, what the output cost when it closes. A cached turn, so
// that cache writes and cache reads are separate non-zero figures rather than
// one number that cannot compute cost. Three chunks of one content block, so
// that what the sink folds is visible in what the Trace holds.
//
// Reasoning and server-tool figures are absent on purpose: this API reports no
// reasoning figure and bills thinking inside the output tokens, so a zero here
// would be a confident lie rather than a measurement.
var oneTurn = frames(
	"message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"test-model","content":[],"usage":{"input_tokens":1200,"output_tokens":1,"cache_creation_input_tokens":96,"cache_read_input_tokens":1024}}}`,
	"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Eva is an autonomous, "}}`,
	"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"multi-tenant, "}}`,
	"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"AI-native software factory."}}`,
	"message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":340}}`,
	"message_stop", `{"type":"message_stop"}`,
)

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

// run starts eva and lets it end on its own, with nothing on its input.
//
// A console whose input is already at its end has nothing to read and leaves,
// so this is how a test asserts on what happens before the first prompt: a
// configuration Eva would not act on, a provider it cannot open, or the help.
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

// converse drives the console the way a terminal drives it: each prompt is
// typed and sent, one turn is waited for, and then the next is typed.
//
// Waiting matters. A second line typed into a console still answering the
// first would be a race rather than a conversation, and the Trace is what says
// a turn is over — the console answers beside this test, not inside it.
func (w *world) converse(t *testing.T, prompts ...string) (result, []events.Event) {
	t.Helper()

	if runtime.GOOS == "windows" {
		t.Skip("the console cannot be driven through a pipe here, so a turn is unverifiable")
	}

	// A Trace this process appends to may already hold turns of an earlier one,
	// so the turns of this run are counted from where it found the file.
	base := w.closedRuns(t)

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

	for i, prompt := range prompts {
		if _, err := keys.Write([]byte(prompt + "\r")); err != nil {
			t.Fatalf("type prompt %d: %v\nstderr: %s", i+1, err, stderr.String())
		}
		w.awaitRuns(t, base+i+1, &stderr)
	}

	// No more keys. A console whose input has ended has nothing left to read.
	if err := keys.Close(); err != nil {
		t.Fatalf("close eva's input: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatalf("eva did not leave when its input ended\nstderr: %s", stderr.String())
	}

	return result{
		code:   cmd.ProcessState.ExitCode(),
		stdout: stdout.String(),
		stderr: stderr.String(),
	}, w.stored(t)
}

// answer drives one prompt through the console and returns what the Trace
// holds, which is what almost every test in this file asserts on.
func (w *world) answer(t *testing.T, prompt string) []events.Event {
	t.Helper()

	got, held := w.converse(t, prompt)
	if got.code != 0 {
		t.Fatalf("exit %d, want 0\nstderr: %s", got.code, got.stderr)
	}
	return held
}

// closedRuns is how many Runs the Trace holds a claim for.
//
// A Run closes whichever way the turn went, so this counts turns that are over
// rather than turns that worked.
func (w *world) closedRuns(t *testing.T) int {
	t.Helper()

	body, err := os.ReadFile(w.trace)
	if errors.Is(err, os.ErrNotExist) {
		return 0
	}
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	return bytes.Count(body, []byte(`"kind":"finished"`))
}

// awaitRuns waits until the Trace holds n closed Runs.
func (w *world) awaitRuns(t *testing.T, n int, stderr *bytes.Buffer) {
	t.Helper()

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if w.closedRuns(t) >= n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("turn %d was not answered in 30s\nstderr: %s", n, stderr.String())
}

// stored is what the Trace holds.
func (w *world) stored(t *testing.T) []events.Event {
	t.Helper()

	body, err := os.ReadFile(w.trace)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	return decodeStream(t, string(body))
}

// recorded is the answer [oneTurn] replays, folded.
const recorded = "Eva is an autonomous, multi-tenant, AI-native software factory."

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
	w := newWorld(t, replayed(t))

	got := w.run(t, "help")
	if got.code != 0 {
		t.Fatalf("exit %d, want 0\nstderr: %s", got.code, got.stderr)
	}
	// The flags a process is started with, and the environment it reads. The
	// names come from config's own constants rather than from a copy written
	// here, so a variable that was renamed and a help text that was not fail
	// this rather than passing it. The model is not among them: which model
	// answers is the config file's business, and the usage block does not
	// speak for it.
	for _, want := range []string{
		"USAGE:", "eva help", "--config", "CONFIG (env):",
		config.DefaultAPIKeyEnv, config.EnvConfig, config.EnvHome,
	} {
		if !strings.Contains(got.stdout, want) {
			t.Errorf("the usage block does not mention %q:\n%s", want, got.stdout)
		}
	}
	// The one-shot is back, so it is advertised.
	if !strings.Contains(got.stdout, "-p <prompt>") {
		t.Errorf("the usage block does not offer the one-shot:\n%s", got.stdout)
	}
	// The machine-readable stream is not, and is not coming back. What a reader
	// wanting data reads is the Trace. A usage block still advertising it would
	// be describing a program Eva is not.
	for _, gone := range []string{"--json", "--prompt"} {
		if strings.Contains(got.stdout, gone) {
			t.Errorf("the usage block still offers %q:\n%s", gone, got.stdout)
		}
	}
}

// The recording delivers the answer in three chunks of one content block, and
// the sink folds them into one record at commit. A Trace record is a unit of
// meaning, so three chunks are one Text.
func TestAPlainTurnRecordsStartedTextUsageAndFinished(t *testing.T) {
	w := newWorld(t, replayed(t))

	got := w.answer(t, "what is this project")

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
	if text.Chunk != recorded {
		t.Errorf("the folded answer is %q, want %q", text.Chunk, recorded)
	}

	usage, ok := got[2].Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", got[2].Payload)
	}
	if reported(t, usage.InputTokens) != 1200 || reported(t, usage.OutputTokens) != 340 {
		t.Errorf("usage = %+v, want the recorded figures", usage)
	}
	write, read := reported(t, usage.CacheWriteTokens), reported(t, usage.CacheReadTokens)
	if write == 0 || read == 0 {
		t.Errorf("cache writes and reads = %d, %d — both should be non-zero on a cached turn", write, read)
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

// The Trace is the single source of truth, so the prompt has to be in it.
// Without this the transcript's first message exists only in the process that
// answered it, and resume has nothing to resume from.
func TestThePromptReachesTheTrace(t *testing.T) {
	const prompt = "what is this project"

	w := newWorld(t, replayed(t))
	got := w.answer(t, prompt)

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

// A second prompt is answered in the light of the first, and both turns are in
// one Trace under one Session.
func TestASecondPromptIsAnsweredInTheSameSession(t *testing.T) {
	w := newWorld(t, replayed(t))

	got, held := w.converse(t, "one", "two")
	if got.code != 0 {
		t.Fatalf("exit %d, want 0\nstderr: %s", got.code, got.stderr)
	}

	var runs, sessions = map[events.RunID]bool{}, map[events.SessionID]bool{}
	for _, e := range held {
		runs[e.Run] = true
		sessions[e.Session] = true
	}
	if len(runs) != 2 {
		t.Errorf("the Trace holds %d Runs, want one per prompt: %v", len(runs), kinds(held))
	}
	if len(sessions) != 1 {
		t.Errorf("the Trace holds %d Sessions, want one conversation", len(sessions))
	}
}

func TestEveryEventCarriesTheWholeEnvelope(t *testing.T) {
	w := newWorld(t, replayed(t))
	held := w.answer(t, "what is this project")

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	scan := bufio.NewScanner(strings.NewReader(string(body)))
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

	for i, e := range held {
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
	w := newWorld(t, replayed(t))
	got := w.answer(t, "what is this project")

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

func TestTheTurnIsAppendedToATraceThatParses(t *testing.T) {
	w := newWorld(t, replayed(t))
	held := w.answer(t, "what is this project")

	if len(held) == 0 {
		t.Fatal("the Trace holds nothing about a turn that was answered")
	}
	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	if !bytes.HasSuffix(body, []byte("\n")) {
		t.Error("the Trace does not end on a record boundary")
	}
}

// A second process appends rather than replacing, so the Trace is a record the
// developer did not have to ask for.
func TestASecondRunAppendsToTheSameTrace(t *testing.T) {
	w := newWorld(t, replayed(t))

	first := w.answer(t, "one")
	if len(first) == 0 {
		t.Fatal("the first run recorded nothing")
	}

	// A fresh process over the same configuration, and therefore the same
	// Trace. Its Session is its own; the file is not.
	second := w.answer(t, "two")

	if len(second) <= len(first) {
		t.Fatalf("the Trace holds %d records after the second run and %d after the first",
			len(second), len(first))
	}
	for i := range first {
		if second[i].ID != first[i].ID {
			t.Errorf("record %d was overwritten: %+v", i, second[i])
		}
	}
}

// longReplay answers one turn of many blocks, each of many chunks, and reports
// what one block folds to.
//
// It is generated rather than written down because the point is the volume:
// enough chunks that a Trace holding one record per chunk would be obvious,
// and enough blocks to interrupt in the middle of.
func longReplay(t *testing.T, blocks, chunks int) (provider, string) {
	t.Helper()

	// Every block is the same chunks, so what one folds to is what all of them
	// fold to.
	var block strings.Builder
	for c := range chunks {
		fmt.Fprintf(&block, "chunk %d. ", c)
	}

	pairs := []string{
		"message_start", `{"type":"message_start","message":{"usage":{"input_tokens":10}}}`,
	}
	for b := range blocks {
		for c := range chunks {
			pairs = append(pairs, "content_block_delta", fmt.Sprintf(
				`{"type":"content_block_delta","index":%d,"delta":{"type":"text_delta","text":%s}}`,
				b, strconv.Quote(fmt.Sprintf("chunk %d. ", c))))
		}
	}
	pairs = append(pairs,
		"message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}`,
		"message_stop", `{"type":"message_stop"}`)

	base, _ := api(t, frames(pairs...))
	return provider{
		model: "test-model",
		table: fmt.Sprintf("[provider]\nname = \"anthropic\"\nbase_url = %q\n", base),
		key:   "sk-ant-test",
	}, block.String()
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

	long, folded := longReplay(t, blocks, chunks)
	w := newWorld(t, long)
	held := w.answer(t, "answer at length")

	want := []events.Kind{events.KindStarted}
	for range blocks {
		want = append(want, events.KindText)
	}
	want = append(want, events.KindUsage, events.KindFinished)
	if fmt.Sprint(kinds(held)) != fmt.Sprint(want) {
		t.Fatalf("the run produced %d records of kinds %v, want %d of %v",
			len(held), kinds(held), len(want), want)
	}

	// The chunks really were thousands. The wire position counts what was sent,
	// so it is what says the fold had something to fold.
	if last := held[len(held)-1]; last.WireSeq < uint64(blocks*chunks) {
		t.Fatalf("the last record has wire position %d, want at least the %d chunks that were streamed",
			last.WireSeq, blocks*chunks)
	}

	// Folding is not dropping: every chunk of a block is in the record it
	// became.
	for i, e := range held[1 : 1+blocks] {
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
	next := map[events.SessionID]uint64{}
	for i, e := range held {
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
// Nothing here waits for the right moment to kill. The Trace itself is watched
// until it holds records of this turn and no claim closing it, and the signal
// lands there. It is provably mid-stream when it does, rather than probably.
//
// Every group this stage commits is one record once the chunks of a block have
// folded, so a torn group and a torn record are the same observation here. The
// multi-record group is killed in trace/sink_test.go, where a group can be
// constructed with the tool results stage 0 has no way to produce.
func TestAKilledRunLeavesATraceThatParsesCompletely(t *testing.T) {
	// This drives the console itself rather than through converse, so it needs
	// the same carve-out for the same reason: no turn starts on Windows, so there
	// is no mid-stream to kill. It failed there on "the turn never reached 20
	// records", which is that absence rather than a torn Trace.
	if runtime.GOOS == "windows" {
		t.Skip("the console cannot be driven through a pipe here, so a turn is unverifiable")
	}

	const (
		blocks = 2000
		caught = 20
	)

	long, _ := longReplay(t, blocks, 3)
	w := newWorld(t, long)

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
	if _, err := keys.Write([]byte("answer at length\r")); err != nil {
		t.Fatalf("type a prompt: %v", err)
	}

	var midStream bool
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		body, err := os.ReadFile(w.trace)
		if err != nil || bytes.Count(body, []byte("\n")) < caught {
			time.Sleep(time.Millisecond)
			continue
		}
		if bytes.Contains(body, []byte(`"kind":"finished"`)) {
			t.Fatal("the turn closed before it could be killed — the recording is too short")
		}
		midStream = true
		break
	}
	if !midStream {
		_ = cmd.Process.Kill()
		t.Fatalf("the turn never reached %d records\nstderr: %s", caught, stderr.String())
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
	if len(stored) < caught {
		t.Fatalf("the Trace holds %d records, want at least the %d that were watched for",
			len(stored), caught)
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

// A typo must not quietly disable the thing the user meant to set. The console
// never opens: a configuration Eva would not act on is refused before it is.
func TestAnUnknownConfigKeyExitsNonZeroNamingTheKey(t *testing.T) {
	w := newWorld(t, replayed(t).plus(`nmae = "anthropic"`))

	got := w.run(t)
	if got.code == 0 {
		t.Fatalf("exit 0 on an unknown key, want non-zero\nstdout: %s", got.stdout)
	}
	if !strings.Contains(got.stderr, "provider.nmae") {
		t.Errorf("stderr does not name the key:\n%s", got.stderr)
	}
	if !strings.Contains(got.stderr, w.config) {
		t.Errorf("stderr does not name the file:\n%s", got.stderr)
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

	got := w.run(t)
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

	w := newWorld(t, replayed(t))
	w.env = append(w.env, "ANTHROPIC_API_KEY="+key)

	got, _ := w.converse(t, "what is this project")
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
	w := newWorld(t, replayed(t))
	w.env = append(w.env, "EVA_CONFIG="+filepath.Join(w.dir, "there-is-no-such-file.toml"))

	// The console opens over the file the flag named and finds no input, so it
	// leaves. A flag that had not won would have exited on the missing file the
	// environment names.
	got := w.run(t, "--config", w.config)
	if got.code != 0 {
		t.Fatalf("exit %d, want 0 — the flag did not win\nstderr: %s", got.code, got.stderr)
	}
}

// eva with no arguments is the console, and the console is all there is.
//
// It is driven here the way a terminal drives it, with keys on the input
// stream, and what it left behind is read from the Trace rather than from
// stdout: what a person saw was a screen redrawn in place, and the record is
// not. The interface itself is exercised in console_test.go, in this process,
// where the keys and the Events can be told apart.
func TestNoArgumentsOpensAnInteractiveChat(t *testing.T) {
	w := newWorld(t, replayed(t))

	got, held := w.converse(t, "what is this project")
	if got.code != 0 {
		t.Fatalf("eva ended with %d, want 0\nstderr: %s", got.code, got.stderr)
	}

	var opened, answered bool
	for _, e := range held {
		if started, ok := e.Payload.(events.Started); ok && started.Intent == "what is this project" {
			opened = true
		}
		if text, ok := e.Payload.(events.Text); ok && strings.Contains(text.Chunk, recorded) {
			answered = true
		}
	}
	if !opened {
		t.Errorf("the Trace does not hold the prompt that was typed:\n%v", kinds(held))
	}
	if !answered {
		t.Errorf("the Trace does not hold the answer:\n%v", kinds(held))
	}
}

func TestTheCommandLineFailsClosed(t *testing.T) {
	w := newWorld(t, replayed(t))

	for _, c := range []struct {
		name string
		args []string
	}{
		// No arguments at all is not here: it is the console, which is a command
		// rather than a mistake.
		{"a flag Eva does not have", []string{"--turbo"}},
		{"an argument that is not a flag", []string{"extra"}},
		// -p is a flag again, so it is not here. --json is not, and a flag that
		// was quietly ignored would leave a script believing it had asked for
		// something.
		{"the machine-readable stream", []string{"--json"}},
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

// A configuration a person got wrong is reported whichever way they ran Eva.
//
// How it looks used to be read only when the console opened, so a keymap that
// would have eaten a letter and a colour that was not one both went unmentioned
// on the one-shot path — and the same file was an error or not depending on how
// the program was started.
func TestALookAndFeelMistakeIsReportedOnEitherPath(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "a key that would be taken from the prompt",
			body: "\n[keymap.bind]\nscroll_down = [\"j\"]\n",
			want: "prompt",
		},
		{
			name: "a colour that is not one",
			body: "\n[theme.colors]\nperson = \"notacolour\"\n",
			want: "not a colour",
		},
		{
			name: "a spinner Eva does not draw",
			body: "\n[theme.symbols]\nspinner = \"helix\"\n",
			want: "helix",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := newWorld(t, replayed(t))

			body, err := os.ReadFile(w.config)
			if err != nil {
				t.Fatalf("read the configuration: %v", err)
			}
			if err := os.WriteFile(w.config, append(body, []byte(c.body)...), 0o600); err != nil {
				t.Fatalf("write the configuration: %v", err)
			}

			// Both paths: the console, and the one turn a script asks for.
			for _, args := range [][]string{{}, {"-p", "anything"}} {
				got := w.run(t, args...)
				// 2 is what a configuration Eva would not act on exits with.
				if got.code != 2 {
					t.Errorf("eva %v exited %d, want 2 — the configuration is one Eva should not act on",
						args, got.code)
				}
				if !strings.Contains(got.stderr, c.want) {
					t.Errorf("eva %v does not say what is wrong (%q):\n%s", args, c.want, got.stderr)
				}
				if !strings.Contains(got.stderr, w.config) {
					t.Errorf("eva %v does not name the file to edit:\n%s", args, got.stderr)
				}
			}
		})
	}
}

// eva init writes a configuration a person can then edit, and refuses to write
// over one they already keep.
func TestInitWritesAStarterAndWillNotOverwriteIt(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	path := filepath.Join(home, "config.toml")

	w := &world{dir: dir, config: path}
	// No EVA_CONFIG: init resolves the same way a run does, and this is the
	// path a person gets when they have said nothing.
	w.env = append(os.Environ(), "EVA_HOME="+home, "EVA_CONFIG=", "ANTHROPIC_API_KEY=")

	first := w.run(t, "init")
	if first.code != 0 {
		t.Fatalf("eva init exited %d: %s", first.code, first.stderr)
	}
	if !strings.Contains(first.stdout, path) {
		t.Errorf("eva init does not say where it wrote:\n%s", first.stdout)
	}

	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("eva init wrote no file: %v", err)
	}
	if len(written) == 0 {
		t.Fatal("eva init wrote an empty file")
	}
	// A configuration names the variable a credential is read from, which is
	// not a thing to leave readable to everyone on a shared machine.
	//
	// Windows has no POSIX modes: Perm() reports 0666 for any writable file
	// whatever was asked for, so the check does not run there and says so. The
	// same carve-out, for the same reason, guards the auth store's own mode.
	if runtime.GOOS == "windows" {
		t.Log("degraded: file modes are not POSIX here, so 0600 went unchecked")
	} else {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		if mode := info.Mode().Perm(); mode != 0o600 {
			t.Errorf("the configuration is mode %o, want 600", mode)
		}
	}

	// And Eva runs against what it just wrote.
	if got := w.run(t, "help"); got.code != 0 {
		t.Errorf("eva does not run against its own starter: %s", got.stderr)
	}

	second := w.run(t, "init")
	if second.code != 2 {
		t.Errorf("a second eva init exited %d, want 2 — it must not write over a configuration", second.code)
	}
	if !strings.Contains(second.stderr, "already exists") {
		t.Errorf("the refusal does not say the file is already there:\n%s", second.stderr)
	}

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the configuration after the refused init: %v", err)
	}
	if string(after) != string(written) {
		t.Error("the refused init changed the file anyway")
	}
}

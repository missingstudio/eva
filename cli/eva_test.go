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
	"strings"
	"testing"

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

// newWorld writes a configuration that answers from the checked-in recording,
// and puts the Trace somewhere this test owns. extra is appended to the
// provider table.
func newWorld(t *testing.T, extra string) *world {
	t.Helper()

	dir := t.TempDir()
	script, err := filepath.Abs(filepath.Join("testdata", "script.toml"))
	if err != nil {
		t.Fatalf("locate the recording: %v", err)
	}

	w := &world{
		dir:    dir,
		config: filepath.Join(dir, "config.toml"),
		trace:  filepath.Join(dir, "traces", "eva.jsonl"),
	}
	// The provider table comes last so that a test can add a line to it.
	body := fmt.Sprintf(""+
		"model = \"test-model\"\n\n"+
		"[trace]\n"+
		"path = %q\n\n"+
		"[identity]\n"+
		"tenant = \"tenant_test\"\n"+
		"actor = \"seam-a\"\n"+
		"actor_kind = \"agent\"\n\n"+
		"[provider]\n"+
		"name = \"scripted\"\n"+
		"script = %q\n%s",
		w.trace, script, extra)
	if err := os.WriteFile(w.config, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// No API key and no home directory of the developer's: a test must need
	// neither network access nor a credential.
	w.env = append(os.Environ(),
		"EVA_HOME="+filepath.Join(dir, "home"),
		"EVA_CONFIG="+w.config,
		"ANTHROPIC_API_KEY=",
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
	w := newWorld(t, "")

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

func TestAPlainTurnEmitsStartedTextUsageAndFinished(t *testing.T) {
	w := newWorld(t, "")

	got := decodeStream(t, w.answer(t, "what is this project").stdout)

	want := []events.Kind{
		events.KindStarted,
		events.KindText, events.KindText, events.KindText,
		events.KindUsage,
		events.KindFinished,
	}
	if fmt.Sprint(kinds(got)) != fmt.Sprint(want) {
		t.Fatalf("kinds = %v, want %v", kinds(got), want)
	}

	var answer strings.Builder
	for _, e := range got {
		if text, ok := e.Payload.(events.Text); ok {
			answer.WriteString(text.Chunk)
		}
	}
	if !strings.Contains(answer.String(), "software factory") {
		t.Errorf("the answer is %q", answer.String())
	}

	usage, ok := got[4].Payload.(events.Usage)
	if !ok {
		t.Fatalf("payload = %#v, want Usage", got[4].Payload)
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

	finished, ok := got[5].Payload.(events.Finished)
	if !ok {
		t.Fatalf("payload = %#v, want Finished", got[5].Payload)
	}
	if finished.Claim.Result != events.ResultDone {
		t.Errorf("claim = %+v, want done", finished.Claim)
	}
}

func TestEveryEventCarriesTheWholeEnvelope(t *testing.T) {
	w := newWorld(t, "")
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
// the producer's. They are two sequences (docs/adr/0008).
//
// What this test can prove from outside the process is limited, and the limit
// is worth stating: with nothing yet coalescing, one wire Event becomes one
// Trace record, so a sink that passed the wire position straight through would
// also satisfy every assertion here. The proof that the sink assigns the
// position lives in TestTracePositionIsAssignedBySinkNotPassedThrough, which
// hands the sink wire positions in the nine hundreds and watches the Trace
// count from one. Once the sink coalesces, the two sequences diverge in a run
// like this one and the property becomes observable from out here too.
func TestTracePositionIsDenseAndIsNotTheWirePosition(t *testing.T) {
	w := newWorld(t, "")
	got := decodeStream(t, w.answer(t, "what is this project").stdout)

	for i, e := range got {
		if want := uint64(i + 1); e.Seq != want {
			t.Errorf("event %d Seq = %d, want %d — the Trace sequence has a gap", i, e.Seq, want)
		}
		if want := uint64(i); e.WireSeq != want {
			t.Errorf("event %d WireSeq = %d, want %d", i, e.WireSeq, want)
		}
		if e.Seq == e.WireSeq {
			t.Errorf("event %d has one number where the schema has two", i)
		}
	}
}

func TestTheOutputPathRendersNothing(t *testing.T) {
	w := newWorld(t, "")
	got := w.answer(t, "what is this project")

	if strings.ContainsRune(got.stdout, 0x1b) {
		t.Errorf("stdout carries a terminal escape:\n%q", got.stdout)
	}
	if got.stderr != "" {
		t.Errorf("stderr = %q, want nothing on a turn that worked", got.stderr)
	}
}

func TestTheTurnIsAppendedToATraceThatParses(t *testing.T) {
	w := newWorld(t, "")
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
	w := newWorld(t, "")
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

// ADR 0009: a typo must not quietly disable the thing the user meant to set.
func TestAnUnknownConfigKeyExitsNonZeroNamingTheKey(t *testing.T) {
	w := newWorld(t, "nmae = \"anthropic\"\n")

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

	w := newWorld(t, "")
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
	w := newWorld(t, "")
	w.env = append(w.env, "EVA_CONFIG="+filepath.Join(w.dir, "there-is-no-such-file.toml"))

	got := w.run(t, "-p", "hello", "--json", "--config", w.config)
	if got.code != 0 {
		t.Fatalf("exit %d, want 0 — the flag did not win\nstderr: %s", got.code, got.stderr)
	}
	if len(decodeStream(t, got.stdout)) == 0 {
		t.Error("the turn produced no Events")
	}
}

func TestTheCommandLineFailsClosed(t *testing.T) {
	w := newWorld(t, "")

	for _, c := range []struct {
		name string
		args []string
	}{
		{"no arguments at all", nil},
		{"a prompt with no output mode", []string{"-p", "hello"}},
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

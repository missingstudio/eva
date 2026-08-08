package cli_test

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/missingstudio/eva/events"
)

// These tests answer a turn from the real Provider, against a local server
// that speaks the API's own wire protocol: a real request, real server-sent
// events, real status codes. What they are for is the part the Provider's own
// tests cannot reach — whether what the Provider said reaches the Trace.
//
// The observation point is the same as everywhere else in this package: the
// Events on stdout, the bytes in the Trace, and the exit code.

// answered is the frames of a turn that succeeded. The figures are split the
// way the API splits them: what the input cost when the message opens, what
// the output cost when it closes.
var answered = frames(
	`message_start`, `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":1200,"output_tokens":1,"cache_creation_input_tokens":400,"cache_read_input_tokens":900}}}`,
	`content_block_delta`, `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Eva is "}}`,
	`content_block_delta`, `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a software factory."}}`,
	`message_delta`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":340}}`,
	`message_stop`, `{"type":"message_stop"}`,
)

// frames builds a server-sent event stream from alternating kinds and bodies.
func frames(pairs ...string) string {
	var b strings.Builder
	for i := 0; i < len(pairs); i += 2 {
		fmt.Fprintf(&b, "event: %s\ndata: %s\n\n", pairs[i], pairs[i+1])
	}
	return b.String()
}

// refused is the error document the API sends, with the status it sends it
// under.
type refused struct {
	status int
	kind   string
}

// api serves one reply per request, in order: the refusals first and then the
// stream, or only refusals when there is no stream to reach.
func api(t *testing.T, stream string, refusals ...refused) (base string, requests func() int) {
	t.Helper()

	var mu sync.Mutex
	var seen int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		at := seen
		seen++
		mu.Unlock()

		if at < len(refusals) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(refusals[at].status)
			_, _ = fmt.Fprintf(w, `{"type":"error","error":{"type":%q,"message":"the test asked for this"}}`, refusals[at].kind)
			return
		}
		if stream == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"no reply left"}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, stream)
	}))
	t.Cleanup(srv.Close)

	return srv.URL, func() int {
		mu.Lock()
		defer mu.Unlock()
		return seen
	}
}

// liveWorld is a run configured against the real Provider and the local API.
func liveWorld(t *testing.T, base string) *world {
	t.Helper()

	dir := t.TempDir()
	w := &world{
		dir:    dir,
		config: filepath.Join(dir, "config.toml"),
		trace:  filepath.Join(dir, "traces", "eva.jsonl"),
	}
	body := fmt.Sprintf(""+
		"model = \"claude-test\"\n\n"+
		"[trace]\n"+
		"path = %q\n\n"+
		"[identity]\n"+
		"tenant = \"tenant_test\"\n"+
		"actor = \"seam-a\"\n"+
		"actor_kind = \"agent\"\n\n"+
		"[provider]\n"+
		"name = \"anthropic\"\n"+
		"base_url = %q\n",
		w.trace, base)
	if err := os.WriteFile(w.config, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	w.env = append(os.Environ(),
		"EVA_HOME="+filepath.Join(dir, "home"),
		"EVA_CONFIG="+w.config,
		"ANTHROPIC_API_KEY=sk-ant-test",
	)
	return w
}

// stored is what the Trace holds after a run.
func stored(t *testing.T, w *world) []events.Event {
	t.Helper()

	body, err := os.ReadFile(w.trace)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	return decodeStream(t, string(body))
}

// only returns the one payload of a kind the run produced.
func only[T events.Payload](t *testing.T, es []events.Event) T {
	t.Helper()

	var found T
	var seen int
	for _, e := range es {
		if p, ok := e.Payload.(T); ok {
			found, seen = p, seen+1
		}
	}
	if seen != 1 {
		t.Fatalf("the run holds %d %T payloads, want exactly one: %v", seen, found, kinds(es))
	}
	return found
}

// The whole of the turn, end to end: a real request, a streamed answer, and
// what it cost recorded honestly enough to bill from.
func TestALiveTurnStreamsAnAnswerAndRecordsWhatItCost(t *testing.T) {
	base, requests := api(t, answered)
	w := liveWorld(t, base)

	printed := decodeStream(t, w.answer(t, "what is this project").stdout)
	if requests() != 1 {
		t.Errorf("the API saw %d requests, want one", requests())
	}

	want := []events.Kind{
		events.KindStarted,
		events.KindText,
		events.KindUsage,
		events.KindFinished,
	}
	if fmt.Sprint(kinds(printed)) != fmt.Sprint(want) {
		t.Fatalf("kinds = %v, want %v", kinds(printed), want)
	}

	// The two chunks were one content block, and the sink folds a block into
	// one record.
	text := only[events.Text](t, printed)
	if got, want := text.Chunk, "Eva is a software factory."; got != want {
		t.Errorf("the answer is %q, want %q", got, want)
	}

	usage := only[events.Usage](t, printed)
	if usage.InputTokens != 1200 || usage.OutputTokens != 340 {
		t.Errorf("usage = %+v, want the input from message_start and the output from message_delta", usage)
	}
	if usage.CacheWriteTokens != 400 || usage.CacheReadTokens != 900 {
		t.Errorf("cache writes and reads = %d, %d, want 400 and 900 as separate figures",
			usage.CacheWriteTokens, usage.CacheReadTokens)
	}
	if usage.ReasoningTokens != nil {
		t.Errorf("reasoning tokens = %d, want absent rather than zero on an Anthropic turn", *usage.ReasoningTokens)
	}
	if usage.USD != nil {
		t.Errorf("USD = %v, want absent — it is never derived from a price table or a clock", *usage.USD)
	}

	if claim := only[events.Finished](t, printed).Claim; claim.Result != events.ResultDone {
		t.Errorf("claim = %+v, want done", claim)
	}

	// The Trace holds the same turn stdout printed.
	held := stored(t, w)
	if len(held) != len(printed) {
		t.Fatalf("the Trace holds %d records and stdout printed %d", len(held), len(printed))
	}
	for i := range held {
		if held[i].ID != printed[i].ID || held[i].Seq != printed[i].Seq {
			t.Errorf("record %d: the Trace has %+v and stdout printed %+v", i, held[i], printed[i])
		}
	}
}

// A retry spends money and wall clock and produces no tool call. If it did not
// reach the Trace, the cost of retries would be invisible.
func TestARetryReachesTheTraceThoughItProducesNoToolCall(t *testing.T) {
	base, requests := api(t, answered, refused{http.StatusTooManyRequests, "rate_limit_error"})
	w := liveWorld(t, base)

	printed := decodeStream(t, w.answer(t, "what is this project").stdout)
	if requests() != 2 {
		t.Errorf("the API saw %d requests, want the refusal and the retry", requests())
	}

	want := []events.Kind{
		events.KindStarted,
		events.KindRetry,
		events.KindText,
		events.KindUsage,
		events.KindFinished,
	}
	if fmt.Sprint(kinds(printed)) != fmt.Sprint(want) {
		t.Fatalf("kinds = %v, want %v", kinds(printed), want)
	}

	retry := only[events.Retry](t, printed)
	switch {
	case retry.Attempt != 1:
		t.Errorf("attempt = %d, want the first", retry.Attempt)
	case retry.Max < 2:
		t.Errorf("max = %d, want the number of attempts the policy allows", retry.Max)
	case retry.DelayMS <= 0:
		t.Errorf("delay = %dms, want the wait that was taken", retry.DelayMS)
	case retry.ErrorClass != events.ErrorRateLimit:
		t.Errorf("error class = %q, want %q", retry.ErrorClass, events.ErrorRateLimit)
	}

	if held := stored(t, w); fmt.Sprint(kinds(held)) != fmt.Sprint(want) {
		t.Errorf("the Trace holds %v, want %v", kinds(held), want)
	}
}

// A provider failure is data. The turn ends, the exit code says so, and the
// Trace holds every attempt that was spent getting there.
func TestAProviderFailureReachesTheCallerAsData(t *testing.T) {
	base, requests := api(t, "",
		refused{529, "overloaded_error"},
		refused{529, "overloaded_error"},
		refused{529, "overloaded_error"},
		refused{529, "overloaded_error"},
	)
	w := liveWorld(t, base)

	got := w.run(t, "-p", "what is this project", "--json")
	if got.code == 0 {
		t.Fatalf("exit 0 against an API that only refused\nstdout: %s", got.stdout)
	}
	if requests() < 2 {
		t.Errorf("the API saw %d requests, want the attempts the policy allows", requests())
	}
	if strings.Contains(got.stderr, "panic:") || strings.Contains(got.stderr, "goroutine ") {
		t.Errorf("the failure arrived as a panic:\n%s", got.stderr)
	}
	if !strings.Contains(got.stderr, string(events.ErrorOverloaded)) {
		t.Errorf("stderr does not name the class of the failure:\n%s", got.stderr)
	}

	held := stored(t, w)
	if len(held) == 0 {
		t.Fatal("the Trace holds nothing about a turn that ran and failed")
	}
	if held[0].Kind != events.KindStarted {
		t.Errorf("the Trace opens with %q, want %q", held[0].Kind, events.KindStarted)
	}

	var retries int
	for _, e := range held {
		if r, ok := e.Payload.(events.Retry); ok {
			retries++
			if r.ErrorClass != events.ErrorOverloaded {
				t.Errorf("retry %d class = %q, want %q", retries, r.ErrorClass, events.ErrorOverloaded)
			}
		}
	}
	if retries == 0 {
		t.Error("the Trace holds no retry, and the turn was retried")
	}

	// A Run that failed and left no Finished record is a Run a reader cannot
	// tell from one that is still going.
	last := held[len(held)-1]
	finished, ok := last.Payload.(events.Finished)
	if !ok {
		t.Fatalf("the Trace ends on %q, want %q", last.Kind, events.KindFinished)
	}
	if finished.Claim.Result != events.ResultFailed {
		t.Errorf("claim = %+v, want failed", finished.Claim)
	}
}

// The provider a configuration selects by default has to be one the command
// can open. Two spellings of "anthropic" — the default in config and the name
// the Provider answers to — would otherwise be free to drift apart, and the
// first run to notice would be a first run with no configuration file.
func TestTheDefaultProviderIsOneTheCommandCanOpen(t *testing.T) {
	base, _ := api(t, answered)

	dir := t.TempDir()
	w := &world{
		dir:    dir,
		config: filepath.Join(dir, "config.toml"),
		trace:  filepath.Join(dir, "traces", "eva.jsonl"),
	}
	// No provider name at all: whatever config defaults to is what runs.
	body := fmt.Sprintf("model = \"claude-test\"\n\n[trace]\npath = %q\n\n[provider]\nbase_url = %q\n",
		w.trace, base)
	if err := os.WriteFile(w.config, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	w.env = append(os.Environ(),
		"EVA_HOME="+filepath.Join(dir, "home"),
		"EVA_CONFIG="+w.config,
		"ANTHROPIC_API_KEY=sk-ant-test",
	)

	got := w.run(t, "-p", "what is this project", "--json")
	if got.code != 0 {
		t.Fatalf("exit %d, want 0 — the default provider is not one open builds\nstderr: %s", got.code, got.stderr)
	}
}

// A Trace is something a developer can share, and this is the run where the
// credential is genuinely used.
func TestALiveTurnKeepsTheCredentialOutOfTheTraceAndTheStream(t *testing.T) {
	const key = "sk-ant-canary-do-not-store-me"

	base, _ := api(t, answered)
	w := liveWorld(t, base)
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

// truncated is a turn the model stopped because it reached the cap. Its frames
// are the frames of a whole turn: only the stop reason says otherwise.
var truncated = frames(
	`message_start`, `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"output_tokens":1}}}`,
	`content_block_delta`, `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"as much as would"}}`,
	`message_delta`, `{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":8192}}`,
	`message_stop`, `{"type":"message_stop"}`,
)

// unpriced is a turn the API reported no figures for at all.
var unpriced = frames(
	`message_start`, `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[]}}`,
	`content_block_delta`, `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answered for free, apparently"}}`,
	`message_delta`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"}}`,
	`message_stop`, `{"type":"message_stop"}`,
)

// An answer cut off at the cap reaches the Trace saying so. Nothing else in
// the stream would: a truncated turn streams the frames of a whole one, so
// without the caveat it closes with a clean claim over half an answer.
func TestATruncatedAnswerClosesTheRunWithACaveat(t *testing.T) {
	base, _ := api(t, truncated)
	w := liveWorld(t, base)

	printed := decodeStream(t, w.answer(t, "answer at length").stdout)

	want := []events.Kind{
		events.KindStarted,
		events.KindText,
		events.KindUsage,
		events.KindDegraded,
		events.KindFinished,
	}
	if fmt.Sprint(kinds(printed)) != fmt.Sprint(want) {
		t.Fatalf("kinds = %v, want %v", kinds(printed), want)
	}

	degraded := only[events.Degraded](t, printed)
	if len(degraded.Missing) != 1 || !strings.Contains(degraded.Missing[0], "cut off") {
		t.Errorf("the caveat is %v, and it does not say the answer was cut off", degraded.Missing)
	}

	// Degrading a Run never fails it. The turn did answer; the caveat says the
	// answer is not all of one.
	if claim := only[events.Finished](t, printed).Claim; claim.Result != events.ResultDone {
		t.Errorf("claim = %+v, want done", claim)
	}

	if held := stored(t, w); fmt.Sprint(kinds(held)) != fmt.Sprint(want) {
		t.Errorf("the Trace holds %v, want %v", kinds(held), want)
	}
}

// A turn whose cost nobody reported is otherwise indistinguishable from a turn
// nobody looked at.
func TestAnUnreportedCostClosesTheRunWithACaveat(t *testing.T) {
	base, _ := api(t, unpriced)
	w := liveWorld(t, base)

	printed := decodeStream(t, w.answer(t, "what is this project").stdout)

	want := []events.Kind{
		events.KindStarted,
		events.KindText,
		events.KindDegraded,
		events.KindFinished,
	}
	if fmt.Sprint(kinds(printed)) != fmt.Sprint(want) {
		t.Fatalf("kinds = %v, want %v", kinds(printed), want)
	}

	degraded := only[events.Degraded](t, printed)
	if len(degraded.Missing) != 1 || !strings.Contains(degraded.Missing[0], "cost") {
		t.Errorf("the caveat is %v, and it does not say the cost is unreported", degraded.Missing)
	}
}

// The caveat is one record, whoever noticed. Two would make a reader ask which
// of them qualified the claim.
func TestOneCaveatClosesTheRunHoweverManyThingsWereMissing(t *testing.T) {
	base, _ := api(t, frames(
		`message_start`, `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[]}}`,
		`content_block_delta`, `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"half an answer"}}`,
		`message_delta`, `{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}`,
		`message_stop`, `{"type":"message_stop"}`,
	))
	w := liveWorld(t, base)

	printed := decodeStream(t, w.answer(t, "answer at length").stdout)
	degraded := only[events.Degraded](t, printed)
	if len(degraded.Missing) != 2 {
		t.Fatalf("the caveat names %v, want both what is missing", degraded.Missing)
	}

	// The caveat is immediately before the claim it qualifies: a record behind
	// Finished is one the close does not cover.
	if last := kinds(printed); fmt.Sprint(last[len(last)-2:]) != fmt.Sprint([]events.Kind{events.KindDegraded, events.KindFinished}) {
		t.Errorf("the Run closes with %v, want the caveat and then the claim", last)
	}
}

// A whole turn whose cost was reported carries no caveat. A flag raised on
// every Run is a flag nothing reads.
func TestACleanLiveTurnClosesWithNoCaveat(t *testing.T) {
	base, _ := api(t, answered)
	w := liveWorld(t, base)

	for _, e := range decodeStream(t, w.answer(t, "what is this project").stdout) {
		if e.Kind == events.KindDegraded {
			t.Errorf("a clean turn was degraded by %+v", e.Payload)
		}
	}
}

// A cap the file chose reaches the API. The Provider defaults it and the file
// overrides it, so there is one number rather than two that must agree.
func TestTheAnswerCapInTheFileReachesTheAPI(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, answered)
	}))
	t.Cleanup(srv.Close)

	w := liveWorld(t, srv.URL)
	if err := os.WriteFile(w.config, []byte(fmt.Sprintf(
		"model = \"claude-test\"\n\n[trace]\npath = %q\n\n[provider]\nname = \"anthropic\"\nbase_url = %q\nmax_tokens = 4321\n",
		w.trace, srv.URL)), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	w.answer(t, "what is this project")
	if !strings.Contains(body, `"max_tokens":4321`) {
		t.Errorf("the request does not carry the cap the file chose:\n%s", body)
	}
}

package anthropic_test

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

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/providers"
	"github.com/missingstudio/eva/providers/anthropic"
)

// These tests drive the Provider against a local server that speaks the real
// wire protocol: server-sent events, the real error documents, the real status
// codes. Nothing is stubbed inside the SDK, so what runs here is the decoding
// path a live turn takes — and nothing needs the network or a credential.
//
// What they assert on is the payload sequence the Provider yields. That is the
// whole of its contract: a Provider says what happened, and something else
// decides how it is recorded.

// frame is one server-sent event.
func frame(kind, data string) string {
	return fmt.Sprintf("event: %s\ndata: %s\n\n", kind, data)
}

// reply is one HTTP response the recorded server hands back. Replies are
// consumed in order, one per request, so a test can fail the first attempt and
// answer the second.
type reply struct {
	status int
	// body is a whole response: the frames of a stream on 200, an error
	// document otherwise.
	body   string
	header map[string]string
}

// stream is a reply that answers, built from its frames.
func stream(frames ...string) reply {
	return reply{status: http.StatusOK, body: strings.Join(frames, "")}
}

// fails is a reply that refuses, with the error document the API sends.
func fails(status int, kind string) reply {
	return reply{
		status: status,
		body:   fmt.Sprintf(`{"type":"error","error":{"type":%q,"message":"the test asked for this"}}`, kind),
	}
}

// after is a refusal that says how long to wait, in seconds.
func after(seconds string) reply {
	r := fails(http.StatusTooManyRequests, "rate_limit_error")
	r.header = map[string]string{"Retry-After": seconds}
	return r
}

// serve replays the replies, and reports how many requests it received.
func serve(t *testing.T, replies ...reply) (base string, requests func() int) {
	t.Helper()

	var mu sync.Mutex
	var seen int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		at := seen
		seen++
		mu.Unlock()

		if at >= len(replies) {
			t.Errorf("request %d arrived and the server holds %d replies", at+1, len(replies))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		rep := replies[at]
		for k, v := range rep.header {
			w.Header().Set(k, v)
		}
		if rep.status == http.StatusOK {
			w.Header().Set("Content-Type", "text/event-stream")
		} else {
			w.Header().Set("Content-Type", "application/json")
		}
		w.WriteHeader(rep.status)
		_, _ = io.WriteString(w, rep.body)
	}))
	t.Cleanup(srv.Close)

	return srv.URL, func() int {
		mu.Lock()
		defer mu.Unlock()
		return seen
	}
}

// open builds a Provider against the recorded server. The backoff is a few
// milliseconds, because what these tests measure is which delays are reported,
// never how long one takes.
func open(t *testing.T, base string) *anthropic.Provider {
	t.Helper()

	p, err := anthropic.New(anthropic.Options{
		APIKey:  "sk-ant-test",
		BaseURL: base,
		Retry:   anthropic.Policy{Attempts: 4, Base: 4 * time.Millisecond, Cap: 40 * time.Millisecond},
	})
	if err != nil {
		t.Fatalf("open the Provider: %v", err)
	}
	return p
}

// ask streams one prompt and returns every payload, and the failure the turn
// ended on.
func ask(t *testing.T, p *anthropic.Provider) ([]events.Payload, error) {
	t.Helper()

	s, err := p.Stream(context.Background(), providers.Call{
		Model:    "claude-test",
		Messages: []core.Message{{Author: core.AuthorUser, Text: "what is this project"}},
	})
	if err != nil {
		t.Fatalf("begin the turn: %v", err)
	}
	defer func() { _ = s.Close() }()

	var out []events.Payload
	for {
		payload, err := s.Next(context.Background())
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		out = append(out, payload)
	}
}

// text joins the Text payloads, so a test can assert the answer without
// caring how many chunks carried it.
func text(payloads []events.Payload) string {
	var b strings.Builder
	for _, p := range payloads {
		if t, ok := p.(events.Text); ok {
			b.WriteString(t.Chunk)
		}
	}
	return b.String()
}

func only[T events.Payload](t *testing.T, payloads []events.Payload) T {
	t.Helper()

	var found T
	var seen int
	for _, p := range payloads {
		if v, ok := p.(T); ok {
			found, seen = v, seen+1
		}
	}
	if seen != 1 {
		t.Fatalf("the turn produced %d %T payloads, want exactly one: %#v", seen, found, payloads)
	}
	return found
}

// The figures arrive split: message_start carries what the input cost, and
// message_delta carries what the output cost. One Usage payload accumulates
// both, and it is emitted once, at the end of the turn.
func TestOneUsageAccumulatesTheStartAndTheDelta(t *testing.T) {
	base, _ := serve(t, stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"usage":{"input_tokens":1200,"output_tokens":1,"cache_creation_input_tokens":400,"cache_read_input_tokens":900}}}`),
		frame("content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Eva is "}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a software factory."}}`),
		frame("content_block_stop", `{"type":"content_block_stop","index":0}`),
		frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":340}}`),
		frame("message_stop", `{"type":"message_stop"}`),
	))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	if want := "Eva is a software factory."; text(got) != want {
		t.Errorf("the answer is %q, want %q", text(got), want)
	}

	usage := only[events.Usage](t, got)
	if usage.InputTokens != 1200 {
		t.Errorf("input tokens = %d, want the 1200 message_start reported", usage.InputTokens)
	}
	if usage.OutputTokens != 340 {
		t.Errorf("output tokens = %d, want the 340 message_delta reported", usage.OutputTokens)
	}

	// The Usage is the last thing the turn says. A cost reported before the
	// stream ended would be a cost the rest of the stream then changed.
	if _, last := got[len(got)-1].(events.Usage); !last {
		t.Errorf("the turn ends on %T, want Usage", got[len(got)-1])
	}
}

// A cache write costs more than base input and a cache read costs far less, so
// one figure cannot compute cost.
func TestCacheWritesAndCacheReadsAreSeparateFigures(t *testing.T) {
	base, _ := serve(t, stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"output_tokens":1,"cache_creation_input_tokens":400,"cache_read_input_tokens":900}}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"cached"}}`),
		frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`),
		frame("message_stop", `{"type":"message_stop"}`),
	))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	usage := only[events.Usage](t, got)
	if usage.CacheWriteTokens != 400 || usage.CacheReadTokens != 900 {
		t.Errorf("cache writes and reads = %d, %d, want 400 and 900 as separate figures",
			usage.CacheWriteTokens, usage.CacheReadTokens)
	}
}

// nil means the provider did not tell us and 0 means none were used.
// Collapsing the two is how a cost report becomes confidently wrong.
func TestWhatAnthropicDoesNotReportIsAbsentRatherThanZero(t *testing.T) {
	base, _ := serve(t, stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"output_tokens":1}}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}`),
		frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`),
		frame("message_stop", `{"type":"message_stop"}`),
	))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	usage := only[events.Usage](t, got)
	if usage.ReasoningTokens != nil {
		t.Errorf("reasoning tokens = %d, want absent — Anthropic bills thinking inside output tokens",
			*usage.ReasoningTokens)
	}
	if usage.ServerToolTokens != nil {
		t.Errorf("server tool tokens = %d, want absent — the API reports requests, not tokens",
			*usage.ServerToolTokens)
	}
	if usage.USD != nil {
		t.Errorf("USD = %v, want absent — a dollar figure is never derived here", *usage.USD)
	}
}

// A turn the API reported no figure for reports none. A Usage of zeros would
// say "none were used", which is a different claim from "we were never told",
// and this is the field where the two must not be confused.
func TestATurnWithNoReportedFiguresEmitsNoUsage(t *testing.T) {
	base, _ := serve(t, stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[]}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}`),
		frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"}}`),
		frame("message_stop", `{"type":"message_stop"}`),
	))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	for _, p := range got {
		if usage, ok := p.(events.Usage); ok {
			t.Fatalf("the turn reported %+v, and the API reported nothing", usage)
		}
	}
}

// A turn is several content blocks, and the block index is what the Trace
// sink folds on. Two blocks must not fold into one record.
func TestEachContentBlockKeepsItsOwnIndex(t *testing.T) {
	base, _ := serve(t, stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"output_tokens":1}}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"first"}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"second"}}`),
		frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`),
		frame("message_stop", `{"type":"message_stop"}`),
	))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}

	var blocks []int
	for _, p := range got {
		if t, ok := p.(events.Text); ok {
			blocks = append(blocks, t.Block)
		}
	}
	if fmt.Sprint(blocks) != fmt.Sprint([]int{0, 1}) {
		t.Errorf("the blocks are %v, want 0 then 1", blocks)
	}
}

// A retry spends money and wall clock and produces no tool call, so it is its
// own record. Without it the cost of retries is invisible.
func TestARetriedRequestReportsTheAttemptAndTheErrorClass(t *testing.T) {
	base, requests := serve(t,
		fails(http.StatusTooManyRequests, "rate_limit_error"),
		answers("answered on the second attempt"),
	)

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if requests() != 2 {
		t.Errorf("the server saw %d requests, want the failure and the retry", requests())
	}

	retry := only[events.Retry](t, got)
	if retry.Attempt != 1 || retry.Max != 4 {
		t.Errorf("retry = attempt %d of %d, want 1 of 4", retry.Attempt, retry.Max)
	}
	if retry.ErrorClass != events.ErrorRateLimit {
		t.Errorf("error class = %q, want %q", retry.ErrorClass, events.ErrorRateLimit)
	}
	if retry.DelayMS <= 0 {
		t.Errorf("delay = %dms, want the wait that was actually taken", retry.DelayMS)
	}

	// The retry is reported before the answer it preceded, so a reader of the
	// Trace sees the turn in the order it happened.
	if _, first := got[0].(events.Retry); !first {
		t.Errorf("the turn opens with %T, want the Retry", got[0])
	}
	if want := "answered on the second attempt"; text(got) != want {
		t.Errorf("the answer is %q, want %q", text(got), want)
	}
}

// answers is the frames of a turn that succeeded, for the tests whose subject
// is what happened before it.
func answers(said string) reply {
	return stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"output_tokens":1}}}`),
		frame("content_block_delta", fmt.Sprintf(`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":%q}}`, said)),
		frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`),
		frame("message_stop", `{"type":"message_stop"}`),
	)
}

// A server that said how long to wait knows what it is recovering from, and
// this client does not.
func TestAServerThatSaidHowLongToWaitIsObeyed(t *testing.T) {
	base, _ := serve(t, after("0.02"), answers("waited as asked"))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	// Twenty milliseconds, and the backoff on its own would have been four.
	if retry := only[events.Retry](t, got); retry.DelayMS != 20 {
		t.Errorf("delay = %dms, want the 20ms the server asked for", retry.DelayMS)
	}
}

// A server asking for nothing must not turn the retry into a second request
// with no pause in front of it.
func TestAServerStatedWaitNeverLowersTheBackoff(t *testing.T) {
	base, _ := serve(t, after("0"), answers("waited anyway"))

	got, err := ask(t, open(t, base))
	if err != nil {
		t.Fatalf("the turn failed: %v", err)
	}
	if retry := only[events.Retry](t, got); retry.DelayMS < 2 {
		t.Errorf("delay = %dms, want at least the jittered half of the 4ms backoff", retry.DelayMS)
	}
}

// Beyond the policy's patience the retries end and the failure is returned. A
// caller that has been told the request failed can decide to come back; a
// caller parked inside a Provider can decide nothing.
func TestAWaitBeyondThePolicysPatienceEndsTheRetries(t *testing.T) {
	base, requests := serve(t, after("5"))

	got, err := ask(t, open(t, base))
	if err == nil {
		t.Fatal("the turn succeeded against a server that asked for five seconds")
	}
	if requests() != 1 {
		t.Errorf("the server saw %d requests, want one", requests())
	}
	if len(got) != 0 {
		t.Errorf("the turn produced %#v, want nothing — no attempt followed", got)
	}
}

// The error class comes from the fixed set, so a rate limit can be told apart
// from a server error without parsing prose.
func TestTheErrorClassComesFromTheFixedSet(t *testing.T) {
	for _, c := range []struct {
		name   string
		status int
		kind   string
		want   events.ErrorClass
	}{
		{"a rate limit", http.StatusTooManyRequests, "rate_limit_error", events.ErrorRateLimit},
		{"an overloaded API", 529, "overloaded_error", events.ErrorOverloaded},
		{"a server error", http.StatusInternalServerError, "api_error", events.ErrorServerError},
		{"a gateway with no error document", http.StatusBadGateway, "", events.ErrorServerError},
	} {
		t.Run(c.name, func(t *testing.T) {
			bad := fails(c.status, c.kind)
			if c.kind == "" {
				bad = reply{status: c.status, body: "<html>the proxy says no</html>"}
			}
			base, _ := serve(t, bad, answers("recovered"))

			got, err := ask(t, open(t, base))
			if err != nil {
				t.Fatalf("the turn failed: %v", err)
			}
			if retry := only[events.Retry](t, got); retry.ErrorClass != c.want {
				t.Errorf("error class = %q, want %q", retry.ErrorClass, c.want)
			}
		})
	}
}

// A credential the API rejected will be rejected again. Retrying one spends
// money to learn nothing.
func TestARejectedCredentialIsNotRetried(t *testing.T) {
	base, requests := serve(t, fails(http.StatusUnauthorized, "authentication_error"))

	got, err := ask(t, open(t, base))
	if err == nil {
		t.Fatal("the turn succeeded with a rejected credential")
	}
	if requests() != 1 {
		t.Errorf("the server saw %d requests, want one — an auth failure is not retried", requests())
	}
	if len(got) != 0 {
		t.Errorf("the turn produced %#v, want nothing", got)
	}
	if !strings.Contains(err.Error(), string(events.ErrorAuthFailed)) {
		t.Errorf("the failure is %q, and it does not name its class", err)
	}
}

// Every attempt is reported, and then the failure reaches the caller as data
// rather than as a panic.
func TestExhaustedRetriesReportEveryAttemptAndThenFail(t *testing.T) {
	base, requests := serve(t,
		fails(529, "overloaded_error"),
		fails(529, "overloaded_error"),
		fails(529, "overloaded_error"),
		fails(529, "overloaded_error"),
	)

	got, err := ask(t, open(t, base))
	if err == nil {
		t.Fatal("the turn succeeded against a server that only refused")
	}
	if requests() != 4 {
		t.Errorf("the server saw %d requests, want the 4 the policy allows", requests())
	}

	if len(got) != 3 {
		t.Fatalf("the turn reported %d retries, want the 3 that preceded the last attempt: %#v", len(got), got)
	}
	for i, p := range got {
		retry, ok := p.(events.Retry)
		if !ok {
			t.Fatalf("payload %d = %#v, want Retry", i, p)
		}
		if retry.Attempt != i+1 || retry.Max != 4 {
			t.Errorf("payload %d = attempt %d of %d, want %d of 4", i, retry.Attempt, retry.Max, i+1)
		}
		if retry.ErrorClass != events.ErrorOverloaded {
			t.Errorf("payload %d class = %q, want %q", i, retry.ErrorClass, events.ErrorOverloaded)
		}
	}
}

// A stream that breaks part way still cost what it had already spent, and the
// caller has to be told both things.
func TestAStreamThatBreaksReportsWhatWasBilledAndThenTheFailure(t *testing.T) {
	base, _ := serve(t, stream(
		frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":1200,"output_tokens":1,"cache_creation_input_tokens":400,"cache_read_input_tokens":900}}}`),
		frame("content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"half an "}}`),
		frame("error", `{"type":"error","error":{"type":"overloaded_error","message":"the test asked for this"}}`),
	))

	got, err := ask(t, open(t, base))
	if err == nil {
		t.Fatal("the turn succeeded on a stream that broke")
	}
	if want := "half an "; text(got) != want {
		t.Errorf("the partial answer is %q, want %q", text(got), want)
	}

	usage := only[events.Usage](t, got)
	if usage.InputTokens != 1200 || usage.CacheReadTokens != 900 {
		t.Errorf("usage = %+v, want what message_start reported before the break", usage)
	}
	if !strings.Contains(err.Error(), string(events.ErrorOverloaded)) {
		t.Errorf("the failure is %q, and it does not name its class", err)
	}
}

// The transcript is what the answer is conditioned on, so it has to reach the
// API as the API's own shape.
func TestTheTranscriptIsSentAsMessagesAndASystemPrompt(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, stream(
			frame("message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":12,"output_tokens":1}}}`),
			frame("message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`),
			frame("message_stop", `{"type":"message_stop"}`),
		).body)
	}))
	t.Cleanup(srv.Close)

	p := open(t, srv.URL)
	s, err := p.Stream(context.Background(), providers.Call{
		Model: "claude-test",
		Messages: []core.Message{
			{Author: core.AuthorSystem, Text: "answer briefly"},
			{Author: core.AuthorUser, Text: "one"},
			{Author: core.AuthorAssistant, Text: "two"},
			{Author: core.AuthorUser, Text: "three"},
		},
	})
	if err != nil {
		t.Fatalf("begin the turn: %v", err)
	}
	for {
		if _, err := s.Next(context.Background()); err != nil {
			break
		}
	}
	_ = s.Close()

	for _, want := range []string{
		`"model":"claude-test"`,
		`"system":[{"text":"answer briefly","type":"text"}]`,
		`"role":"user"`,
		`"role":"assistant"`,
		`"stream":true`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the request does not carry %s:\n%s", want, body)
		}
	}
	if strings.Contains(body, `"role":"system"`) {
		t.Errorf("a system message was sent as a turn rather than as the system prompt:\n%s", body)
	}
}

// A turn with nothing to answer is rejected here rather than at the API, so
// the failure names what is missing.
func TestATurnWithNoTranscriptIsRejected(t *testing.T) {
	base, requests := serve(t)

	p := open(t, base)
	s, err := p.Stream(context.Background(), providers.Call{Model: "claude-test"})
	if err == nil {
		_ = s.Close()
		t.Fatal("a turn with no transcript began")
	}
	if requests() != 0 {
		t.Errorf("the server saw %d requests, want none", requests())
	}
}

func TestAProviderWithNoCredentialIsRefusedAtConstruction(t *testing.T) {
	if _, err := anthropic.New(anthropic.Options{}); err == nil {
		t.Fatal("a Provider was built with no credential")
	}
}

func TestTheProviderIsNamedForWhatSelectsIt(t *testing.T) {
	if got := open(t, "http://127.0.0.1:1").Name(); got != anthropic.Name {
		t.Errorf("name = %q, want %q", got, anthropic.Name)
	}
}

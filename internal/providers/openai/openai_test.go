package openai_test

// These tests run the Provider against a real local server speaking the
// Responses API's server-sent-event stream. Nothing is stubbed inside the
// Provider, so what runs here is the decoding path a live turn takes — and
// nothing needs the network or a credential.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/providers/openai"
	"github.com/missingstudio/eva/internal/providers/providertest"
	"github.com/missingstudio/eva/internal/providers/retry"
)

// data writes one SSE frame the way the API writes one.
func data(payload string) string { return "data: " + payload + "\n\n" }

// answered is a whole happy turn: two deltas, the assembled item restating
// them, and the terminal frame carrying usage.
func answered() string {
	return strings.Join([]string{
		"event: response.output_text.delta\n",
		data(`{"type": "response.output_text.delta", "output_index": 0, "delta": "Hello"}`),
		data(`{"type": "response.output_text.delta", "output_index": 0, "delta": " world"}`),
		data(`{"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "content": [{"type": "output_text", "text": "Hello world"}]}}`),
		data(`{"type": "response.completed", "response": {"status": "completed", "usage": {"input_tokens": 7, "output_tokens": 3, "input_tokens_details": {"cached_tokens": 2}, "output_tokens_details": {"reasoning_tokens": 1}}}}`),
		data("[DONE]"),
	}, "")
}

// reply is one scripted answer the server gives to one request.
type reply struct {
	status int
	body   string
	header map[string]string
}

func stream(body string) reply { return reply{status: http.StatusOK, body: body} }

func fails(status int) reply {
	return reply{status: status, body: `{"error": {"message": "no"}}`}
}

func after(seconds int) reply {
	return reply{
		status: http.StatusTooManyRequests,
		body:   `{"error": {"message": "slow down"}}`,
		header: map[string]string{"retry-after": fmt.Sprint(seconds)},
	}
}

// serve replays one reply per request, records each request, and fails the
// test when a request arrives with no reply left for it.
func serve(t *testing.T, replies ...reply) (base string, seen func() []*http.Request) {
	t.Helper()

	var requests []*http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(requests) >= len(replies) {
			t.Errorf("request %d arrived with no reply scripted for it", len(requests)+1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		body, _ := io.ReadAll(r.Body)
		clone := r.Clone(context.Background())
		clone.Body = io.NopCloser(strings.NewReader(string(body)))
		requests = append(requests, clone)

		reply := replies[len(requests)-1]
		for k, v := range reply.header {
			w.Header().Set(k, v)
		}
		if reply.status == http.StatusOK {
			w.Header().Set("Content-Type", "text/event-stream")
		}
		w.WriteHeader(reply.status)
		_, _ = io.WriteString(w, reply.body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL, func() []*http.Request { return requests }
}

// subscriptionToken mints a JWT-shaped access token carrying the account
// claim. The Provider reads claims and never verifies a signature.
func subscriptionToken(t *testing.T, accountID string) string {
	t.Helper()
	claims, err := json.Marshal(map[string]any{
		"https://api.openai.com/auth": map[string]string{"chatgpt_account_id": accountID},
	})
	if err != nil {
		t.Fatal(err)
	}
	return "header." + base64.RawURLEncoding.EncodeToString(claims) + ".signature"
}

// open builds a Provider against base, retrying on a clock a test can afford.
func open(t *testing.T, base, credential string, subscription bool) *openai.Provider {
	t.Helper()
	cred := providers.APIKey(func() (string, error) { return credential, nil })
	if subscription {
		cred = providers.Subscription(func() (string, error) { return credential, nil })
	}
	p, err := openai.New(providers.Options{
		Credential: cred,
		BaseURL:    base,
		Retry:      retry.Policy{Attempts: 4, Base: time.Millisecond, Cap: 5 * time.Millisecond},
	})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func turn() providers.Call {
	return providers.Call{
		Model: "gpt-test",
		Messages: []core.Message{
			core.Say(core.AuthorSystem, "Answer briefly."),
			core.Say(core.AuthorUser, "Say hello."),
		},
	}
}

// drain pulls a Stream to completion and returns everything it yielded.
func drain(t *testing.T, p *openai.Provider, call providers.Call) []events.Payload {
	t.Helper()
	s := p.Stream(context.Background(), call)
	defer func() { _ = s.Close() }()

	var out []events.Payload
	for {
		payload, err := s.Next(context.Background())
		if errors.Is(err, io.EOF) {
			return out
		}
		if err != nil {
			t.Fatalf("the turn failed: %v (after %d payloads)", err, len(out))
		}
		out = append(out, payload)
	}
}

// folded is the answer a turn's Text payloads spell out.
func folded(payloads []events.Payload) string {
	var b strings.Builder
	for _, p := range payloads {
		if text, ok := p.(events.Text); ok {
			b.WriteString(text.Chunk)
		}
	}
	return b.String()
}

func TestAPlainTurnYieldsItsTextAndWhatItCost(t *testing.T) {
	base, _ := serve(t, stream(answered()))
	got := drain(t, open(t, base, "sk-key", false), turn())

	if said := folded(got); said != "Hello world" {
		t.Errorf("the turn said %q, want the deltas and nothing twice", said)
	}

	var usage *events.Usage
	for _, p := range got {
		if u, ok := p.(events.Usage); ok {
			usage = &u
		}
	}
	if usage == nil {
		t.Fatal("a turn the API priced yielded no Usage")
	}
	if usage.InputTokens == nil || *usage.InputTokens != 7 {
		t.Errorf("input tokens = %v, want 7", usage.InputTokens)
	}
	if usage.CacheReadTokens == nil || *usage.CacheReadTokens != 2 {
		t.Errorf("cache reads = %v, want 2", usage.CacheReadTokens)
	}
	if usage.ReasoningTokens == nil || *usage.ReasoningTokens != 1 {
		t.Errorf("reasoning tokens = %v, want 1", usage.ReasoningTokens)
	}
	if usage.USD != nil {
		t.Error("a dollar figure was invented — billing meters from reported usage, never from here")
	}
}

func TestTheRequestSpeaksTheResponsesShape(t *testing.T) {
	base, seen := serve(t, stream(answered()))
	drain(t, open(t, base, "sk-key", false), turn())

	req := seen()[0]
	body, _ := io.ReadAll(req.Body)

	var sent struct {
		Model        string `json:"model"`
		Instructions string `json:"instructions"`
		Store        bool   `json:"store"`
		Stream       bool   `json:"stream"`
		Input        []struct {
			Role    string `json:"role"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"input"`
	}
	if err := json.Unmarshal(body, &sent); err != nil {
		t.Fatalf("the request is not the JSON the API reads: %v", err)
	}

	if sent.Instructions != "Answer briefly." {
		t.Errorf("instructions = %q, want the system Message", sent.Instructions)
	}
	if len(sent.Input) != 1 || sent.Input[0].Role != "user" {
		t.Fatalf("input = %+v, want the one user Message", sent.Input)
	}
	if sent.Input[0].Content[0].Type != "input_text" {
		t.Errorf("a person's words were sent as %q, want input_text", sent.Input[0].Content[0].Type)
	}
	if sent.Store {
		t.Error("the turn asked the API to persist it — the Trace is the record")
	}
	if !sent.Stream {
		t.Error("the turn did not ask for a stream")
	}
}

func TestTheSubscriptionTransportSendsTheLoginsHeaders(t *testing.T) {
	base, seen := serve(t, stream(answered()))
	token := subscriptionToken(t, "acct_9")
	drain(t, open(t, base, token, true), turn())

	req := seen()[0]
	if got := req.Header.Get("Authorization"); got != "Bearer "+token {
		t.Errorf("Authorization = %q, want the bearer token", got)
	}
	if got := req.Header.Get("chatgpt-account-id"); got != "acct_9" {
		t.Errorf("chatgpt-account-id = %q, want the id inside the token", got)
	}
	if got := req.Header.Get("originator"); got != "eva" {
		t.Errorf("originator = %q, want eva", got)
	}
	if req.Header.Get("OpenAI-Beta") == "" {
		t.Error("the subscription request carries no OpenAI-Beta header")
	}
}

func TestTheAPIKeyTransportSendsOnlyTheBearer(t *testing.T) {
	base, seen := serve(t, stream(answered()))
	drain(t, open(t, base, "sk-key", false), turn())

	req := seen()[0]
	if got := req.Header.Get("Authorization"); got != "Bearer sk-key" {
		t.Errorf("Authorization = %q, want the bearer key", got)
	}
	if got := req.Header.Get("chatgpt-account-id"); got != "" {
		t.Errorf("an API-key request carries a subscription header: chatgpt-account-id = %q", got)
	}
}

func TestARateLimitedAttemptIsRetriedAndTheAttemptIsARecord(t *testing.T) {
	base, seen := serve(t, after(0), stream(answered()))
	got := drain(t, open(t, base, "sk-key", false), turn())

	if len(seen()) != 2 {
		t.Fatalf("%d requests were made, want the refusal and the retry", len(seen()))
	}
	retry, ok := got[0].(events.Retry)
	if !ok {
		t.Fatalf("the first payload is %T, want the Retry — the attempt spent money and produced nothing", got[0])
	}
	if retry.ErrorClass != events.ErrorRateLimit {
		t.Errorf("the retry says %q, want %q", retry.ErrorClass, events.ErrorRateLimit)
	}
	if said := folded(got); said != "Hello world" {
		t.Errorf("the turn said %q after the retry, want the whole answer", said)
	}
}

func TestARejectedCredentialIsNotRetried(t *testing.T) {
	base, seen := serve(t, fails(http.StatusUnauthorized))
	s := open(t, base, "sk-bad", false).Stream(context.Background(), turn())
	defer func() { _ = s.Close() }()

	_, err := s.Next(context.Background())
	if err == nil {
		t.Fatal("a rejected credential answered a turn")
	}
	if !strings.Contains(err.Error(), string(events.ErrorAuthFailed)) {
		t.Errorf("the failure does not name its class: %v", err)
	}
	if len(seen()) != 1 {
		t.Errorf("%d requests were made — a credential the API rejected once is rejected every time, at the same price", len(seen()))
	}
}

func TestATruncatedAnswerSaysSoRatherThanLookingWhole(t *testing.T) {
	base, _ := serve(t, stream(strings.Join([]string{
		data(`{"type": "response.output_text.delta", "output_index": 0, "delta": "Half an ans"}`),
		data(`{"type": "response.incomplete", "response": {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "usage": {"input_tokens": 7, "output_tokens": 3}}}`),
	}, "")))
	got := drain(t, open(t, base, "sk-key", false), turn())

	var degraded *events.Degraded
	for _, p := range got {
		if d, ok := p.(events.Degraded); ok {
			degraded = &d
		}
	}
	if degraded == nil {
		t.Fatal("a truncated answer reached the caller looking finished")
	}
	if !strings.Contains(strings.Join(degraded.Missing, " "), "token cap") {
		t.Errorf("the caveat does not say what is missing: %v", degraded.Missing)
	}
}

func TestATurnTheAPIDidNotPriceSaysNobodySaid(t *testing.T) {
	base, _ := serve(t, stream(strings.Join([]string{
		data(`{"type": "response.output_text.delta", "output_index": 0, "delta": "Hi"}`),
		data(`{"type": "response.completed", "response": {"status": "completed"}}`),
	}, "")))
	got := drain(t, open(t, base, "sk-key", false), turn())

	for _, p := range got {
		if _, ok := p.(events.Usage); ok {
			t.Fatal("a turn nobody priced yielded a Usage — silence is not the same as free")
		}
	}
	var degraded bool
	for _, p := range got {
		if _, ok := p.(events.Degraded); ok {
			degraded = true
		}
	}
	if !degraded {
		t.Error("the absence of a cost went unmarked")
	}
}

func TestAnAnswerStatedOnlyAtTheEndIsStillAnAnswer(t *testing.T) {
	// The subscription backend has served turns whose text arrives only in
	// the assembled item, and its terminal frame omits the output array — so
	// the item is the one place the answer exists.
	base, _ := serve(t, stream(strings.Join([]string{
		data(`{"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "content": [{"type": "output_text", "text": "All at once"}]}}`),
		data(`{"type": "response.completed", "response": {"status": "completed", "usage": {"input_tokens": 1, "output_tokens": 1}}}`),
	}, "")))
	got := drain(t, open(t, base, subscriptionToken(t, "acct_1"), true), turn())

	if said := folded(got); said != "All at once" {
		t.Errorf("the turn said %q, want the assembled item's text", said)
	}
}

func TestAStreamThatEndsMidTurnIsAFailureNotAnAnswer(t *testing.T) {
	base, _ := serve(t, stream(data(`{"type": "response.output_text.delta", "output_index": 0, "delta": "Hal"}`)))
	s := open(t, base, "sk-key", false).Stream(context.Background(), turn())
	defer func() { _ = s.Close() }()

	var sawText bool
	for {
		payload, err := s.Next(context.Background())
		if err != nil {
			if errors.Is(err, io.EOF) {
				t.Fatal("a stream that broke mid-turn ended as if the turn completed")
			}
			break
		}
		if _, ok := payload.(events.Text); ok {
			sawText = true
		}
	}
	if !sawText {
		t.Error("the text that did arrive was withheld — a payload already produced is part of the turn")
	}
}

func TestAProviderWithNoCredentialIsRefusedAtConstruction(t *testing.T) {
	_, err := openai.New(providers.Options{})
	if err == nil {
		t.Fatal("a Provider with no credential was built")
	}

	_, err = openai.New(providers.Options{
		Credential: providers.Subscription(func() (string, error) {
			return "", errors.New("not logged in to openai: run `eva login`")
		}),
	})
	if err == nil || !strings.Contains(err.Error(), "eva login") {
		t.Errorf("a person who never logged in is not told to at startup: %v", err)
	}
}

func TestASubscriptionCredentialThatIsNotALoginsTokenFailsTheTurn(t *testing.T) {
	base, _ := serve(t)
	s := open(t, base, "sk-plain-key", true).Stream(context.Background(), turn())
	defer func() { _ = s.Close() }()

	_, err := s.Next(context.Background())
	if err == nil {
		t.Fatal("a plain key was sent to the subscription backend, which cannot accept one")
	}
	if !strings.Contains(err.Error(), "access token") {
		t.Errorf("the failure does not say what the credential is not: %v", err)
	}
}

// The Provider contract, driven through the seam every Provider shares. Both
// transports are driven, because a transport is a way this Provider answers and
// the contract is the same either way.
func TestOpenAIKeepsTheProviderContract(t *testing.T) {
	for _, mode := range []struct {
		name         string
		subscription bool
		credential   string
	}{
		{name: "api key", credential: "sk-key"},
		{name: "subscription", subscription: true},
	} {
		t.Run(mode.name, func(t *testing.T) {
			credential := mode.credential
			if mode.subscription {
				credential = subscriptionToken(t, "acct_contract")
			}
			providertest.Run(t, providertest.Contract{
				Answers: func(t *testing.T) providers.Provider {
					base, _ := serve(t, stream(answered()))
					return open(t, base, credential, mode.subscription)
				},
				Unpriced: func(t *testing.T) providers.Provider {
					base, _ := serve(t, stream(strings.Join([]string{
						data(`{"type": "response.output_text.delta", "output_index": 0, "delta": "unpriced"}`),
						data(`{"type": "response.completed", "response": {"status": "completed"}}`),
						data("[DONE]"),
					}, "")))
					return open(t, base, credential, mode.subscription)
				},
				Call: turn(),
			})
		})
	}
}

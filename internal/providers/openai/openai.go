package openai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/providers/retry"
)

// Name is what configuration selects this Provider by.
const Name = "openai"

// The two endpoints one Provider can answer from. The public API takes an API
// key; the subscription backend takes a login's access token and serves the
// same Responses shape from a different host.
const (
	defaultAPIBase          = "https://api.openai.com/v1"
	defaultSubscriptionBase = "https://chatgpt.com/backend-api/codex"
)

// This Provider puts itself in the set configuration can select. The layer
// that wires a run therefore names it once, as an import, rather than knowing
// how to build it.
func init() {
	providers.Register(Name, func(o providers.Options) (providers.Provider, error) {
		return New(Options{
			Credential:   o.Credential,
			Subscription: o.Subscription,
			BaseURL:      o.BaseURL,
			MaxTokens:    o.MaxTokens,
		})
	})
}

// Options is everything the Provider needs to reach the API.
type Options struct {
	// Credential resolves the secret each attempt authenticates with.
	//
	// It stays a function here rather than being resolved to a string at
	// construction, because a subscription token renews under a long session:
	// the attempt made an hour in must send the token that is live an hour
	// in, not the one that was live at startup.
	Credential func() (string, error)

	// Subscription selects the login transport: the subscription backend's
	// host, and the headers it requires beyond the bearer token.
	Subscription bool

	// BaseURL points the client somewhere other than the mode's own endpoint —
	// a gateway, a proxy, or the recorded server a test runs against.
	BaseURL string

	// MaxTokens caps one answer. Zero leaves the cap to the API, which has a
	// default of its own — unlike Anthropic's, which requires one.
	MaxTokens int64

	// Retry is how a refused attempt is retried. The zero value takes the
	// shared default.
	Retry retry.Policy
}

// Provider answers turns from the Responses API.
type Provider struct {
	credential   func() (string, error)
	subscription bool
	endpoint     string
	maxTokens    int64
	retry        retry.Policy
	httpc        *http.Client
}

var _ providers.Provider = (*Provider)(nil)

// New builds a Provider, or reports what it cannot be built without.
//
// The credential is resolved once here so that a missing one — an empty
// variable, a login that never happened — fails at startup in a sentence
// naming the fix, rather than on the first turn a person asks.
func New(o Options) (*Provider, error) {
	if o.Credential == nil {
		return nil, errors.New("openai: no credential")
	}
	if _, err := o.Credential(); err != nil {
		return nil, err
	}

	base := o.BaseURL
	if base == "" {
		base = defaultAPIBase
		if o.Subscription {
			base = defaultSubscriptionBase
		}
	}

	return &Provider{
		credential:   o.Credential,
		subscription: o.Subscription,
		endpoint:     strings.TrimRight(base, "/") + "/responses",
		maxTokens:    o.MaxTokens,
		retry:        o.Retry.OrDefault(),
		// The timeout bounds one whole attempt, streaming included. A turn
		// can talk for minutes; a turn cannot talk for ever.
		httpc: &http.Client{Timeout: 5 * time.Minute},
	}, nil
}

// Name reports the name configuration selects this Provider by.
func (p *Provider) Name() string { return Name }

// Stream begins one turn.
//
// Nothing is sent here. The request is made on the first read, because an
// attempt that failed is reported as a payload, and a caller that never read
// the Stream would never see the retries that preceded the answer.
func (p *Provider) Stream(ctx context.Context, call providers.Call) (providers.Stream, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	body, err := request(call, p.maxTokens, p.subscription)
	if err != nil {
		return nil, err
	}
	return &stream{provider: p, body: body}, nil
}

// request maps the transcript onto the API's own shape.
//
// The Responses API takes the system prompt as one instructions string and
// the rest of the transcript as input items, with the word "role" for what
// the glossary calls an Author; the mapping between the two vocabularies
// lives here and nowhere else.
func request(call providers.Call, maxTokens int64, subscription bool) ([]byte, error) {
	if call.Model == "" {
		return nil, errors.New("openai: the turn names no model")
	}

	req := wireRequest{
		Model:           call.Model,
		MaxOutputTokens: maxTokens,
		// Nothing is persisted server-side: the Trace is the record, and every
		// turn replays the transcript it is conditioned on.
		Store:  false,
		Stream: true,
	}

	var system []string
	for _, m := range call.Messages {
		if m.Text == "" {
			// An empty Message says nothing the answer can be conditioned on.
			continue
		}
		switch m.Author {
		case core.AuthorSystem:
			system = append(system, m.Text)
		case core.AuthorUser:
			req.Input = append(req.Input, wireItem{
				Type: "message", Role: "user",
				Content: []wirePart{{Type: "input_text", Text: m.Text}},
			})
		case core.AuthorAssistant:
			req.Input = append(req.Input, wireItem{
				Type: "message", Role: "assistant",
				Content: []wirePart{{Type: "output_text", Text: m.Text}},
			})
		default:
			return nil, fmt.Errorf("openai: %q is not an Author this Provider can send", m.Author)
		}
	}
	req.Instructions = strings.Join(system, "\n\n")
	// The subscription backend rejects a request with no instructions, so a
	// turn that somehow carries no system prompt is given the emptiest one
	// there is rather than being refused.
	if subscription && req.Instructions == "" {
		req.Instructions = "You are a helpful assistant."
	}

	if len(req.Input) == 0 {
		return nil, errors.New("openai: the turn has no transcript to answer")
	}
	return json.Marshal(req)
}

// The wire types, shaped by the API rather than by the domain: input items
// are a discriminated union and a message's parts carry a direction in their
// type, so the same text is input_text from a person and output_text echoed
// back from a prior answer.
type wireRequest struct {
	Model           string     `json:"model"`
	Instructions    string     `json:"instructions,omitempty"`
	Input           []wireItem `json:"input"`
	MaxOutputTokens int64      `json:"max_output_tokens,omitempty"`
	Store           bool       `json:"store"`
	Stream          bool       `json:"stream"`
}

type wireItem struct {
	Type    string     `json:"type"`
	Role    string     `json:"role"`
	Content []wirePart `json:"content"`
}

type wirePart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// accountID reads the ChatGPT account id out of a subscription access token.
//
// The subscription backend requires the id as a header on every request, and
// the token is a JWT that carries it in a namespaced claim — the credential's
// own shape, so the Provider that speaks that wire reads it here rather than
// being handed a second value that could disagree with the first. The login
// flow refuses a token without the claim, so failing here means the token
// came from somewhere other than a login.
func accountID(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("openai: the subscription credential is not a login's access token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return "", fmt.Errorf("openai: decode the access token: %w", err)
	}
	var claims struct {
		Auth struct {
			ChatGPTAccountID string `json:"chatgpt_account_id"`
		} `json:"https://api.openai.com/auth"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", fmt.Errorf("openai: parse the access token: %w", err)
	}
	if claims.Auth.ChatGPTAccountID == "" {
		return "", errors.New("openai: the access token carries no account id")
	}
	return claims.Auth.ChatGPTAccountID, nil
}

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

// This Provider puts itself in the set configuration can select. The layer
// that wires a run therefore names it once, as an import, rather than knowing
// how to build it.
func init() {
	providers.Register(Name, func(o providers.Options) (providers.Provider, error) { return New(o) })
}

// Provider answers turns from the Responses API.
type Provider struct {
	credential providers.Credential
	transport  transport
	maxTokens  int64
	retry      retry.Policy
	httpc      *http.Client
}

var _ providers.Provider = (*Provider)(nil)

// New builds a Provider, or reports what it cannot be built without.
//
// A missing credential — an empty variable, a login that never happened —
// fails here, at startup, in a sentence naming the fix rather than on the first
// turn a person asks. What it holds is not resolved here: an access token
// renews under a long session, so the value is obtained per attempt and a copy
// taken now would be the wrong one within the hour.
func New(o providers.Options) (*Provider, error) {
	if !o.Credential.Present() {
		return nil, errors.New("openai: no credential")
	}
	if err := o.Credential.Available(); err != nil {
		return nil, err
	}

	// The mode alone decides which transport answers, so the choice is made
	// once, here, from the one value that carries it.
	pick := apiKeyTransport
	if o.Credential.Mode() == providers.ModeSubscription {
		pick = subscriptionTransport
	}

	return &Provider{
		credential: o.Credential,
		transport:  pick(o.BaseURL),
		maxTokens:  o.MaxTokens,
		retry:      o.Retry.OrDefault(),
		// The timeout bounds one whole attempt, streaming included. A turn
		// can talk for minutes; a turn cannot talk for ever.
		httpc: &http.Client{Timeout: 5 * time.Minute},
	}, nil
}

// Stream begins one turn.
//
// Nothing is sent here. The request is made on the first read, because an
// attempt that failed is reported as a payload, and a caller that never read
// the Stream would never see the retries that preceded the answer. A Call this
// Provider cannot send fails from that first read too, so a turn has one place
// it goes wrong.
func (p *Provider) Stream(_ context.Context, call providers.Call) providers.Stream {
	body, err := request(call, p.maxTokens, p.transport.instructions)
	if err != nil {
		return providers.Failed(err)
	}
	return providers.Drive(&wire{provider: p, body: body}, p.retry)
}

// request maps the transcript onto the API's own shape.
//
// The Responses API takes the system prompt as one instructions string and
// the rest of the transcript as input items, with the word "role" for what
// the glossary calls an Author; the mapping between the two vocabularies
// lives here and nowhere else.
func request(call providers.Call, maxTokens int64, fallback string) ([]byte, error) {
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
	// What a turn carrying no system prompt sends is the transport's, because
	// it is the transport that will or will not accept one.
	if req.Instructions == "" {
		req.Instructions = fallback
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

// tokenClaims is the part of a login's access token this Provider reads.
type tokenClaims struct {
	Auth struct {
		ChatGPTAccountID string `json:"chatgpt_account_id"`
	} `json:"https://api.openai.com/auth"`
}

// claims reads the payload of a login's access token.
//
// The token is a JWT and this reads one claim out of it; it does not verify a
// signature, because this is not the party the token is presented to. What the
// claim is used for is written where it is used.
func claims(token string) (tokenClaims, error) {
	var out tokenClaims

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return out, errors.New("openai: the subscription credential is not a login's access token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return out, fmt.Errorf("openai: decode the access token: %w", err)
	}
	if err := json.Unmarshal(payload, &out); err != nil {
		return out, fmt.Errorf("openai: parse the access token: %w", err)
	}
	return out, nil
}

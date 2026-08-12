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

const Name = "openai"

// This Provider puts itself in the set configuration can select. The layer
// that wires a run therefore names it once, as an import, rather than knowing
// how to build it.
func init() {
	providers.Register(Name, func(o providers.Options) (providers.Provider, error) { return New(o) })
}

type Provider struct {
	credential providers.Credential
	transport  transport
	maxTokens  int64
	retry      retry.Policy
	httpc      *http.Client
}

var _ providers.Provider = (*Provider)(nil)

// New builds a Provider, or reports what it cannot be built without.
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

func (p *Provider) Stream(_ context.Context, call providers.Call) providers.Stream {
	body, err := request(call, p.maxTokens, p.transport.instructions)
	if err != nil {
		return providers.Failed(err)
	}
	return providers.Drive(&wire{provider: p, body: body}, p.retry)
}

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
		// The system prompt is one instructions string on this API rather than
		// an input item, so it is gathered rather than appended.
		if m.Author == core.AuthorSystem {
			if words := m.Said(); words != "" {
				system = append(system, words)
			}
			continue
		}

		// A block this Provider cannot send fails the turn rather than being
		// left out: a transcript with a tool call dropped from it asks the model
		// to continue without knowing what it did. The tool blocks are the ones
		// no wire sends today, because nothing yet calls a tool — the mapping
		// lands with the tool registry that produces them.
		words, err := sendable(m.Blocks)
		if err != nil {
			return nil, err
		}
		if words == "" {
			// An entry that says nothing is nothing the answer can be
			// conditioned on.
			continue
		}

		switch m.Author {
		case core.AuthorUser:
			req.Input = append(req.Input, wireItem{
				Type: "message", Role: "user",
				Content: []wirePart{{Type: "input_text", Text: words}},
			})
		case core.AuthorAssistant:
			req.Input = append(req.Input, wireItem{
				Type: "message", Role: "assistant",
				Content: []wirePart{{Type: "output_text", Text: words}},
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

func sendable(blocks []core.Block) (string, error) {
	var words string
	for _, block := range blocks {
		text, isText := block.(core.Text)
		if !isText {
			return "", fmt.Errorf("openai: this Provider cannot send a %T", block)
		}
		words += text.Text
	}
	return words, nil
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

type tokenClaims struct {
	Auth struct {
		ChatGPTAccountID string `json:"chatgpt_account_id"`
	} `json:"https://api.openai.com/auth"`
}

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

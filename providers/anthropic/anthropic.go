package anthropic

import (
	"context"
	"errors"
	"fmt"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/providers"
)

// Name is what configuration selects this Provider by.
const Name = "anthropic"

// DefaultMaxTokens caps one answer when the caller chooses no cap of its own.
// The API requires one and has no default, so a turn always runs under a
// number — and a turn that ran under this one and hit it says so, rather than
// returning a truncated answer that looks whole.
const DefaultMaxTokens int64 = 8192

// Options is everything the Provider needs to reach the API.
type Options struct {
	// APIKey is the credential.
	//
	// It is a plain string because the type that stops a credential printing
	// itself lives in config, and a provider may not import config. The call
	// site therefore reveals the secret to pass it, which is exactly where
	// that step should be visible.
	APIKey string

	// BaseURL points the client somewhere other than the public API — a
	// gateway, a proxy, or the recorded server a test runs against. Empty is
	// the public API.
	BaseURL string

	// MaxTokens caps one answer. Zero takes DefaultMaxTokens.
	MaxTokens int64

	// Retry is how a refused attempt is retried. The zero value takes
	// DefaultPolicy.
	Retry Policy
}

// Provider answers turns from the Anthropic Messages API.
type Provider struct {
	client    sdk.Client
	maxTokens int64
	retry     Policy
}

var _ providers.Provider = (*Provider)(nil)

// New builds a Provider, or reports what it cannot be built without.
func New(o Options) (*Provider, error) {
	if o.APIKey == "" {
		return nil, errors.New("anthropic: no API key")
	}

	opts := []option.RequestOption{
		option.WithAPIKey(o.APIKey),
		// The SDK retries twice by default, inside the call, where nothing
		// can see it. An attempt that spent money and produced nothing is a
		// record this project keeps, so the retrying is done here instead.
		option.WithMaxRetries(0),
	}
	if o.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(o.BaseURL))
	}

	maxTokens := o.MaxTokens
	if maxTokens <= 0 {
		maxTokens = DefaultMaxTokens
	}
	return &Provider{
		client:    sdk.NewClient(opts...),
		maxTokens: maxTokens,
		retry:     o.Retry.orDefault(),
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

	params, err := request(call, p.maxTokens)
	if err != nil {
		return nil, err
	}
	return &stream{provider: p, params: params}, nil
}

// request maps the transcript onto the API's own shape.
//
// The word this API uses for who said a Message is "role", which the glossary
// retires in favour of Author; the mapping between them lives here and nowhere
// else. A system Message is not a turn in the conversation, so it becomes the
// system prompt rather than a message with a third role.
func request(call providers.Call, maxTokens int64) (sdk.MessageNewParams, error) {
	if call.Model == "" {
		return sdk.MessageNewParams{}, errors.New("anthropic: the turn names no model")
	}

	params := sdk.MessageNewParams{
		Model:     sdk.Model(call.Model),
		MaxTokens: maxTokens,
	}

	for _, m := range call.Messages {
		if m.Text == "" {
			// The API rejects an empty content block, and an empty Message
			// says nothing the answer can be conditioned on.
			continue
		}
		switch m.Author {
		case core.AuthorSystem:
			params.System = append(params.System, sdk.TextBlockParam{Text: m.Text})
		case core.AuthorUser:
			params.Messages = append(params.Messages, sdk.NewUserMessage(sdk.NewTextBlock(m.Text)))
		case core.AuthorAssistant:
			params.Messages = append(params.Messages, sdk.NewAssistantMessage(sdk.NewTextBlock(m.Text)))
		default:
			return sdk.MessageNewParams{}, fmt.Errorf("anthropic: %q is not an Author this Provider can send", m.Author)
		}
	}

	if len(params.Messages) == 0 {
		return sdk.MessageNewParams{}, errors.New("anthropic: the turn has no transcript to answer")
	}
	return params, nil
}

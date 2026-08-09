package anthropic

import (
	"context"
	"errors"
	"fmt"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/providers/retry"
)

// Name is what configuration selects this Provider by.
const Name = "anthropic"

// This Provider puts itself in the set configuration can select. The layer that
// wires a run therefore names it once, as an import, rather than knowing how to
// build it.
func init() {
	providers.Register(Name, func(o providers.Options) (providers.Provider, error) { return New(o) })
}

// DefaultMaxTokens caps one answer when the caller chooses no cap of its own.
// The API requires one and has no default, so a turn always runs under a
// number — and a turn that ran under this one and hit it says so, rather than
// returning a truncated answer that looks whole.
const DefaultMaxTokens int64 = 8192

// Provider answers turns from the Anthropic Messages API.
type Provider struct {
	client    sdk.Client
	maxTokens int64
	retry     retry.Policy
}

var _ providers.Provider = (*Provider)(nil)

// New builds a Provider, or reports what it cannot be built without.
//
// The credential is resolved here rather than per attempt, because the one mode
// this Provider serves is an API key and an API key does not renew. A
// subscription is refused rather than tried: this vendor's login is not a thing
// Eva can obtain today, and a Provider that accepted the mode and then sent the
// token as an `x-api-key` would fail on the wire with a sentence about the key
// rather than about the mode that was never going to work.
func New(o providers.Options) (*Provider, error) {
	if !o.Credential.Present() {
		return nil, errors.New("anthropic: no API key")
	}
	if o.Credential.Mode() != providers.ModeAPIKey {
		return nil, fmt.Errorf("anthropic: this Provider authenticates with an API key, and the credential is a %s", o.Credential.Mode())
	}
	key, err := o.Credential.Resolve()
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, errors.New("anthropic: no API key")
	}

	opts := []option.RequestOption{
		option.WithAPIKey(key),
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
		retry:     o.Retry.OrDefault(),
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
	params, err := request(call, p.maxTokens)
	if err != nil {
		return providers.Failed(err)
	}
	return providers.Drive(&wire{provider: p, params: params}, p.retry)
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

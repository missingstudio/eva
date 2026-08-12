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

type Provider struct {
	client    sdk.Client
	maxTokens int64
	retry     retry.Policy
}

var _ providers.Provider = (*Provider)(nil)

// New builds a Provider, or reports what it cannot be built without.
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

func (p *Provider) Stream(_ context.Context, call providers.Call) providers.Stream {
	params, err := request(call, p.maxTokens)
	if err != nil {
		return providers.Failed(err)
	}
	return providers.Drive(&wire{provider: p, params: params}, p.retry)
}

func request(call providers.Call, maxTokens int64) (sdk.MessageNewParams, error) {
	if call.Model == "" {
		return sdk.MessageNewParams{}, errors.New("anthropic: the turn names no model")
	}

	params := sdk.MessageNewParams{
		Model:     sdk.Model(call.Model),
		MaxTokens: maxTokens,
	}

	for _, m := range call.Messages {
		// The system prompt is not a turn in the conversation, and this API
		// takes it as its own field rather than as a message with a third role.
		if m.Author == core.AuthorSystem {
			if words := m.Said(); words != "" {
				params.System = append(params.System, sdk.TextBlockParam{Text: words})
			}
			continue
		}

		content, err := content(m.Blocks)
		if err != nil {
			return sdk.MessageNewParams{}, err
		}
		if len(content) == 0 {
			// The API rejects an empty content list, and an entry that says
			// nothing is nothing the answer can be conditioned on.
			continue
		}

		switch m.Author {
		case core.AuthorUser:
			params.Messages = append(params.Messages, sdk.NewUserMessage(content...))
		case core.AuthorAssistant:
			params.Messages = append(params.Messages, sdk.NewAssistantMessage(content...))
		default:
			return sdk.MessageNewParams{}, fmt.Errorf("anthropic: %q is not an Author this Provider can send", m.Author)
		}
	}

	if len(params.Messages) == 0 {
		return sdk.MessageNewParams{}, errors.New("anthropic: the turn has no transcript to answer")
	}
	return params, nil
}

func content(blocks []core.Block) ([]sdk.ContentBlockParamUnion, error) {
	out := make([]sdk.ContentBlockParamUnion, 0, len(blocks))
	for _, block := range blocks {
		text, isText := block.(core.Text)
		if !isText {
			return nil, fmt.Errorf("anthropic: this Provider cannot send a %T", block)
		}
		if text.Text == "" {
			continue
		}
		out = append(out, sdk.NewTextBlock(text.Text))
	}
	return out, nil
}

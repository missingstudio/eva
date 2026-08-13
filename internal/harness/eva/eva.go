package eva

import (
	"errors"

	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/harness"
)

// Name is what configuration selects Eva's own Harness by, and it is the one
// place that name lives.
const Name = "eva"

func init() {
	harness.Register(Name, build)
}

func build(o harness.Options) (harness.Harness, error) {
	if o.Provider == nil {
		return nil, errors.New("eva: this Harness answers with a Provider, and it was given none")
	}
	return &Loop{
		Provider:     o.Provider,
		ProviderName: o.ProviderName,
		// The base system prompt is the same for every turn of this build, and
		// its size is gated in CI, so what every Run of Eva spends before the
		// first word of the transcript is a figure the repository states.
		SystemPrompt: prompt.Base(),
	}, nil
}

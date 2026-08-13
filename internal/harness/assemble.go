package harness

import (
	"fmt"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/trace"
)

// Credentials is what configuration alone cannot state. A Credential is
// obtained by an act a person performs, so the Frontend that performs it hands
// the resolver in rather than this layer learning how a login works.
type Credentials struct {
	// Subscription resolves the access token a subscription turn sends. It is
	// nil when nothing can resolve one, which is a refusal rather than a
	// fallback: the configured mode alone decides which credential a turn uses.
	Subscription func() (string, error)
}

// Assemble builds one Session's worth of everything a turn is answered with, as
// configuration states it: the Harness that answers, the Provider it reaches,
// the sink every Event lands in, and the Session all of it folds into. The
// Assembly it returns holds the Trace open, so a caller closes it.
func Assemble(cfg config.Config, creds Credentials) (*Assembly, error) {
	provider, err := openProvider(cfg, creds)
	if err != nil {
		return nil, err
	}

	unit, err := Open(cfg.Harness, Options{Provider: provider, ProviderName: cfg.Provider.Name})
	if err != nil {
		return nil, fmt.Errorf("%w (in %s)", err, cfg.Path)
	}

	sink, err := trace.New(cfg.Trace.Kind, trace.Options{Path: cfg.Trace.Path})
	if err != nil {
		// Named with the file, as the Harness and the Provider are. Every
		// refusal here is about a setting somebody wrote, and a person told
		// what is wrong without being told where is told half of it.
		return nil, fmt.Errorf("%w (in %s)", err, cfg.Path)
	}

	assembly, err := New(AssemblyOptions{
		Harness:      unit,
		Sink:         sink,
		Session:      core.NewSession(newSessionID(), cfg.Tenant(), cfg.Actor(), origin()),
		Model:        cfg.Model,
		NewSessionID: newSessionID,
	})
	if err != nil {
		// The sink is open and nothing is going to write to it. Its own failure
		// to close on the way back out is not what a person has to hear about
		// instead of the assembly that would not build.
		_ = sink.Close()
		return nil, err
	}
	return assembly, nil
}

// openProvider resolves the credential the configured mode names and opens the
// Provider that sends it.
func openProvider(cfg config.Config, creds Credentials) (providers.Provider, error) {
	// Resolving the credential is deferred to the Provider that needs one: a
	// Provider that sends nothing must not fail for want of a key it never
	// sends. Reveal is the one place the secret leaves the type that stops it
	// printing itself, and it happens inside this call.
	credential := providers.APIKey(func() (string, error) {
		key, err := cfg.RequireAPIKey()
		if err != nil {
			return "", err
		}
		return key.Reveal(), nil
	})

	if cfg.Subscription() {
		if creds.Subscription == nil {
			return nil, fmt.Errorf("provider.auth is %q in %s, and nothing here can resolve a login",
				config.AuthSubscription, cfg.Path)
		}
		credential = providers.Subscription(creds.Subscription)
	}

	provider, err := providers.Open(cfg.Provider.Name, providers.Options{
		Credential: credential,
		BaseURL:    cfg.Provider.BaseURL,
		MaxTokens:  cfg.Provider.MaxTokens,
	})
	if err != nil {
		return nil, fmt.Errorf("%w (in %s)", err, cfg.Path)
	}
	return provider, nil
}

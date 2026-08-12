package cli

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/auth"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
)

// A remedy is Evidence, not advice. These tests put a machine in front of the
// resolver and ask what it established — never what it would like to suggest.

func stored(creds auth.Credentials) func(string) (auth.Credentials, bool, error) {
	return func(string) (auth.Credentials, bool, error) { return creds, true, nil }
}

func empty() func(string) (auth.Credentials, bool, error) {
	return func(string) (auth.Credentials, bool, error) { return auth.Credentials{}, false, nil }
}

func live() auth.Credentials {
	return auth.Credentials{
		AccountID:    "acct_42",
		RefreshToken: "renewable",
		ExpiresAt:    time.Now().Add(time.Hour),
	}
}

func TestARefusedCredentialNamesTheCredential(t *testing.T) {
	for _, c := range []struct {
		name  string
		eva   *eva
		says  []string
		types string
	}{
		{
			name: "a key is named by its variable, and there is nothing to type",
			eva: &eva{providerName: "anthropic", checks: checks{
				keyEnv: "ANTHROPIC_API_KEY",
			}},
			says: []string{"$ANTHROPIC_API_KEY", "anthropic"},
		},
		{
			name: "no login stored is the one thing logging in fixes",
			eva: &eva{providerName: "openai", checks: checks{
				subscription: true,
				login:        empty(),
			}},
			says:  []string{"no openai login is stored"},
			types: "eva login",
		},
		{
			name: "an expired login with nothing to renew it is the other",
			eva: &eva{providerName: "openai", checks: checks{
				subscription: true,
				login: stored(auth.Credentials{
					AccountID: "acct_42",
					ExpiresAt: time.Now().Add(-time.Hour),
				}),
			}},
			says:  []string{"acct_42", "expired"},
			types: "eva login",
		},
		{
			name: "a live login says so, so that nobody logs in again to no effect",
			eva: &eva{providerName: "openai", checks: checks{
				subscription: true,
				login:        stored(live()),
			}},
			says: []string{"acct_42", "has not expired"},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := c.eva.Remedy(events.ErrorAuthFailed)

			for _, want := range c.says {
				if !strings.Contains(got.Because, want) {
					t.Errorf("the fact does not say %q: %q", want, got.Because)
				}
			}
			if got.Do != c.types {
				t.Errorf("the step is %q, want %q", got.Do, c.types)
			}
		})
	}
}

// A store that cannot be read establishes nothing, and says nothing.
func TestAnUnreadableStoreEstablishesNothing(t *testing.T) {
	e := &eva{providerName: "openai", checks: checks{
		subscription: true,
		login: func(string) (auth.Credentials, bool, error) {
			return auth.Credentials{}, false, errors.New("permission denied")
		},
	}}

	if got := e.Remedy(events.ErrorAuthFailed); got != (render.Remedy{}) {
		t.Errorf("an unreadable store produced %+v, want nothing established", got)
	}
}

func TestAModelIsReportedAgainstWhereItWasChosen(t *testing.T) {
	e := &eva{
		providerName: "openai",
		model:        selection{name: "gpt-nonexistent"},
		checks:       checks{configPath: "/home/p/.eva/config.toml"},
	}

	named := e.Remedy(events.ErrorNoSuchModel)
	for _, want := range []string{"gpt-nonexistent", "/home/p/.eva/config.toml"} {
		if !strings.Contains(named.Because, want) {
			t.Errorf("the fact does not say %q: %q", want, named.Because)
		}
	}
	if named.Do != "" {
		t.Errorf("a model name Eva cannot supply came with %q to type", named.Do)
	}

	e.UseModel("gpt-also-nonexistent")
	chosen := e.Remedy(events.ErrorNoSuchModel)
	if !strings.Contains(chosen.Because, "/model") {
		t.Errorf("a model chosen in the Session is reported against the file: %q", chosen.Because)
	}
}

// An unreachable provider says where the turn was sent, but only when something
// on this machine chose somewhere.
func TestAnUnreachableProviderNamesOnlyAnOverride(t *testing.T) {
	overridden := &eva{providerName: "openai", checks: checks{
		baseURL:    "http://localhost:1234/v1",
		configPath: "/home/p/.eva/config.toml",
	}}
	got := overridden.Remedy(events.ErrorUnreachable)
	for _, want := range []string{"http://localhost:1234/v1", "provider.base_url", "/home/p/.eva/config.toml"} {
		if !strings.Contains(got.Because, want) {
			t.Errorf("the fact does not say %q: %q", want, got.Because)
		}
	}

	plain := &eva{providerName: "openai", checks: checks{configPath: "/home/p/.eva/config.toml"}}
	if said := plain.Remedy(events.ErrorUnreachable).Said(); said != "" {
		t.Errorf("with nothing overridden the remedy reads %q, want nothing established", said)
	}
}

// A turn nobody will bill names the account it would have been charged to,
// because settling one means knowing which.
func TestABilledTurnNamesTheAccountOrTheVariable(t *testing.T) {
	subscription := &eva{providerName: "openai", checks: checks{
		subscription: true,
		login:        stored(live()),
	}}
	if got := subscription.Remedy(events.ErrorBilling); !strings.Contains(got.Because, "acct_42") {
		t.Errorf("the fact does not name the account: %q", got.Because)
	}

	key := &eva{providerName: "anthropic", checks: checks{keyEnv: "ANTHROPIC_API_KEY"}}
	if got := key.Remedy(events.ErrorBilling); !strings.Contains(got.Because, "$ANTHROPIC_API_KEY") {
		t.Errorf("the fact does not name the variable: %q", got.Because)
	}
}

// The classes with nothing checkable behind them establish nothing, and that is
// the design rather than a gap in it.
func TestTheClassesWithNoLocalCauseSayNothing(t *testing.T) {
	// A fully configured machine, so that anything said would be said because
	// the class allowed it rather than because there was nothing to read.
	e := &eva{providerName: "openai", model: selection{name: "gpt-5"}, checks: checks{
		subscription: true,
		baseURL:      "http://localhost:1234/v1",
		keyEnv:       "OPENAI_API_KEY",
		configPath:   "/home/p/.eva/config.toml",
		login:        stored(live()),
	}}

	silent := map[events.ErrorClass]bool{
		events.ErrorRateLimit:   true,
		events.ErrorOverloaded:  true,
		events.ErrorServerError: true,
		events.ErrorOther:       true,
	}

	for _, class := range events.ErrorClasses() {
		said := e.Remedy(class).Said()
		if silent[class] && said != "" {
			t.Errorf("%q established %q, and there is nothing on this machine to check for it", class, said)
		}
		if !silent[class] && said == "" {
			t.Errorf("%q established nothing on a machine every fact could be read from", class)
		}
	}

	// A failure nobody classified, and one from a build that knows a class this
	// one does not, are both machines with nothing to say about them.
	if said := e.Remedy("").Said(); said != "" {
		t.Errorf("an unclassified failure established %q", said)
	}
	if said := e.Remedy(events.ErrorClass("quantum_flux")).Said(); said != "" {
		t.Errorf("an unknown class established %q", said)
	}
}

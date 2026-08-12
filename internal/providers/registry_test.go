package providers_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/providers"
)

// stub is a Provider that answers nothing. What is under test is selection, not
// answering.
type stub struct{ name string }

func (s stub) Stream(context.Context, providers.Call) providers.Stream {
	return providers.Failed(errors.New("stub: this Provider does not answer"))
}

func TestARegisteredProviderIsSelectableByName(t *testing.T) {
	const name = "test-selectable"

	var built providers.Options
	providers.Register(name, func(o providers.Options) (providers.Provider, error) {
		built = o
		return stub{name: name}, nil
	})

	got, err := providers.Open(name, providers.Options{BaseURL: "https://gateway.example", MaxTokens: 512})
	if err != nil {
		t.Fatalf("a registered Provider did not open: %v", err)
	}
	// The name is the registry's key and lives nowhere else, so what proves the
	// right Provider was built is the Provider itself rather than a second copy
	// of the name it could answer with.
	if built, ok := got.(stub); !ok || built.name != name {
		t.Errorf("opened %#v, want the stub registered under %q", got, name)
	}
	if built.BaseURL != "https://gateway.example" || built.MaxTokens != 512 {
		t.Errorf("the Provider was built from %+v, want the settings Open was given", built)
	}
}

// The sentence naming what a person may choose is read from the registry, so it
// cannot be missing a Provider that works.
func TestTheUnknownProviderErrorNamesWhatIsRegistered(t *testing.T) {
	_, err := providers.Open("not-a-provider", providers.Options{})
	if err == nil {
		t.Fatal("opening an unregistered Provider succeeded")
	}

	for _, name := range providers.Names() {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("the error does not offer %q, which is registered: %v", name, err)
		}
	}
	if !strings.Contains(err.Error(), "not-a-provider") {
		t.Errorf("the error does not name what was asked for: %v", err)
	}
}

// A credential is resolved by the Provider that needs one, and never before.
func TestACredentialIsResolvedOnlyByAProviderThatAsks(t *testing.T) {
	var asked bool
	options := providers.Options{
		Credential: providers.APIKey(func() (string, error) {
			asked = true
			return "", errors.New("no API key")
		}),
	}

	providers.Register("test-incurious", func(providers.Options) (providers.Provider, error) {
		return stub{name: "test-incurious"}, nil
	})

	if _, err := providers.Open("test-incurious", options); err != nil {
		t.Fatalf("a Provider that needs no credential failed to open: %v", err)
	}
	if asked {
		t.Error("a Provider that sends nothing resolved a credential")
	}

	providers.Register("test-curious", func(o providers.Options) (providers.Provider, error) {
		if err := o.Credential.Available(); err != nil {
			return nil, err
		}
		return stub{name: "test-curious"}, nil
	})

	if _, err := providers.Open("test-curious", options); err == nil {
		t.Error("a Provider that needs a credential opened without one")
	}
	if !asked {
		t.Error("a Provider that needs a credential did not resolve one")
	}
}

// Two Providers answering to one name is a configuration that cannot mean one
// thing, and which one a person got would depend on link order.
func TestRegisteringOneNameTwiceIsRefused(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("registering a name twice was allowed")
		}
	}()

	providers.Register("test-twice", func(providers.Options) (providers.Provider, error) {
		return stub{name: "test-twice"}, nil
	})
	providers.Register("test-twice", func(providers.Options) (providers.Provider, error) {
		return stub{name: "test-twice"}, nil
	})
}

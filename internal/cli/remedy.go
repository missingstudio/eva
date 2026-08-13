package cli

import (
	"fmt"

	"github.com/missingstudio/eva/internal/auth"
	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
)

// checks is what this layer can establish about the machine a turn failed on:
// the configuration the Provider was opened with, and the store a login lives
// in.
type checks struct {
	// provider is what configuration selected the Provider by, which is what a
	// refusal names.
	provider string
	// model is the model the configuration names. A turn that failed on a
	// different one failed on a name chosen in the Session, and which of the
	// two it was decides where a person is sent.
	model string
	// subscription says the configured mode is a login rather than a key. The
	// mode alone decides which credential a turn sends, so it alone decides
	// which one a refusal is about.
	subscription bool
	// keyEnv is the variable an api_key mode reads, which is the whole of what
	// can be said about a key that was refused: what is wrong with it is the
	// vendor's to know.
	keyEnv string
	// baseURL is where a turn was pointed, and is empty when nothing pointed
	// it anywhere. It is the one cause of an unreachable provider that lives on
	// this machine rather than on the network.
	baseURL string
	// configPath is the file a person edits, named so that a fact about a
	// setting comes with somewhere to go.
	configPath string

	// login reads the auth store.
	login func(provider string) (auth.Credentials, bool, error)
}

// remedy is the whole of the checking, so that what a failed turn establishes
// can be put in front of a test without an assembly around it.
func (c checks) remedy(class events.ErrorClass, model string) render.Remedy {
	switch class {
	case events.ErrorAuthFailed:
		return c.credential(c.provider)
	case events.ErrorNoSuchModel:
		return c.namedModel(model)
	case events.ErrorBilling:
		return c.billing(c.provider)
	case events.ErrorUnreachable:
		return c.reached(c.provider)
	default:
		return render.Remedy{}
	}
}

func (c checks) credential(provider string) render.Remedy {
	if !c.subscription {
		// The mode alone decides, so the variable the file names is what was
		// sent — that much is certain. What is wrong with the key is not:
		// revoked, wrong organization, or an account somebody suspended all
		// arrive here identically. So it names the key and stops.
		return render.Remedy{
			Because: fmt.Sprintf("provider.auth is %q, so what %s refused is the key in $%s",
				config.AuthAPIKey, provider, c.keyEnv),
		}
	}

	creds, stored, err := c.login(provider)
	if err != nil {
		// The store could not be read, so nothing here was established. The
		// failure of the read is not this person's problem to hear about in the
		// middle of a turn that failed for another reason.
		return render.Remedy{}
	}

	switch {
	case !stored:
		return render.Remedy{
			Because: fmt.Sprintf("provider.auth is %q and no %s login is stored",
				config.AuthSubscription, provider),
			Do: "eva login",
		}
	case creds.Expired(0) && creds.RefreshToken == "":
		return render.Remedy{
			Because: fmt.Sprintf("the %s login for account %s expired with nothing to renew it",
				provider, creds.AccountID),
			Do: "eva login",
		}
	case creds.Expired(0):
		// It renews on the next turn on its own, so logging in again is fixing
		// something that is not what broke.
		return render.Remedy{
			Because: fmt.Sprintf("the %s login for account %s had expired and is renewed on the next turn",
				provider, creds.AccountID),
		}
	default:
		return render.Remedy{
			Because: fmt.Sprintf("the %s login for account %s has not expired, so logging in again is not what this needs",
				provider, creds.AccountID),
		}
	}
}

// namedModel names the model the Provider would not serve, and where a model is
// chosen. Which of the two files a person is sent to is read off the name
// itself: a model that is not the configured one is one this Session chose.
func (c checks) namedModel(model string) render.Remedy {
	if model != c.model {
		return render.Remedy{
			Because: fmt.Sprintf("the model is %q, chosen with /model in this Session rather than named in %s",
				model, c.configPath),
		}
	}
	return render.Remedy{
		Because: fmt.Sprintf("the model is %q, and %s is the file that names one",
			model, c.configPath),
	}
}

// billing names the account the turn would have been charged to, because
// settling one means knowing which.
func (c checks) billing(provider string) render.Remedy {
	if !c.subscription {
		return render.Remedy{
			Because: fmt.Sprintf("the turn would have billed whichever %s account the key in $%s belongs to",
				provider, c.keyEnv),
		}
	}

	creds, stored, err := c.login(provider)
	if err != nil || !stored {
		return render.Remedy{}
	}
	return render.Remedy{
		Because: fmt.Sprintf("the turn would have billed the %s account %s", provider, creds.AccountID),
	}
}

func (c checks) reached(provider string) render.Remedy {
	if c.baseURL == "" {
		return render.Remedy{}
	}
	return render.Remedy{
		Because: fmt.Sprintf("the turn went to %s, which provider.base_url names in %s, rather than to %s's own API",
			c.baseURL, c.configPath, provider),
	}
}

func storedLogin(provider string) (auth.Credentials, bool, error) {
	store, err := authStore()
	if err != nil {
		return auth.Credentials{}, false, err
	}
	return store.Get(provider)
}

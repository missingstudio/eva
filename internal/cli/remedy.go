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
//
// It holds the facts rather than the Config, for the reason every other layer
// gets facts: a remedy answers a question about a failure, not about a file.
// It is held at all because the answer is wanted at the failure, and by then
// the Config that would have carried it is long out of scope.
//
// The Provider's name is not in here. It is on the assembly already, and a
// second copy of one fact is a copy that can disagree with the first.
type checks struct {
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
	//
	// It is a function so that the store is read when a turn fails rather than
	// when the process starts — a login live at startup is the commonest thing
	// to have expired by the turn that fails — and so that a test can put a
	// machine in front of this without writing one to disk.
	login func(provider string) (auth.Credentials, bool, error)
}

// Remedy is what was checked about this machine after a turn failed this way.
//
// Four classes have something checkable behind them and the rest do not, which
// is the design rather than a gap in it. A rate limit, an overloaded vendor and
// a server that failed the request have no step on this side of the network,
// and inventing one for them would put a guess in Eva's own voice — worse than
// the silence it replaced, because a person sent to fix a thing that was never
// broken learns to stop reading the line.
//
// Every branch below names a fact this process established by reading its own
// configuration or its own auth store. None of them reads the provider's
// account of the failure, which stays in the Trace where the class already
// leaves it.
//
// The assembly hands over what it knows and establishes nothing itself. What a
// remedy is made of is the machine and the model this Session is answering
// with, and a dispatch that read half of each from a field of its own would be
// a second copy of a fact that could disagree with the first.
func (e *eva) Remedy(class events.ErrorClass) render.Remedy {
	return e.checks.remedy(class, e.providerName, e.model)
}

// remedy is the whole of the checking, so that what a failed turn establishes
// can be put in front of a test without an assembly around it.
func (c checks) remedy(class events.ErrorClass, provider string, model selection) render.Remedy {
	switch class {
	case events.ErrorAuthFailed:
		return c.credential(provider)
	case events.ErrorNoSuchModel:
		return c.namedModel(model)
	case events.ErrorBilling:
		return c.billing(provider)
	case events.ErrorUnreachable:
		return c.reached(provider)
	default:
		return render.Remedy{}
	}
}

// credential says which credential the Provider refused, and — where the store
// is what is wrong — the verb that fixes it.
//
// The four subscription branches are the four `eva auth status` reports, in the
// same words. They are the same question asked at two moments, and two sets of
// words for one machine state is two products a person has to reconcile.
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
// chosen.
//
// Which of the two it says is read from the selection rather than assumed. A
// Session that used /model is running a name that is in no file, and sending
// that person to edit one would send them to change a line that is not what
// answered.
func (c checks) namedModel(model selection) render.Remedy {
	if model.from == fromSession {
		return render.Remedy{
			Because: fmt.Sprintf("the model is %q, chosen with /model in this Session rather than named in %s",
				model.name, c.configPath),
		}
	}
	return render.Remedy{
		Because: fmt.Sprintf("the model is %q, and %s is the file that names one",
			model.name, c.configPath),
	}
}

// billing names the account the turn would have been charged to, because
// settling one means knowing which.
//
// Under a key it names the variable instead of the account. The account behind
// a key is the vendor's to know, and guessing at it would be inventing the one
// fact this line exists to supply.
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

// reached says where the turn was actually sent, when something on this machine
// chose somewhere.
//
// Nothing is said when nothing was overridden. An unreachable provider under
// the vendor's own host is a network to wait out or a vendor to wait out, and
// this layer cannot tell those apart — but a base_url somebody set is a fact
// about this machine, and it is the first thing to check because it is the only
// thing here anyone could have got wrong.
func (c checks) reached(provider string) render.Remedy {
	if c.baseURL == "" {
		return render.Remedy{}
	}
	return render.Remedy{
		Because: fmt.Sprintf("the turn went to %s, which provider.base_url names in %s, rather than to %s's own API",
			c.baseURL, c.configPath, provider),
	}
}

// storedLogin reads the auth store, and is what a remedy asks whether a login
// is there.
//
// It opens the store per call rather than holding one. The file is small, it is
// read only once a turn has already failed, and a store opened at startup would
// answer with what was true then — which is the one thing a remedy must not do.
func storedLogin(provider string) (auth.Credentials, bool, error) {
	store, err := authStore()
	if err != nil {
		return auth.Credentials{}, false, err
	}
	return store.Get(provider)
}

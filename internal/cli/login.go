package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/missingstudio/eva/internal/auth"
	"github.com/missingstudio/eva/internal/config"
)

// loginOpenAI runs the device-code flow. It is a variable so a test can log a
// person in against an approval of its own instead of a browser and a network;
// everything else runs the real flow.
var loginOpenAI = auth.LoginOpenAI

// authStore is the one file subscription Credentials live in. The path is
// composed here because auth does not know where Eva keeps its files, and
// config does not know there is an auth store — the layer that wires a run is
// the one place the two meet.
func authStore() (*auth.Store, error) {
	home, err := config.Home()
	if err != nil {
		return nil, err
	}
	return auth.NewStore(filepath.Join(home, "auth.json")), nil
}

func login(ctx context.Context, provider string, stdout io.Writer) error {
	switch provider {
	case "", auth.ProviderOpenAI:
	default:
		// A word Eva does not know is the command line's mistake, not the
		// network's, and a script is owed that distinction before it retries.
		return rejected(fmt.Errorf("%q is not a subscription Eva can log in to — only %q is today", provider, auth.ProviderOpenAI))
	}

	store, err := authStore()
	if err != nil {
		return err
	}

	creds, err := loginOpenAI(ctx, auth.LoginOptions{
		OnDeviceCode: func(verifyURL, userCode string) {
			_, _ = fmt.Fprintf(stdout,
				"Log in to OpenAI with this device code:\n\n    %s\n    Code: %s\n\nThe code expires, and it is yours alone — never share it.\nWaiting for the approval...\n",
				verifyURL, userCode)
		},
	})
	if err != nil {
		return err
	}
	if err := store.Set(auth.ProviderOpenAI, creds); err != nil {
		return err
	}

	// What is printed is where the login lives and who it is — never the
	// credential itself, which is a secret the moment it exists.
	_, _ = fmt.Fprintf(stdout,
		"\nLogged in to OpenAI as account %s.\nThe credential is stored in %s.\n\nTo answer turns with it, set in your configuration:\n\n    [provider]\n    name = %q\n    auth = %q\n",
		creds.AccountID, store.Path(), auth.ProviderOpenAI, config.AuthSubscription)
	return nil
}

// authStatus reports how each turn would authenticate: the mode, and whether
// the credential that mode needs is there. It names accounts, expiries, files,
// and variables — never token or key material.
func authStatus(cfg config.Config, stdout io.Writer) error {
	say := func(format string, a ...any) { _, _ = fmt.Fprintf(stdout, format, a...) }

	say("provider: %s\n", cfg.Provider.Name)
	say("auth:     %s\n", cfg.Provider.Auth)

	if !cfg.Subscription() {
		state := "is not set"
		if os.Getenv(cfg.Provider.APIKeyEnv) != "" {
			state = "is set"
		}
		say("key:      $%s %s\n", cfg.Provider.APIKeyEnv, state)
		return nil
	}

	store, err := authStore()
	if err != nil {
		return err
	}
	say("store:    %s\n", store.Path())

	creds, ok, err := store.Get(cfg.Provider.Name)
	if err != nil {
		return err
	}
	switch {
	case !ok:
		say("login:    none — run `eva login`\n")
	case !creds.Expired(0):
		say("login:    account %s, valid until %s\n", creds.AccountID, creds.ExpiresAt.Local().Format(time.RFC1123))
	case creds.RefreshToken != "":
		say("login:    account %s, expired — it is renewed on the next turn\n", creds.AccountID)
	default:
		say("login:    account %s, expired with nothing to renew it — run `eva login`\n", creds.AccountID)
	}

	// A set key under a subscription is the confusion this command exists to
	// dissolve: the mode decides, so the variable a person exported is named
	// as unused rather than silently losing to the login.
	if os.Getenv(cfg.Provider.APIKeyEnv) != "" {
		say("note:     $%s is set and unused — provider.auth decides, and it says %q\n", cfg.Provider.APIKeyEnv, cfg.Provider.Auth)
	}
	return nil
}

func subscriptionCredential(cfg config.Config) (func() (string, error), error) {
	store, err := authStore()
	if err != nil {
		return nil, err
	}
	source := auth.NewTokenSource(store, cfg.Provider.Name)
	return func() (string, error) {
		creds, err := source.Token(context.Background())
		if err != nil {
			return "", err
		}
		return creds.AccessToken, nil
	}, nil
}

package auth

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// refreshSkew is how far ahead of expiry a token is renewed, so a request
// never races the boundary with a token that dies mid-flight.
const refreshSkew = 5 * time.Minute

// TokenSource yields a valid subscription access token, renewing it through
// the Store when it nears expiry.
//
// It exists because a console session outlives an access token. The Provider
// resolves its credential per attempt, and this is what that resolution
// reaches: the current token when it is fresh, the renewed one when it was
// not, and an error naming the fix when there is nothing to renew.
type TokenSource struct {
	store *Store
	key   string

	// refresh renews a credential set from its refresh token. It is a field so
	// a test can renew against a server of its own; everything else uses
	// RefreshOpenAI.
	refresh func(ctx context.Context, httpc *http.Client, refreshToken string) (Credentials, error)

	// mu makes renewal single-flight within this process. It is held across
	// the network call on purpose: two callers finding one expired token would
	// otherwise both renew it, and the loser's refresh token may already be
	// dead when it tries.
	mu sync.Mutex
}

// NewTokenSource builds a TokenSource over the Credentials stored for key.
func NewTokenSource(store *Store, key string) *TokenSource {
	return &TokenSource{store: store, key: key, refresh: RefreshOpenAI}
}

// Token returns current, unexpired Credentials, renewing and persisting them
// first when they need it.
//
// The error text is product surface: a person who never logged in, and a
// person whose login has fully expired, are each told the command that fixes
// it rather than shown a token error to decode.
func (ts *TokenSource) Token(ctx context.Context) (Credentials, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	creds, ok, err := ts.store.Get(ts.key)
	if err != nil {
		return Credentials{}, err
	}
	if !ok {
		return Credentials{}, fmt.Errorf("not logged in to %s: run `eva login`", ts.key)
	}
	if !creds.Expired(refreshSkew) {
		return creds, nil
	}
	if creds.RefreshToken == "" {
		return Credentials{}, fmt.Errorf("the %s login has expired and left nothing to renew it with: run `eva login`", ts.key)
	}

	renewed, err := ts.refresh(ctx, nil, creds.RefreshToken)
	if err != nil {
		return Credentials{}, fmt.Errorf("auth: renew the %s login: %w", ts.key, err)
	}
	// Persisted before it is returned, so the next process starts from the
	// renewed credential rather than renewing again from one the server may
	// now refuse.
	if err := ts.store.Set(ts.key, renewed); err != nil {
		return Credentials{}, err
	}
	return renewed, nil
}

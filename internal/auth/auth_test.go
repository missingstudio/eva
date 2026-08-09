package auth

// These tests run the flows against a server of their own, so nothing here
// needs the network or a real account. The endpoints hang off one package
// variable for exactly this: a test swaps the base, and every URL the flow
// builds follows it.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// token mints a JWT-shaped access token carrying the account claim, signed by
// nobody. The flow reads claims and never verifies a signature — verification
// is the resource server's job, and these tests are the client.
func token(t *testing.T, accountID string) string {
	t.Helper()
	claims, err := json.Marshal(map[string]any{
		"https://api.openai.com/auth": map[string]string{"chatgpt_account_id": accountID},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := base64.RawURLEncoding.EncodeToString(claims)
	return "header." + payload + ".signature"
}

// server points the package at an httptest server for one test.
func server(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	before := authBase
	authBase = srv.URL
	t.Cleanup(func() { authBase = before })
	return srv
}

// approval is a device flow scripted end to end: a user code, a number of
// pending polls, then the approval and the exchange.
func approval(t *testing.T, pendingPolls int, accountID string) http.Handler {
	t.Helper()
	polls := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/api/accounts/deviceauth/usercode", func(w http.ResponseWriter, r *http.Request) {
		// The interval arrives as a string here on purpose: the server has
		// sent both shapes, and the flow must read either.
		_, _ = fmt.Fprint(w, `{"device_auth_id": "dev_1", "usercode": "ABCD-1234", "interval": "1"}`)
	})
	mux.HandleFunc("/api/accounts/deviceauth/token", func(w http.ResponseWriter, r *http.Request) {
		polls++
		if polls <= pendingPolls {
			// 403 and 404 both mean "not approved yet"; alternate so the test
			// covers each.
			if polls%2 == 0 {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusForbidden)
			}
			return
		}
		_, _ = fmt.Fprint(w, `{"authorization_code": "code_1", "code_verifier": "verifier_1"}`)
	})
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if got := r.Form.Get("grant_type"); got != "authorization_code" {
			t.Errorf("the exchange said grant_type %q, want authorization_code", got)
		}
		if got := r.Form.Get("code_verifier"); got != "verifier_1" {
			t.Errorf("the exchange said code_verifier %q, want the one the poll returned", got)
		}
		_, _ = fmt.Fprintf(w, `{"access_token": %q, "refresh_token": "refresh_1", "expires_in": 3600}`, token(t, accountID))
	})
	return mux
}

func TestALoginRidesOutPendingPollsAndEndsInACredential(t *testing.T) {
	server(t, approval(t, 2, "acct_42"))

	var shownURL, shownCode string
	creds, err := LoginOpenAI(context.Background(), LoginOptions{
		OnDeviceCode: func(verifyURL, userCode string) { shownURL, shownCode = verifyURL, userCode },
		Timeout:      5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}

	if shownCode != "ABCD-1234" {
		t.Errorf("the person was shown code %q, want the one the server minted", shownCode)
	}
	if !strings.HasSuffix(shownURL, "/codex/device") {
		t.Errorf("the person was sent to %q, want the device page", shownURL)
	}
	if creds.AccountID != "acct_42" {
		t.Errorf("the credential names account %q, want the one in the token's claim", creds.AccountID)
	}
	if creds.RefreshToken != "refresh_1" {
		t.Errorf("the credential holds refresh token %q, want the one the exchange returned", creds.RefreshToken)
	}
	if creds.Expired(0) {
		t.Error("a credential minted for an hour reads as already expired")
	}
}

func TestATokenWithoutTheAccountClaimIsRefusedAtLogin(t *testing.T) {
	server(t, approval(t, 0, ""))

	_, err := LoginOpenAI(context.Background(), LoginOptions{Timeout: 5 * time.Second})
	if err == nil {
		t.Fatal("a token carrying no account claim was stored as a credential")
	}
	if !strings.Contains(err.Error(), "chatgpt_account_id") {
		t.Errorf("the refusal does not name the missing claim: %v", err)
	}
}

func TestTheStoreRoundTripsAndKeepsTheFilePrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "home", "auth.json")
	store := NewStore(path)

	want := Credentials{
		AccessToken:  "access_1",
		RefreshToken: "refresh_1",
		ExpiresAt:    time.Now().Add(time.Hour).Truncate(time.Second),
		AccountID:    "acct_1",
	}
	if err := store.Set(ProviderOpenAI, want); err != nil {
		t.Fatal(err)
	}

	got, ok, err := store.Get(ProviderOpenAI)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("a credential just stored is not found")
	}
	if got.AccessToken != want.AccessToken || got.AccountID != want.AccountID {
		t.Errorf("got %+v, want what was stored", got)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("the credential file is %v, want 0600 — it holds bearer tokens", mode)
	}
	dir, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if mode := dir.Mode().Perm(); mode != 0o700 {
		t.Errorf("the credential directory is %v, want 0700", mode)
	}
}

func TestAMissingStoreFileIsNotLoggedInRatherThanAnError(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "auth.json"))
	_, ok, err := store.Get(ProviderOpenAI)
	if err != nil {
		t.Fatalf("a first run with no logins errored: %v", err)
	}
	if ok {
		t.Fatal("a store that holds nothing reported a credential")
	}
}

func TestAFreshTokenPassesThroughWithoutRenewal(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "auth.json"))
	fresh := Credentials{AccessToken: "access_1", ExpiresAt: time.Now().Add(time.Hour)}
	if err := store.Set(ProviderOpenAI, fresh); err != nil {
		t.Fatal(err)
	}

	source := NewTokenSource(store, ProviderOpenAI)
	source.refresh = func(context.Context, *http.Client, string) (Credentials, error) {
		t.Fatal("a token an hour from expiry was renewed")
		return Credentials{}, nil
	}

	got, err := source.Token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != "access_1" {
		t.Errorf("got token %q, want the stored one", got.AccessToken)
	}
}

func TestAnExpiringTokenIsRenewedAndTheRenewalIsPersisted(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "auth.json"))
	stale := Credentials{
		AccessToken:  "stale",
		RefreshToken: "refresh_1",
		// Inside the renewal skew: still technically live, already renewed.
		ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := store.Set(ProviderOpenAI, stale); err != nil {
		t.Fatal(err)
	}

	source := NewTokenSource(store, ProviderOpenAI)
	source.refresh = func(_ context.Context, _ *http.Client, refreshToken string) (Credentials, error) {
		if refreshToken != "refresh_1" {
			t.Errorf("renewed with %q, want the stored refresh token", refreshToken)
		}
		return Credentials{AccessToken: "renewed", RefreshToken: "refresh_2", ExpiresAt: time.Now().Add(time.Hour)}, nil
	}

	got, err := source.Token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != "renewed" {
		t.Errorf("got token %q, want the renewed one", got.AccessToken)
	}

	stored, ok, err := store.Get(ProviderOpenAI)
	if err != nil || !ok {
		t.Fatalf("the renewal did not persist: ok=%v err=%v", ok, err)
	}
	if stored.RefreshToken != "refresh_2" {
		t.Errorf("the store holds refresh token %q, want the renewed one — the next process would renew from a token the server may refuse", stored.RefreshToken)
	}
}

func TestNoLoginAndNoRenewalEachNameTheCommandThatFixesThem(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "auth.json"))
	source := NewTokenSource(store, ProviderOpenAI)

	_, err := source.Token(context.Background())
	if err == nil || !strings.Contains(err.Error(), "eva login") {
		t.Errorf("a person who never logged in is not told to: %v", err)
	}

	dead := Credentials{AccessToken: "stale", ExpiresAt: time.Now().Add(-time.Hour)}
	if serr := store.Set(ProviderOpenAI, dead); serr != nil {
		t.Fatal(serr)
	}
	_, err = source.Token(context.Background())
	if err == nil || !strings.Contains(err.Error(), "eva login") {
		t.Errorf("a person whose login cannot renew is not told the fix: %v", err)
	}
}

func TestARenewalThatOmitsTheRefreshTokenKeepsTheOldOne(t *testing.T) {
	server(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if got := r.Form.Get("grant_type"); got != "refresh_token" {
			t.Errorf("the renewal said grant_type %q, want refresh_token", got)
		}
		_, _ = fmt.Fprintf(w, `{"access_token": %q, "expires_in": 3600}`, token(t, "acct_1"))
	}))

	creds, err := RefreshOpenAI(context.Background(), nil, "refresh_1")
	if err != nil {
		t.Fatal(err)
	}
	if creds.RefreshToken != "refresh_1" {
		t.Errorf("the renewal dropped the refresh token: %q — every renewal would be a logout", creds.RefreshToken)
	}
}

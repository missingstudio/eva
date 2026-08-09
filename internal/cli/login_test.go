package cli

// The login and the status report are driven through Main, the way a shell
// drives them. The device flow itself is answered by a stand-in — its own
// tests run it against a real server in the auth package — so what is under
// test here is the surface: what a person is shown, what lands on disk, and
// that no token ever reaches a screen.

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/auth"
)

// approved stands in for the device flow: it shows the code the way the real
// flow does, then returns the credential a completed approval would have.
func approved(t *testing.T, creds auth.Credentials) {
	t.Helper()
	before := loginOpenAI
	loginOpenAI = func(_ context.Context, opts auth.LoginOptions) (auth.Credentials, error) {
		if opts.OnDeviceCode != nil {
			opts.OnDeviceCode("https://auth.test/codex/device", "ABCD-1234")
		}
		return creds, nil
	}
	t.Cleanup(func() { loginOpenAI = before })
}

// isolated points Eva's own files at a directory this test owns and clears
// every credential variable, so nothing here reads the developer's logins or
// keys.
func isolated(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("EVA_HOME", dir)
	t.Setenv("EVA_CONFIG", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	return dir
}

func TestLoginShowsTheCodeStoresTheCredentialAndNeverPrintsIt(t *testing.T) {
	dir := isolated(t)
	approved(t, auth.Credentials{
		AccessToken:  "tok_secret",
		RefreshToken: "ref_secret",
		ExpiresAt:    time.Now().Add(time.Hour),
		AccountID:    "acct_7",
	})

	var stdout, stderr bytes.Buffer
	if code := Main([]string{"login"}, strings.NewReader(""), &stdout, &stderr); code != ExitOK {
		t.Fatalf("login exited %d: %s", code, stderr.String())
	}

	said := stdout.String()
	for _, want := range []string{"ABCD-1234", "acct_7", filepath.Join(dir, "auth.json"), "auth = \"subscription\""} {
		if !strings.Contains(said, want) {
			t.Errorf("the login never said %q:\n%s", want, said)
		}
	}
	for _, secret := range []string{"tok_secret", "ref_secret"} {
		if strings.Contains(said, secret) {
			t.Fatalf("the login printed a token — a credential on a screen is a credential in a scrollback")
		}
	}

	store := auth.NewStore(filepath.Join(dir, "auth.json"))
	creds, ok, err := store.Get(auth.ProviderOpenAI)
	if err != nil || !ok {
		t.Fatalf("the login stored nothing: ok=%v err=%v", ok, err)
	}
	if creds.AccessToken != "tok_secret" {
		t.Errorf("the store holds %q, want the token the approval returned", creds.AccessToken)
	}
}

func TestLoginRefusesASubscriptionEvaDoesNotHave(t *testing.T) {
	isolated(t)

	var stdout, stderr bytes.Buffer
	if code := Main([]string{"login", "anthropic"}, strings.NewReader(""), &stdout, &stderr); code != ExitUsage {
		t.Fatalf("login exited %d, want a usage error", code)
	}
	if !strings.Contains(stderr.String(), "openai") {
		t.Errorf("the refusal does not name what can be logged in to: %s", stderr.String())
	}
}

func TestAuthStatusNamesTheLoginAndNeverTheToken(t *testing.T) {
	dir := isolated(t)
	store := auth.NewStore(filepath.Join(dir, "auth.json"))
	if err := store.Set(auth.ProviderOpenAI, auth.Credentials{
		AccessToken:  "tok_secret",
		RefreshToken: "ref_secret",
		ExpiresAt:    time.Now().Add(time.Hour),
		AccountID:    "acct_7",
	}); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("[provider]\nname = \"openai\"\nauth = \"subscription\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EVA_CONFIG", path)
	// The trap the report exists to dissolve: a key exported and unused.
	t.Setenv("OPENAI_API_KEY", "sk-unused")

	var stdout, stderr bytes.Buffer
	if code := Main([]string{"auth", "status"}, strings.NewReader(""), &stdout, &stderr); code != ExitOK {
		t.Fatalf("auth status exited %d: %s", code, stderr.String())
	}

	said := stdout.String()
	for _, want := range []string{"openai", "subscription", "acct_7", filepath.Join(dir, "auth.json"), "unused"} {
		if !strings.Contains(said, want) {
			t.Errorf("the report never said %q:\n%s", want, said)
		}
	}
	for _, secret := range []string{"tok_secret", "ref_secret", "sk-unused"} {
		if strings.Contains(said, secret) {
			t.Fatalf("the report printed credential material:\n%s", said)
		}
	}
}

func TestAuthStatusReportsTheKeyModeWithoutNeedingAKey(t *testing.T) {
	isolated(t)

	var stdout, stderr bytes.Buffer
	if code := Main([]string{"auth", "status"}, strings.NewReader(""), &stdout, &stderr); code != ExitOK {
		t.Fatalf("auth status exited %d: %s — a report on a missing credential must not require one", code, stderr.String())
	}

	said := stdout.String()
	for _, want := range []string{"anthropic", "api_key", "ANTHROPIC_API_KEY", "is not set"} {
		if !strings.Contains(said, want) {
			t.Errorf("the report never said %q:\n%s", want, said)
		}
	}
}

func TestAuthAloneIsHandedTheWholeCommand(t *testing.T) {
	_, err := parse([]string{"auth"})
	if err == nil || !strings.Contains(err.Error(), "eva auth status") {
		t.Errorf("half a command was not handed the other half: %v", err)
	}
}

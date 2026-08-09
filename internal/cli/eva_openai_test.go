package cli_test

// The OpenAI subscription path, driven end to end: a real process, a real
// configuration file, a seeded login, and a local server standing where the
// subscription backend stands. What is asserted is what an outside reader
// could see — the answer on stdout, the headers the backend received, and
// that the token appears in neither stream.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// codexToken mints a JWT-shaped access token carrying the account claim the
// subscription backend requires. Nothing verifies a signature: the backend
// here is this test's.
func codexToken(t *testing.T, accountID string) string {
	t.Helper()
	claims, err := json.Marshal(map[string]any{
		"https://api.openai.com/auth": map[string]string{"chatgpt_account_id": accountID},
	})
	if err != nil {
		t.Fatal(err)
	}
	return "header." + base64.RawURLEncoding.EncodeToString(claims) + ".signature"
}

// loggedIn writes a login into the world's auth store, the way `eva login`
// would have.
func (w *world) loggedIn(t *testing.T, token string) {
	t.Helper()
	home := filepath.Join(w.dir, "home")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	entry := fmt.Sprintf(`{"openai": {"access_token": %q, "refresh_token": "ref_test", "expires_at": %q, "account_id": "acct_test"}}`,
		token, time.Now().Add(time.Hour).Format(time.RFC3339))
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(entry), 0o600); err != nil {
		t.Fatal(err)
	}
}

// codex is a server answering the Responses API's stream the way the
// subscription backend answers it: text in per-item frames, and a terminal
// frame that carries usage and no output.
func codex(t *testing.T) (base string, headers func() http.Header) {
	t.Helper()

	var mu sync.Mutex
	var seen http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = r.Header.Clone()
		mu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		for _, frame := range []string{
			`{"type": "response.output_text.delta", "output_index": 0, "delta": "Answered on "}`,
			`{"type": "response.output_text.delta", "output_index": 0, "delta": "a subscription."}`,
			`{"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "content": [{"type": "output_text", "text": "Answered on a subscription."}]}}`,
			`{"type": "response.completed", "response": {"status": "completed", "usage": {"input_tokens": 12, "output_tokens": 5}}}`,
			`[DONE]`,
		} {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", frame)
		}
	}))
	t.Cleanup(srv.Close)

	return srv.URL, func() http.Header {
		mu.Lock()
		defer mu.Unlock()
		return seen
	}
}

// subscribed is a world whose provider is the OpenAI subscription against
// base, with every credential variable scrubbed — the login is the whole of
// what the run may authenticate with.
func subscribed(t *testing.T, base string) *world {
	t.Helper()
	w := newWorld(t, provider{
		model: "gpt-test",
		table: fmt.Sprintf("[provider]\nname = \"openai\"\nauth = \"subscription\"\nbase_url = %q\n", base),
	})
	w.env = append(w.env, "OPENAI_API_KEY=")
	return w
}

func TestASubscriptionTurnAnswersAndTheTokenStaysOffEveryStream(t *testing.T) {
	base, headers := codex(t)
	w := subscribed(t, base)
	token := codexToken(t, "acct_test")
	w.loggedIn(t, token)

	got := w.run(t, "-p", "Say hello.")
	if got.code != 0 {
		t.Fatalf("the turn exited %d:\n%s", got.code, got.stderr)
	}
	if !strings.Contains(got.stdout, "Answered on a subscription.") {
		t.Errorf("the answer never reached stdout:\n%s", got.stdout)
	}

	sent := headers()
	if sent == nil {
		t.Fatal("the backend was never reached")
	}
	if got := sent.Get("Authorization"); got != "Bearer "+token {
		t.Errorf("Authorization = %q, want the stored login's token", got)
	}
	if got := sent.Get("chatgpt-account-id"); got != "acct_test" {
		t.Errorf("chatgpt-account-id = %q, want the id inside the token", got)
	}

	for stream, text := range map[string]string{"stdout": got.stdout, "stderr": got.stderr} {
		if strings.Contains(text, token) || strings.Contains(text, "ref_test") {
			t.Fatalf("the credential reached %s", stream)
		}
	}
}

func TestAMissingLoginFailsBeforeATurnAndNamesTheFix(t *testing.T) {
	base, _ := codex(t)
	w := subscribed(t, base)

	got := w.run(t, "-p", "Say hello.")
	if got.code == 0 {
		t.Fatal("a run with no login answered a turn")
	}
	if !strings.Contains(got.stderr, "eva login") {
		t.Errorf("the failure does not name the command that fixes it:\n%s", got.stderr)
	}
}

package config_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/missingstudio/eva/internal/config"
)

// canary is a value that must never appear in output. If a test here fails,
// the failure is a credential in a file a developer can share.
const canary = "sk-ant-canary-do-not-store-me"

// Every way a value leaves a program by accident is closed. These are not four
// styles of the same test: %s, %#v, JSON, and text are four separate methods,
// and closing three of them leaves the credential one format change away from
// a file.
func TestASecretRedactsOnEveryPathOut(t *testing.T) {
	secret := config.Secret(canary)

	cases := []struct {
		name string
		show func() (string, error)
	}{
		// The verbs are wrapped in a message because that is how a credential
		// actually leaks — inside a log line or a diagnostic, never on its own.
		{"%s", func() (string, error) { return fmt.Sprintf("key=%s", secret), nil }},
		{"%v", func() (string, error) { return fmt.Sprintf("key=%v", secret), nil }},
		{"%q", func() (string, error) { return fmt.Sprintf("key=%q", secret), nil }},
		{"%#v", func() (string, error) { return fmt.Sprintf("key=%#v", secret), nil }},
		{"print", func() (string, error) { return fmt.Sprint(secret), nil }},
		{"error wrapping", func() (string, error) {
			return fmt.Errorf("provider rejected %s", secret).Error(), nil
		}},
		{"json", func() (string, error) {
			b, err := json.Marshal(secret)
			return string(b), err
		}},
		{"json inside a struct", func() (string, error) {
			b, err := json.Marshal(struct {
				Key config.Secret `json:"key"`
			}{secret})
			return string(b), err
		}},
		{"toml", func() (string, error) {
			var buf bytes.Buffer
			err := toml.NewEncoder(&buf).Encode(struct {
				Key config.Secret `toml:"key"`
			}{secret})
			return buf.String(), err
		}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := c.show()
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if strings.Contains(got, canary) {
				t.Fatalf("the credential reached the output: %s", got)
			}
			if !strings.Contains(got, "redacted") {
				t.Errorf("output = %s, want it to say the value was redacted", got)
			}
		})
	}
}

// Reading the value takes a call named Reveal, which is greppable and visible
// in review. That is the whole reason the name is not something quieter.
func TestRevealIsTheOnlyWayOut(t *testing.T) {
	if got := config.Secret(canary).Reveal(); got != canary {
		t.Errorf("Reveal = %q, want the credential", got)
	}
}

func TestEmptyReportsWhetherACredentialWasResolved(t *testing.T) {
	if !config.Secret("").Empty() {
		t.Error("an unset Secret does not report itself empty")
	}
	if config.Secret(canary).Empty() {
		t.Error("a set Secret reports itself empty")
	}
}

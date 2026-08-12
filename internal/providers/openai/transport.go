package openai

import (
	"errors"
	"net/http"
	"strings"
)

// The two endpoints one Provider can answer from. The public API takes an API
// key; the subscription backend takes a login's access token and serves the
// same Responses shape from a different host.
const (
	defaultAPIBase          = "https://api.openai.com/v1"
	defaultSubscriptionBase = "https://chatgpt.com/backend-api/codex"
)

type transport struct {
	endpoint string

	// instructions is what a turn with no system prompt sends. Empty means a
	// turn may send none.
	instructions string

	// decorate adds whatever this transport requires beyond the bearer token.
	decorate func(h http.Header, token string) error
}

// apiKeyTransport is the public API: a bearer token and nothing else.
func apiKeyTransport(base string) transport {
	return transport{
		endpoint: responses(base, defaultAPIBase),
		decorate: func(http.Header, string) error { return nil },
	}
}

func subscriptionTransport(base string) transport {
	return transport{
		endpoint: responses(base, defaultSubscriptionBase),
		// The backend rejects a request with no instructions, so a turn that
		// somehow carries no system prompt is given the emptiest one there is
		// rather than being refused.
		instructions: "You are a helpful assistant.",
		decorate: func(h http.Header, token string) error {
			account, err := accountID(token)
			if err != nil {
				return err
			}
			h.Set("chatgpt-account-id", account)
			h.Set("originator", "eva")
			h.Set("OpenAI-Beta", "responses=experimental")
			return nil
		},
	}
}

func responses(base, fallback string) string {
	if base == "" {
		base = fallback
	}
	return strings.TrimRight(base, "/") + "/responses"
}

func accountID(token string) (string, error) {
	claims, err := claims(token)
	if err != nil {
		return "", err
	}
	if claims.Auth.ChatGPTAccountID == "" {
		return "", errors.New("openai: the access token carries no account id")
	}
	return claims.Auth.ChatGPTAccountID, nil
}

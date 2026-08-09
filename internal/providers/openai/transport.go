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

// transport is one of the two ways this Provider reaches the Responses API.
//
// The two differ in three places and no more: the host, the headers beyond the
// bearer token, and whether a turn carrying no system prompt is acceptable.
// Threaded through as a boolean, those three forks sat in two files — and the
// third of them was buried in transcript mapping, where nobody reading about
// transports would find it. Here the choice is made once and the differences
// are in one place, which is what "identical past the dial" was supposed to
// mean.
type transport struct {
	// endpoint is the URL one attempt posts to.
	endpoint string

	// instructions is what a turn with no system prompt sends. Empty means a
	// turn may send none.
	instructions string

	// decorate adds whatever this transport requires beyond the bearer token.
	//
	// It takes the token because one of them reads a header out of it. That
	// happens per attempt, not at construction: the token renews under a long
	// session, and a header set once at startup would go on naming the account
	// of a token that is no longer being sent (ADR-0033).
	decorate func(h http.Header, token string) error
}

// apiKeyTransport is the public API: a bearer token and nothing else.
func apiKeyTransport(base string) transport {
	return transport{
		endpoint: responses(base, defaultAPIBase),
		decorate: func(http.Header, string) error { return nil },
	}
}

// subscriptionTransport is the ChatGPT backend a login reaches.
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

// responses is the URL one attempt posts to: what a person pointed this at, or
// the transport's own host.
func responses(base, fallback string) string {
	if base == "" {
		base = fallback
	}
	return strings.TrimRight(base, "/") + "/responses"
}

// accountID reads the ChatGPT account id out of a subscription access token.
//
// The subscription backend requires the id as a header on every request, and
// the token is a JWT that carries it in a namespaced claim — the credential's
// own shape, so the Provider that speaks that wire reads it here rather than
// being handed a second value that could disagree with the first. The login
// flow refuses a token without the claim, so failing here means the token came
// from somewhere other than a login.
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

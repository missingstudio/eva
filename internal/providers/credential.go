package providers

import "errors"

// Mode is how a Credential authenticates. The mode alone decides which
// credential a turn uses: there is no chain in which an exported variable
// outranks a login or the reverse (ADR-0031).
type Mode int

const (
	// ModeAPIKey is a long-lived secret read from the environment.
	ModeAPIKey Mode = iota
	// ModeSubscription is a login's short-lived access token. It renews under
	// a long session, so it is resolved per attempt rather than per turn, and
	// the vendor may serve it from a host an API key never reaches.
	ModeSubscription
)

func (m Mode) String() string {
	if m == ModeSubscription {
		return "subscription"
	}
	return "api key"
}

type Credential struct {
	resolve func() (string, error)
	mode    Mode
}

func APIKey(resolve func() (string, error)) Credential {
	return Credential{resolve: resolve, mode: ModeAPIKey}
}

func Subscription(resolve func() (string, error)) Credential {
	return Credential{resolve: resolve, mode: ModeSubscription}
}

func (c Credential) Mode() Mode { return c.mode }

// Present says whether there is anything to resolve. The zero Credential is the
// one a Provider that sends nothing is built with.
func (c Credential) Present() bool { return c.resolve != nil }

func (c Credential) Resolve() (string, error) {
	if c.resolve == nil {
		return "", errors.New("no credential")
	}
	return c.resolve()
}

// Available reports whether the secret can be had at all, and is what a
// Provider asks at construction so that a credential nobody can produce — an
// unset variable, a login that never happened — fails at startup in a sentence
// naming the fix rather than partway through the first turn a person asks.
func (c Credential) Available() error {
	_, err := c.Resolve()
	return err
}

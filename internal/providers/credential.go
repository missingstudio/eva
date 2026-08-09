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

// Credential is what authenticates Eva to a Provider: how to obtain the secret,
// and the mode that says what kind of secret it is.
//
// The two travel together because they are one fact. Passed as a resolver and a
// separate boolean, they could be set to disagree — a subscription flag over an
// API-key resolver is constructible, type-correct, and fails at the dial with a
// sentence about a token that was never a token. Here the mode is chosen by
// which constructor was called, so there is no half-right Credential to build.
//
// Resolution is deferred rather than done up front. Only a Provider that needs
// a credential should be able to fail for want of one: resolved at the seam
// instead, a recording replayed from a file would refuse to open for want of an
// API key it never sends, and every test that replays one would carry a secret.
// It also keeps the secret out of a struct that gets logged, compared, or
// copied on the way in.
type Credential struct {
	resolve func() (string, error)
	mode    Mode
}

// APIKey is a credential read from the environment.
func APIKey(resolve func() (string, error)) Credential {
	return Credential{resolve: resolve, mode: ModeAPIKey}
}

// Subscription is a credential obtained by a Login.
func Subscription(resolve func() (string, error)) Credential {
	return Credential{resolve: resolve, mode: ModeSubscription}
}

// Mode is what kind of secret this is.
func (c Credential) Mode() Mode { return c.mode }

// Present says whether there is anything to resolve. The zero Credential is the
// one a Provider that sends nothing is built with.
func (c Credential) Present() bool { return c.resolve != nil }

// Resolve obtains the secret.
//
// A Provider that needs a credential calls this per attempt rather than keeping
// what it got: a subscription token renews under a long session, and the
// attempt made an hour in must send the token that is live an hour in, not the
// one that was live at startup.
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
//
// It resolves and drops the value on purpose. Dropping it is what keeps the
// per-attempt rule above true: a copy taken here would be the wrong one within
// the hour. Nothing is wasted by the drop — resolving a subscription is what
// renews it, and the renewal is written to the Auth store on its way past, so
// the work this does is work the first attempt then does not have to.
func (c Credential) Available() error {
	_, err := c.Resolve()
	return err
}

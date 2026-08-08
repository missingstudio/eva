package config

// Secret is a credential that must not reach a Trace, a log, or a context
// window.
//
// The type exists because "do not print the API key" is not a rule a codebase
// can keep by intention. String, GoString, and MarshalJSON are the three ways
// a value leaks into output by accident — through %s, through %#v, and through
// a struct being encoded — and all three are closed here. Reading the value
// takes a call named Reveal, which is greppable and visible in review.
type Secret string

const redacted = "<redacted>"

// String redacts. This is what %s and %v print.
func (Secret) String() string { return redacted }

// GoString redacts. This is what %#v prints.
func (Secret) GoString() string { return redacted }

// MarshalJSON redacts, so that a Secret inside an encoded struct cannot reach
// a file.
func (Secret) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

// MarshalText redacts. It is what every encoder that is not JSON reaches for
// first — TOML among them — so closing only MarshalJSON would leave the
// credential one format change away from a file.
func (Secret) MarshalText() ([]byte, error) { return []byte(redacted), nil }

// Reveal returns the credential itself. Every call site is a place a secret
// leaves this type, which is why the name is not something quieter.
func (s Secret) Reveal() string { return string(s) }

// Empty reports whether no credential was resolved.
func (s Secret) Empty() bool { return s == "" }

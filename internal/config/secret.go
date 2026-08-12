package config

// Secret is a credential that must not reach a Trace, a log, or a context
// window.
type Secret string

const redacted = "<redacted>"

func (Secret) String() string { return redacted }

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

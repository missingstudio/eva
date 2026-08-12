package auth

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// ProviderOpenAI is the store key an OpenAI subscription Credential lives
// under. It matches the name configuration selects the Provider by, so that a
// person reading the file can tell which login is whose.
const ProviderOpenAI = "openai"

type Credentials struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	// AccountID is the account the token was minted for, read out of the token
	// at login. The OpenAI subscription backend requires it as a header on
	// every request, and a status report names it so a person knows which
	// account they are spending.
	AccountID string `json:"account_id"`
}

// Expired reports whether the access token is past its expiry, treating a
// token within skew of it as already expired — a request racing the boundary
// would authenticate with a token that dies mid-flight.
func (c Credentials) Expired(skew time.Duration) bool {
	if c.ExpiresAt.IsZero() {
		return true
	}
	return time.Now().Add(skew).After(c.ExpiresAt)
}

type Store struct {
	path string
}

// NewStore returns the Store backed by path. The path is the caller's to
// choose: this layer does not know where Eva keeps its files, only how a
// credential file must be written.
func NewStore(path string) *Store { return &Store{path: path} }

func (s *Store) Path() string { return s.path }

func (s *Store) Get(key string) (Credentials, bool, error) {
	all, err := s.load()
	if err != nil {
		return Credentials{}, false, err
	}
	c, ok := all[key]
	return c, ok, nil
}

// Set stores creds under key, replacing any existing entry. Logging in again
// is therefore the whole of "log out and back in": the old credential is gone
// the moment the new one lands.
func (s *Store) Set(key string, creds Credentials) error {
	all, err := s.load()
	if err != nil {
		return err
	}
	all[key] = creds
	return s.save(all)
}

func (s *Store) load() (map[string]Credentials, error) {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]Credentials{}, nil
		}
		return nil, fmt.Errorf("auth: read %s: %w", s.path, err)
	}
	if len(b) == 0 {
		return map[string]Credentials{}, nil
	}
	var all map[string]Credentials
	if err := json.Unmarshal(b, &all); err != nil {
		return nil, fmt.Errorf("auth: parse %s: %w", s.path, err)
	}
	if all == nil {
		all = map[string]Credentials{}
	}
	return all, nil
}

func (s *Store) save(all map[string]Credentials) error {
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("auth: make %s: %w", dir, err)
	}

	// A temporary file beside the target, so the rename stays on one
	// filesystem and stays atomic. The mode is set before a byte of secret is
	// written, not after — a file that was world-readable for an instant was
	// world-readable.
	tmp, err := os.CreateTemp(dir, ".auth-*")
	if err != nil {
		return fmt.Errorf("auth: write %s: %w", s.path, err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }()

	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("auth: write %s: %w", s.path, err)
	}
	if _, err := tmp.Write(b); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("auth: write %s: %w", s.path, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("auth: write %s: %w", s.path, err)
	}
	if err := os.Rename(tmp.Name(), s.path); err != nil {
		return fmt.Errorf("auth: write %s: %w", s.path, err)
	}
	return nil
}

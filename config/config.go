package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/missingstudio/eva/events"
)

// Defaults. A first run with no configuration file at all must work, so every
// setting has one.
const (
	// DefaultModel is what a turn runs against when nothing selects a model.
	DefaultModel = "claude-opus-5"
	// DefaultProvider is the real one. A fake is never the default: a build
	// that quietly answered from a recording would be worse than one that
	// says it has no API key.
	DefaultProvider = "anthropic"
	// DefaultAPIKeyEnv is where the credential is read from. A secret enters
	// at the environment boundary and nowhere else, so there is no
	// configuration key that holds one.
	DefaultAPIKeyEnv = "ANTHROPIC_API_KEY"
	// DefaultTenant is the tenant a local run acts under, before a control
	// plane issues one.
	DefaultTenant = "local"
	// DefaultActor is who a local run is attributed to when nothing else says.
	DefaultActor = "local"
)

// Env vars that move the files, so that a test can start the binary against a
// configuration of its own without touching the developer's home directory.
const (
	// EnvConfig names an alternative configuration file.
	EnvConfig = "EVA_CONFIG"
	// EnvHome names an alternative directory for Eva's own files.
	EnvHome = "EVA_HOME"
)

// Config is Eva's configuration, resolved.
//
// Configuration is a versioned file rather than a pile of flags, so that a
// setup is reviewable and shareable (invariant 6).
type Config struct {
	// Model is which model a turn runs against.
	Model string `toml:"model"`

	Provider ProviderConfig `toml:"provider"`
	Trace    TraceConfig    `toml:"trace"`
	Identity IdentityConfig `toml:"identity"`

	// Path is where this configuration was read from, or the path that was
	// looked for and not found. Error messages name it, because a message
	// that says a key is wrong without saying which file it is in sends the
	// reader looking.
	Path string `toml:"-"`

	// APIKey is resolved from the environment, never from the file.
	APIKey Secret `toml:"-"`
}

// ProviderConfig selects the model provider.
type ProviderConfig struct {
	// Name selects the implementation.
	Name string `toml:"name"`
	// APIKeyEnv names the environment variable the credential is read from.
	APIKeyEnv string `toml:"api_key_env"`
	// Script is the recorded output the scripted provider replays.
	Script string `toml:"script"`
}

// TraceConfig says where the Trace is written.
type TraceConfig struct {
	Path string `toml:"path"`
}

// IdentityConfig is who a Run acts as.
//
// Tenant and Actor are configured from the first commit, long before a second
// tenant exists, because they ride on every Event and adding them later would
// touch every stored record.
type IdentityConfig struct {
	Tenant string `toml:"tenant"`
	Actor  string `toml:"actor"`
	// ActorKind is human, agent, or system.
	ActorKind string `toml:"actor_kind"`
}

// Actor is the identity Events are attributed to.
func (c Config) Actor() events.Identity {
	return events.Identity{
		ID:   c.Identity.Actor,
		Kind: events.ActorKind(c.Identity.ActorKind),
	}
}

// Tenant is the tenant Events are attributed to.
func (c Config) Tenant() events.TenantID { return events.TenantID(c.Identity.Tenant) }

// RequireAPIKey returns the credential, or an error that says how to set one.
//
// Configuration is the surface a user touches before anything else works, so
// its error messages are part of the product.
func (c Config) RequireAPIKey() (Secret, error) {
	if !c.APIKey.Empty() {
		return c.APIKey, nil
	}
	return "", fmt.Errorf(
		"no API key for provider %q: set %s in the environment (export %s=…), "+
			"or name a different variable with provider.api_key_env in %s",
		c.Provider.Name, c.Provider.APIKeyEnv, c.Provider.APIKeyEnv, c.Path)
}

// Load reads the configuration.
//
// path selects the file. When it is empty, EVA_CONFIG is used, and failing
// that the default location — and a default location that does not exist is
// not an error, because a first run has no file yet. A path that was asked for
// by name and is missing is an error, because the caller meant that file.
func Load(path string) (Config, error) {
	explicit := path != ""
	if !explicit {
		path = os.Getenv(EnvConfig)
		explicit = path != ""
	}
	if !explicit {
		home, err := Home()
		if err != nil {
			return Config{}, err
		}
		path = filepath.Join(home, "config.toml")
	}

	cfg := defaults()
	cfg.Path = path

	switch _, err := os.Stat(path); {
	case err == nil:
		if err := decode(path, &cfg); err != nil {
			return Config{}, err
		}
	case errors.Is(err, os.ErrNotExist) && !explicit:
		// No file yet. The defaults stand.
	default:
		return Config{}, fmt.Errorf("config: %s: %w", path, err)
	}

	if err := cfg.normalize(); err != nil {
		return Config{}, err
	}
	cfg.APIKey = Secret(os.Getenv(cfg.Provider.APIKeyEnv))
	return cfg, nil
}

// decode reads the file strictly: a key Eva does not know is an error naming
// the key, never a silent ignore. A typo that quietly disables the setting a
// user meant to change is the failure this prevents (docs/adr/0009).
func decode(path string, cfg *Config) error {
	md, err := toml.DecodeFile(path, cfg)
	if err != nil {
		return fmt.Errorf("config: %s: %w", path, err)
	}
	if undecoded := md.Undecoded(); len(undecoded) > 0 {
		keys := make([]string, 0, len(undecoded))
		for _, k := range undecoded {
			keys = append(keys, k.String())
		}
		return fmt.Errorf("config: %s: unknown key %q (the file has %d key(s) Eva does not know: %s)",
			path, keys[0], len(keys), strings.Join(keys, ", "))
	}
	return nil
}

func defaults() Config {
	return Config{
		Model: DefaultModel,
		Provider: ProviderConfig{
			Name:      DefaultProvider,
			APIKeyEnv: DefaultAPIKeyEnv,
		},
		Identity: IdentityConfig{
			Tenant:    DefaultTenant,
			Actor:     DefaultActor,
			ActorKind: string(events.ActorHuman),
		},
	}
}

// normalize fills in what the file left empty and expands the paths it gave.
func (c *Config) normalize() error {
	d := defaults()
	if c.Model == "" {
		c.Model = d.Model
	}
	if c.Provider.Name == "" {
		c.Provider.Name = d.Provider.Name
	}
	if c.Provider.APIKeyEnv == "" {
		c.Provider.APIKeyEnv = d.Provider.APIKeyEnv
	}
	if c.Identity.Tenant == "" {
		c.Identity.Tenant = d.Identity.Tenant
	}
	if c.Identity.Actor == "" {
		c.Identity.Actor = d.Identity.Actor
	}
	if c.Identity.ActorKind == "" {
		c.Identity.ActorKind = d.Identity.ActorKind
	}

	switch events.ActorKind(c.Identity.ActorKind) {
	case events.ActorHuman, events.ActorAgent, events.ActorSystem:
	default:
		return fmt.Errorf("config: %s: identity.actor_kind is %q, want one of %q, %q, %q",
			c.Path, c.Identity.ActorKind, events.ActorHuman, events.ActorAgent, events.ActorSystem)
	}

	var err error
	if c.Trace.Path == "" {
		home, herr := Home()
		if herr != nil {
			return herr
		}
		c.Trace.Path = filepath.Join(home, "trace.jsonl")
	} else if c.Trace.Path, err = expand(c.Trace.Path); err != nil {
		return err
	}

	if c.Provider.Script != "" {
		// Relative to the configuration file, so that a script and the file
		// naming it can move together.
		if c.Provider.Script, err = expand(c.Provider.Script); err != nil {
			return err
		}
		if !filepath.IsAbs(c.Provider.Script) {
			c.Provider.Script = filepath.Join(filepath.Dir(c.Path), c.Provider.Script)
		}
	}
	return nil
}

// Home is the directory Eva keeps its own files in.
func Home() (string, error) {
	if home := os.Getenv(EnvHome); home != "" {
		return home, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("config: locate the home directory (set %s to choose one): %w", EnvHome, err)
	}
	return filepath.Join(home, ".eva"), nil
}

// expand resolves a leading ~ against the user's home directory.
func expand(path string) (string, error) {
	if path != "~" && !strings.HasPrefix(path, "~/") {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("config: expand %q: %w", path, err)
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~")), nil
}

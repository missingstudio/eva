package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/missingstudio/eva/internal/events"
)

// Defaults. A first run with no configuration file at all must work, so every
// setting has one.
const (
	// DefaultModel is what a turn runs against when nothing selects a model.
	DefaultModel    = "claude-sonnet-4-5"
	DefaultProvider = "anthropic"
	// DefaultAPIKeyEnv is where the credential is read from. A secret enters
	// at the environment boundary and nowhere else, so there is no
	// configuration key that holds one.
	DefaultAPIKeyEnv = "ANTHROPIC_API_KEY"
	DefaultTenant    = "local"
	DefaultActor     = "local"
)

// Env vars that move the files, so that a test can start the binary against a
// configuration of its own without touching the developer's home directory.
const (
	// EnvConfig names an alternative configuration file.
	EnvConfig = "EVA_CONFIG"
	// EnvHome names an alternative directory for Eva's own files.
	EnvHome = "EVA_HOME"
)

// ProjectDir is the directory a repository keeps its Eva settings in, found by
// walking up from the working directory.
const ProjectDir = ".eva"

// projectSettable is every key a repository's own file may set.
//
// It is an allow list, and that is the whole of the decision. A cloned
// repository's .eva/ is content from the internet — the same category as a
// fetched web page — so the question is not which keys are dangerous but which
// are known to be safe. A deny list would admit every key added after it was
// written, which is the one failure mode a trust boundary cannot have.
//
// What is on it can change what a person sees. What is off it can change what a
// run does: which Provider answers, where the credential is read from, where
// the traffic goes, where the Trace is written, who the run is attributed to. A
// repository that could set those could redirect a person's turns to a server
// it names and their Trace to a file it chooses, on the first prompt after a
// clone.
var projectSettable = map[string]bool{
	// model, because choosing a model is choosing how the work is done rather
	// than who it is done by. It cannot move the traffic or the credential.
	"model": true,
}

// projectSettableTables are whole tables a repository may set, named by their
// prefix. Look and feel lives here.
var projectSettableTables = map[string]bool{}

// Config is Eva's configuration, resolved.
//
// Configuration is a versioned file rather than a pile of flags, so that a
// setup is reviewable and shareable (invariant 6).
type Config struct {
	// Model is which model a turn runs against.
	Model string `toml:"model"`

	// Project is the repository's own settings file, when one was found and
	// read. It is empty otherwise, and it is not a key any file can set: it
	// says where something was read from, so an error can name the file a
	// person has to go and edit.
	Project string `toml:"-"`

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
	// BaseURL points a network provider somewhere other than its public API:
	// a gateway, a proxy, or a local server. Empty is the public API.
	BaseURL string `toml:"base_url"`
	// MaxTokens caps one answer. Zero leaves the cap to the provider, which
	// is what knows its own API — so there is no default here to be kept in
	// step with the one that does the work.
	MaxTokens int64 `toml:"max_tokens"`
	// Script is the recorded output the fake provider replays.
	Script string `toml:"script"`
}

// TraceConfig says where the Trace is written.
type TraceConfig struct {
	Path string `toml:"path"`
	// Kind selects which sink writes it. Empty is the append-only JSONL file,
	// which is what a configuration that says nothing about its Trace gets.
	Kind string `toml:"kind"`
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
// Four sources, each able to override the one before it: the compiled defaults,
// the person's own file, the repository's, and the flag. A run with none of
// them works, because every setting has a default.
//
// path selects the person's file. When it is empty, EVA_CONFIG is used, and
// failing that the default location — and a default location that does not
// exist is not an error, because a first run has no file yet. A path that was
// asked for by name and is missing is an error, because the caller meant that
// file.
//
// The repository's file is found by walking up from the working directory, and
// it may set only what a repository is trusted to set. See projectSettable.
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

	if err := cfg.loadProject(); err != nil {
		return Config{}, err
	}

	if err := cfg.normalize(); err != nil {
		return Config{}, err
	}
	cfg.APIKey = Secret(os.Getenv(cfg.Provider.APIKeyEnv))
	return cfg, nil
}

// loadProject applies the repository's own settings over the person's.
//
// A repository that holds none is the ordinary case and changes nothing. The
// file it does hold is read strictly, like every other, and then checked
// against what a repository may set — so a key that is real, spelled right, and
// not a repository's to choose is refused by name rather than ignored.
func (c *Config) loadProject() error {
	start, err := os.Getwd()
	if err != nil {
		// A process with no working directory has no repository to be in. The
		// person's own configuration stands.
		return nil
	}

	path, found := findProject(start)
	if !found {
		return nil
	}

	var project Config
	md, err := toml.DecodeFile(path, &project)
	if err != nil {
		return fmt.Errorf("config: %s: %w", path, err)
	}
	if undecoded := md.Undecoded(); len(undecoded) > 0 {
		return fmt.Errorf("config: %s: unknown key %q (a key Eva does not know)", path, undecoded[0].String())
	}

	for _, name := range leaves(md.Keys()) {
		if !settableFromProject(name) {
			return fmt.Errorf(
				"config: %s: %q is not a setting a repository may choose — it decides what a run does "+
					"rather than how it looks. Set it in your own configuration (%s) instead",
				path, name, c.Path)
		}
	}

	if md.IsDefined("model") {
		c.Model = project.Model
	}
	c.Project = path
	return nil
}

// leaves are the keys a file actually set, without the table headers above
// them.
//
// A decoder reports both "provider" and "provider.base_url" for one setting,
// and the header is the less useful of the two to be refused by: a person who
// wrote base_url and is told that "provider" is not theirs to choose has to
// work out which line to delete.
func leaves(keys []toml.Key) []string {
	named := make([]string, len(keys))
	for i, key := range keys {
		named[i] = key.String()
	}

	out := make([]string, 0, len(named))
	for _, name := range named {
		header := false
		for _, other := range named {
			if strings.HasPrefix(other, name+".") {
				header = true
				break
			}
		}
		if !header {
			out = append(out, name)
		}
	}
	return out
}

// settableFromProject reports whether a repository may set a key.
//
// A table is named by its prefix so that a whole area of settings is opened at
// once rather than key by key. Nothing else is: the default is refusal, which
// is what makes a setting added later safe by omission.
func settableFromProject(key string) bool {
	if projectSettable[key] {
		return true
	}
	for table := range projectSettableTables {
		if key == table || strings.HasPrefix(key, table+".") {
			return true
		}
	}
	return false
}

// findProject walks up from a directory looking for the settings a repository
// keeps.
//
// It stops at a repository boundary, so a file above the repository a person is
// working in is not read: the settings belong to this checkout, and a directory
// that happens to be its parent is not part of it. It stops at the filesystem
// root regardless, so a working directory outside any repository reads nothing.
func findProject(start string) (string, bool) {
	dir := start
	for {
		if path := filepath.Join(dir, ProjectDir, "config.toml"); exists(path) {
			return path, true
		}
		// The boundary is checked after the settings, so that a repository's own
		// .eva/ is found in the directory that makes it a repository.
		if exists(filepath.Join(dir, ".git")) {
			return "", false
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// decode reads the file strictly: a key Eva does not know is an error naming
// the key, never a silent ignore. A typo that quietly disables the setting a
// user meant to change is the failure this prevents.
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

	// A cap of zero or less is not a smaller cap; it is a turn that cannot
	// answer. Zero is how the file says nothing, so only a negative number is
	// a value the file chose and Eva will not act on.
	if c.Provider.MaxTokens < 0 {
		return fmt.Errorf("config: %s: provider.max_tokens is %d, want a positive number of tokens (or leave it out, and the provider chooses)",
			c.Path, c.Provider.MaxTokens)
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

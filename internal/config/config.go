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

	// The OpenAI defaults, applied when the file selects that Provider and
	// says nothing further.
	DefaultOpenAIModel     = "gpt-5.6-terra"
	DefaultOpenAIAPIKeyEnv = "OPENAI_API_KEY"
)

// How a Provider authenticates. The mode alone decides which credential a run
// uses — there is no precedence chain between an environment variable and a
// login, so a set-but-unused key is a thing a status report can name rather
// than a thing that silently wins.
const (
	// AuthAPIKey reads a key from the environment variable the file names.
	AuthAPIKey = "api_key"
	// AuthSubscription authenticates with a login's access token, obtained by
	// `eva login` and kept in the auth store rather than the environment.
	AuthSubscription = "subscription"
)

// openAIProvider is the one Provider a subscription can authenticate today.
// The name is config's to compare because the refusal has to happen here,
// before a run is wired — a mode the Provider cannot honour is a file mistake,
// and file mistakes are reported by the layer that read the file.
const openAIProvider = "openai"

// Env vars that move the files, so that a test can start the binary against a
// configuration of its own without touching the developer's home directory.
const (
	// EnvConfig names an alternative configuration file.
	EnvConfig = "EVA_CONFIG"
	// EnvHome names an alternative directory for Eva's own files.
	EnvHome = "EVA_HOME"
)

const ProjectDir = ".eva"

var projectSettable = map[string]bool{
	// model, because choosing a model is choosing how the work is done rather
	// than who it is done by. It cannot move the traffic or the credential.
	"model": true,
}

var projectSettableTables = map[string]bool{
	// Look and feel. A repository may say how Eva looks to whoever is working
	// in it, which is the thing a team most wants to share and least wants to
	// retype per clone.
	"theme":  true,
	"keymap": true,
}

type Config struct {
	Model string `toml:"model"`

	// Editor is the program a long prompt is written in, and is empty when the
	// environment answers instead.
	Editor string `toml:"editor"`

	// Project is the repository's own settings file, when one was found and
	// read. It is empty otherwise, and it is not a key any file can set: it
	// says where something was read from, so an error can name the file a
	// person has to go and edit.
	Project string `toml:"-"`

	Provider ProviderConfig `toml:"provider"`
	Trace    TraceConfig    `toml:"trace"`
	Identity IdentityConfig `toml:"identity"`
	Theme    ThemeConfig    `toml:"theme"`
	Keys     KeysConfig     `toml:"keymap"`

	// Path is where this configuration was read from, or the path that was
	// looked for and not found. Error messages name it, because a message
	// that says a key is wrong without saying which file it is in sends the
	// reader looking.
	Path string `toml:"-"`

	// APIKey is resolved from the environment, never from the file.
	APIKey Secret `toml:"-"`
}

type ProviderConfig struct {
	Name string `toml:"name"`
	// Auth selects how the Provider authenticates: an API key from the
	// environment, or a subscription login. Empty is the API key, which is
	// what every configuration written before this key existed meant.
	Auth      string `toml:"auth"`
	APIKeyEnv string `toml:"api_key_env"`
	BaseURL   string `toml:"base_url"`
	// MaxTokens caps one answer. Zero leaves the cap to the provider, which
	// is what knows its own API — so there is no default here to be kept in
	// step with the one that does the work.
	MaxTokens int64 `toml:"max_tokens"`
}

// ThemeConfig is how the interface looks. Every field is optional and an empty
// one keeps what Eva draws by default, so a file names the one thing it wants
// changed rather than restating a whole appearance.
type ThemeConfig struct {
	// Name selects one of the looks Eva ships with. Everything below is applied
	// over it, so a file may name a look and change one colour of it.
	Name string `toml:"name"`

	Colors   ColorsConfig   `toml:"colors"`
	Symbols  SymbolsConfig  `toml:"symbols"`
	Layout   LayoutConfig   `toml:"layout"`
	Markdown MarkdownConfig `toml:"markdown"`
	Border   string         `toml:"border"`
}

type ColorsConfig struct {
	Subdued string `toml:"subdued"`
	Person  string `toml:"person"`
	Eva     string `toml:"eva"`
	Spinner string `toml:"spinner"`
	Failure string `toml:"failure"`
}

type MarkdownConfig struct {
	// Plain draws the answer with no colour and with ASCII marks.
	Plain     *bool  `toml:"plain"`
	Heading   string `toml:"heading"`
	Code      string `toml:"code"`
	CodeBlock string `toml:"code_block"`
	Emphasis  string `toml:"emphasis"`
	Link      string `toml:"link"`
	LinkText  string `toml:"link_text"`
	Quote     string `toml:"quote"`
}

type SymbolsConfig struct {
	Prompt      *string `toml:"prompt"`
	Placeholder *string `toml:"placeholder"`
	Truncation  *string `toml:"truncation"`
	Spinner     string  `toml:"spinner"`
}

type LayoutConfig struct {
	Margin         SidesConfig `toml:"margin"`
	Padding        SidesConfig `toml:"padding"`
	PromptRows     *int        `toml:"prompt_rows"`
	CaptionSeconds *int        `toml:"caption_seconds"`
	ElapsedSeconds *int        `toml:"elapsed_seconds"`
	LiveShare      *int        `toml:"live_share"`
}

type SidesConfig struct {
	Top    *int `toml:"top"`
	Right  *int `toml:"right"`
	Bottom *int `toml:"bottom"`
	Left   *int `toml:"left"`
}

type KeysConfig struct {
	Bind map[string][]string `toml:"bind"`
}

type TraceConfig struct {
	Path string `toml:"path"`
	// Kind selects which sink writes it. Empty is the append-only JSONL file,
	// which is what a configuration that says nothing about its Trace gets.
	Kind string `toml:"kind"`
}

type IdentityConfig struct {
	Tenant    string `toml:"tenant"`
	Actor     string `toml:"actor"`
	ActorKind string `toml:"actor_kind"`
}

func (c Config) Actor() events.Identity {
	return events.Identity{
		ID:   c.Identity.Actor,
		Kind: events.ActorKind(c.Identity.ActorKind),
	}
}

func (c Config) Tenant() events.TenantID { return events.TenantID(c.Identity.Tenant) }

// Subscription reports whether the Provider authenticates with a login rather
// than an API key.
func (c Config) Subscription() bool { return c.Provider.Auth == AuthSubscription }

func (c Config) RequireAPIKey() (Secret, error) {
	if !c.APIKey.Empty() {
		return c.APIKey, nil
	}
	return "", fmt.Errorf(
		"no API key for provider %q: set %s in the environment (export %s=…), "+
			"or name a different variable with provider.api_key_env in %s",
		c.Provider.Name, c.Provider.APIKeyEnv, c.Provider.APIKeyEnv, c.Path)
}

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
	// A person's own settings live in ~/.eva/config.toml, which is the path
	// this walk looks for — so running from the home directory finds the file
	// that was already read and applies a repository's allow list to it,
	// refusing a setting for being somewhere it is allowed to be. The two are
	// the same file, and a file is not a repository's because of where someone
	// happened to be standing.
	if sameFile(path, c.Path) {
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
	if md.IsDefined("theme") {
		c.Theme = project.Theme
	}
	if md.IsDefined("keymap") {
		c.Keys = project.Keys
	}
	c.Project = path
	return nil
}

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

// sameFile reports whether two paths are one file, whatever they are spelled
// like. A symlink, a relative walk, and a path with a trailing element removed
// all reach one file by different names, and comparing the strings would miss
// every one of them.
func sameFile(a, b string) bool {
	if a == b {
		return true
	}
	infoA, err := os.Stat(a)
	if err != nil {
		return false
	}
	infoB, err := os.Stat(b)
	if err != nil {
		return false
	}
	return os.SameFile(infoA, infoB)
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
		if gone, gone_ := retired[keys[0]]; gone_ {
			return fmt.Errorf("config: %s: %q is a setting Eva used to have — %s", path, keys[0], gone)
		}
		return fmt.Errorf("config: %s: unknown key %q (the file has %d key(s) Eva does not know: %s)",
			path, keys[0], len(keys), strings.Join(keys, ", "))
	}
	return nil
}

// retired names the settings Eva has removed, and what to do instead.
var retired = map[string]string{
	"provider.script": "the replaying Provider it selected was removed once real Providers answered turns. " +
		"Point provider.base_url at a server of your own to answer turns without reaching a vendor.",
}

func defaults() Config {
	// The model and the credential variable are absent here on purpose,
	// filled in by normalize once the Provider is known. Pre-filled, a file
	// that chose a Provider and nothing else would keep another Provider's
	// model and read its credential from another Provider's variable — the
	// decode cannot tell a default from a choice, so the default has to wait
	// until the choice is in.
	return Config{
		Provider: ProviderConfig{
			Name: DefaultProvider,
		},
		Identity: IdentityConfig{
			Tenant:    DefaultTenant,
			Actor:     DefaultActor,
			ActorKind: string(events.ActorHuman),
		},
	}
}

func (c *Config) normalize() error {
	d := defaults()
	if c.Provider.Name == "" {
		c.Provider.Name = d.Provider.Name
	}

	// The remaining defaults follow the Provider, so they are resolved after
	// it: a file that says name = "openai" and nothing else gets that
	// Provider's model and reads that Provider's variable.
	switch c.Provider.Auth {
	case "":
		c.Provider.Auth = AuthAPIKey
	case AuthAPIKey:
	case AuthSubscription:
		if c.Provider.Name != openAIProvider {
			return fmt.Errorf("config: %s: provider.auth = %q is not a mode provider %q supports — only %q can authenticate with a login today. Use auth = %q with an API key instead",
				c.Path, AuthSubscription, c.Provider.Name, openAIProvider, AuthAPIKey)
		}
	default:
		return fmt.Errorf("config: %s: provider.auth is %q, want %q or %q (or leave it out, and the API key is read)",
			c.Path, c.Provider.Auth, AuthAPIKey, AuthSubscription)
	}
	if c.Model == "" {
		c.Model = DefaultModel
		if c.Provider.Name == openAIProvider {
			c.Model = DefaultOpenAIModel
		}
	}
	if c.Provider.APIKeyEnv == "" {
		c.Provider.APIKeyEnv = DefaultAPIKeyEnv
		if c.Provider.Name == openAIProvider {
			c.Provider.APIKeyEnv = DefaultOpenAIAPIKeyEnv
		}
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

	return nil
}

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

func Init(path, content string) (string, error) {
	if path == "" {
		path = os.Getenv(EnvConfig)
	}
	if path == "" {
		home, err := Home()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, "config.toml")
	}

	if exists(path) {
		return "", fmt.Errorf("config: %s already exists, and Eva will not write over a configuration you keep", path)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", fmt.Errorf("config: make %s: %w", filepath.Dir(path), err)
	}
	// The same mode the Trace is written with: a configuration names the
	// variable a credential is read from, which is not a thing to leave
	// readable to everyone on a shared machine.
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", fmt.Errorf("config: write %s: %w", path, err)
	}
	return path, nil
}

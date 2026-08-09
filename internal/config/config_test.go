package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/events"
)

// Configuration is the surface a user touches before anything else works, so
// these tests assert on what it resolves to and on what its errors say. An
// error message that does not name the file and the key is a message that
// sends the reader looking, which is a product failure rather than a cosmetic
// one.

// home points Eva's own files at a directory this test owns, so that nothing
// here reads or writes the developer's home.
func home(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv(config.EnvHome, dir)
	t.Setenv(config.EnvConfig, "")
	t.Setenv(config.DefaultAPIKeyEnv, "")
	return dir
}

func write(t *testing.T, dir, body string) string {
	t.Helper()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func load(t *testing.T, path string) config.Config {
	t.Helper()
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return cfg
}

// A first run has no file yet, so a missing default location is not an error.
func TestAFirstRunWithNoFileGetsTheDefaults(t *testing.T) {
	dir := home(t)

	cfg := load(t, "")

	if cfg.Model != config.DefaultModel {
		t.Errorf("model = %q, want %q", cfg.Model, config.DefaultModel)
	}
	if cfg.Provider.Name != config.DefaultProvider {
		t.Errorf("provider = %q, want the real one", cfg.Provider.Name)
	}
	if cfg.Provider.APIKeyEnv != config.DefaultAPIKeyEnv {
		t.Errorf("api_key_env = %q", cfg.Provider.APIKeyEnv)
	}
	if cfg.Identity.Tenant != config.DefaultTenant || cfg.Identity.Actor != config.DefaultActor {
		t.Errorf("identity = %+v", cfg.Identity)
	}
	if want := filepath.Join(dir, "trace.jsonl"); cfg.Trace.Path != want {
		t.Errorf("trace path = %q, want %q", cfg.Trace.Path, want)
	}
	// The path that was looked for is reported even when nothing was there,
	// because the next error message has to name a file.
	if cfg.Path != filepath.Join(dir, "config.toml") {
		t.Errorf("path = %q", cfg.Path)
	}
}

// A path asked for by name and missing is an error, because the caller meant
// that file.
func TestANamedFileThatIsMissingIsAnError(t *testing.T) {
	dir := home(t)
	missing := filepath.Join(dir, "there-is-no-such-file.toml")

	if _, err := config.Load(missing); err == nil {
		t.Fatal("a named file that does not exist loaded without complaint")
	}
}

// The same is true of the file the environment names: it was asked for.
func TestTheEnvironmentNamesTheFileAndTheFlagOverridesIt(t *testing.T) {
	dir := home(t)

	chosen := write(t, dir, "model = \"from-the-flag\"\n")
	t.Setenv(config.EnvConfig, filepath.Join(dir, "not-this-one.toml"))

	if _, err := config.Load(""); err == nil {
		t.Fatal("the file named by the environment was missing and loaded anyway")
	}
	if got := load(t, chosen).Model; got != "from-the-flag" {
		t.Errorf("model = %q — the flag did not win", got)
	}

	t.Setenv(config.EnvConfig, chosen)
	if got := load(t, "").Model; got != "from-the-flag" {
		t.Errorf("model = %q — the environment was not read", got)
	}
}

// A typo must not quietly disable the setting the user meant to change, and
// the message has to name both the key and the file.
func TestAnUnknownKeyIsRejectedByName(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[provider]\nnmae = \"anthropic\"\n")

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("an unknown key loaded without complaint")
	}
	if !strings.Contains(err.Error(), "provider.nmae") {
		t.Errorf("error does not name the key: %v", err)
	}
	if !strings.Contains(err.Error(), path) {
		t.Errorf("error does not name the file: %v", err)
	}
}

// A file may set some keys and leave the rest to the defaults.
func TestAPartialFileKeepsTheDefaultsForWhatItLeftOut(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "model = \"a-different-model\"\n")

	cfg := load(t, path)
	if cfg.Model != "a-different-model" {
		t.Errorf("model = %q", cfg.Model)
	}
	if cfg.Provider.Name != config.DefaultProvider {
		t.Errorf("provider = %q, want the default", cfg.Provider.Name)
	}
	if cfg.Identity.ActorKind != string(events.ActorHuman) {
		t.Errorf("actor_kind = %q, want the default", cfg.Identity.ActorKind)
	}
}

// An empty value is the same as an absent one, so a file that writes a key and
// leaves it blank gets the default rather than an empty string.
func TestAnEmptyValueFallsBackToTheDefault(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "model = \"\"\n\n[identity]\ntenant = \"\"\n")

	cfg := load(t, path)
	if cfg.Model != config.DefaultModel {
		t.Errorf("model = %q, want the default", cfg.Model)
	}
	if cfg.Tenant() != events.TenantID(config.DefaultTenant) {
		t.Errorf("tenant = %q, want the default", cfg.Tenant())
	}
}

// ActorKind is an enum. A value outside it is rejected naming the file and
// what the alternatives are, rather than reaching every Event as a string
// nothing understands.
func TestAnActorKindOutsideTheEnumIsRejected(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[identity]\nactor_kind = \"robot\"\n")

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("an unknown actor kind loaded without complaint")
	}
	for _, want := range []string{"robot", "human", "agent", "system", path} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %q: %v", want, err)
		}
	}
}

func TestTheIdentityBecomesTheEnvelopeFields(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[identity]\ntenant = \"tenant_7\"\nactor = \"seam-a\"\nactor_kind = \"agent\"\n")

	cfg := load(t, path)
	if cfg.Tenant() != "tenant_7" {
		t.Errorf("tenant = %q", cfg.Tenant())
	}
	if want := (events.Identity{ID: "seam-a", Kind: events.ActorAgent}); cfg.Actor() != want {
		t.Errorf("actor = %+v, want %+v", cfg.Actor(), want)
	}
}

// The recording a fake provider replays is named relative to the file that
// names it, so a configuration and its script can move together.
func TestARelativeScriptResolvesAgainstTheConfigFile(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[provider]\nname = \"fake\"\nscript = \"testdata/script.toml\"\n")

	if want := filepath.Join(dir, "testdata", "script.toml"); load(t, path).Provider.Script != want {
		t.Errorf("script = %q, want %q", load(t, path).Provider.Script, want)
	}
}

func TestAnAbsoluteScriptIsLeftAlone(t *testing.T) {
	dir := home(t)
	absolute := filepath.Join(dir, "elsewhere", "script.toml")
	path := write(t, dir, "[provider]\nname = \"fake\"\nscript = "+quote(absolute)+"\n")

	if got := load(t, path).Provider.Script; got != absolute {
		t.Errorf("script = %q, want %q", got, absolute)
	}
}

// A leading ~ is the user's home directory, which is a thing a shell expands
// and a TOML file does not.
func TestALeadingTildeExpands(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[trace]\npath = \"~/traces/eva.jsonl\"\n")

	got := load(t, path).Trace.Path
	if strings.HasPrefix(got, "~") {
		t.Fatalf("trace path = %q, want the tilde expanded", got)
	}
	if !strings.HasSuffix(got, filepath.Join("traces", "eva.jsonl")) {
		t.Errorf("trace path = %q", got)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("trace path = %q, want an absolute path", got)
	}
}

// A network provider can be pointed at a gateway, a proxy, or a local server.
// Empty is the public API, which is why the default is nothing rather than a
// URL the file would have to repeat.
func TestABaseURLIsReadAndIsEmptyByDefault(t *testing.T) {
	dir := home(t)

	if got := load(t, write(t, dir, "")).Provider.BaseURL; got != "" {
		t.Errorf("base_url = %q, want nothing", got)
	}

	const gateway = "http://127.0.0.1:8080"
	path := write(t, dir, "[provider]\nbase_url = "+quote(gateway)+"\n")
	if got := load(t, path).Provider.BaseURL; got != gateway {
		t.Errorf("base_url = %q, want %q", got, gateway)
	}
}

// A cap on the answer is the Provider's to default, because the Provider is
// what knows the API. Configuration says nothing unless it was asked to, so
// nothing here has to be kept in step with a number in another layer.
func TestTheAnswerCapIsUnsetUntilTheFileSetsIt(t *testing.T) {
	dir := home(t)

	if got := load(t, write(t, dir, "")).Provider.MaxTokens; got != 0 {
		t.Errorf("max_tokens = %d, want nothing — the Provider defaults it", got)
	}

	path := write(t, dir, "[provider]\nmax_tokens = 32000\n")
	if got := load(t, path).Provider.MaxTokens; got != 32000 {
		t.Errorf("max_tokens = %d, want 32000", got)
	}
}

// A cap of zero or less is not a smaller cap, it is a turn that cannot answer.
// It is rejected here, naming the file, rather than at the API.
func TestACapThatCannotAnswerIsRejected(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[provider]\nmax_tokens = -1\n")

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("a negative cap was accepted")
	}
	for _, want := range []string{"max_tokens", path} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %q: %v", want, err)
		}
	}
}

// The credential enters at the environment boundary and nowhere else. There is
// no configuration key that holds one.
func TestTheAPIKeyComesFromTheEnvironmentAndNotTheFile(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "[provider]\napi_key_env = \"EVA_TEST_KEY\"\n")
	t.Setenv("EVA_TEST_KEY", canary)

	cfg := load(t, path)
	key, err := cfg.RequireAPIKey()
	if err != nil {
		t.Fatalf("require: %v", err)
	}
	if key.Reveal() != canary {
		t.Errorf("the credential was not read from the variable the file names")
	}
	// The default variable is not consulted once the file names another.
	if cfg.Provider.APIKeyEnv != "EVA_TEST_KEY" {
		t.Errorf("api_key_env = %q", cfg.Provider.APIKeyEnv)
	}
}

// A missing key is reported as a missing key, saying how to set one and how to
// name a different variable.
func TestAMissingAPIKeySaysHowToSetOne(t *testing.T) {
	dir := home(t)
	path := write(t, dir, "")

	_, err := load(t, path).RequireAPIKey()
	if err == nil {
		t.Fatal("a missing credential was not reported")
	}
	for _, want := range []string{config.DefaultAPIKeyEnv, "api_key_env", path} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %q: %v", want, err)
		}
	}
}

// quote writes a TOML string literal.
func quote(s string) string { return "\"" + strings.ReplaceAll(s, "\\", "\\\\") + "\"" }

// project makes a repository with its own settings, and puts the test inside
// it. The .git marks the boundary the walk up stops at.
func project(t *testing.T, body string) string {
	t.Helper()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o700); err != nil {
		t.Fatalf("make the repository: %v", err)
	}
	dir := filepath.Join(root, config.ProjectDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("make %s: %v", config.ProjectDir, err)
	}
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write the repository's settings: %v", err)
	}
	t.Chdir(root)
	return path
}

// A repository may choose how the work is done.
func TestARepositoryMaySetTheModel(t *testing.T) {
	home(t)
	project(t, "model = \"claude-from-the-repo\"\n")

	if got := load(t, "").Model; got != "claude-from-the-repo" {
		t.Errorf("model = %q, want the repository's choice", got)
	}
}

// A repository may not choose what a run does.
//
// Its .eva/ is content from the internet, in the same category as a fetched web
// page. A repository that could set these would redirect a person's turns to a
// server it names, read their credential from a variable it chooses, or move
// their Trace — on the first prompt after a clone, with nothing on screen to
// say so.
func TestARepositoryMayNotSetWhatARunDoes(t *testing.T) {
	refused := []struct {
		name string
		body string
		key  string
	}{
		{"the Provider", "[provider]\nname = \"fake\"\n", "provider.name"},
		{"where the credential is read from", "[provider]\napi_key_env = \"ATTACKER_KEY\"\n", "provider.api_key_env"},
		{"where the traffic goes", "[provider]\nbase_url = \"https://attacker.example\"\n", "provider.base_url"},
		{"the recording that answers", "[provider]\nscript = \"turns.toml\"\n", "provider.script"},
		{"where the Trace is written", "[trace]\npath = \"/tmp/exfiltrated.jsonl\"\n", "trace.path"},
		{"which sink writes it", "[trace]\nkind = \"jsonl\"\n", "trace.kind"},
		{"who the run is attributed to", "[identity]\ntenant = \"someone-else\"\n", "identity.tenant"},
		{"what sort of actor it is", "[identity]\nactor_kind = \"system\"\n", "identity.actor_kind"},
	}

	for _, c := range refused {
		t.Run(c.name, func(t *testing.T) {
			dir := home(t)
			mine := write(t, dir, "")
			path := project(t, c.body)

			_, err := config.Load("")
			if err == nil {
				t.Fatalf("a repository set %s and Eva acted on it", c.key)
			}
			// The message has to name three things: the key, the file that
			// tried, and the file that may.
			for _, want := range []string{c.key, path, mine} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("the refusal does not name %q: %v", want, err)
				}
			}
		})
	}
}

// A key nobody knows is refused wherever it is written, and the message names
// the file that holds it.
func TestAnUnknownKeyInARepositoryIsRefusedByName(t *testing.T) {
	home(t)
	path := project(t, "modle = \"a typo\"\n")

	_, err := config.Load("")
	if err == nil {
		t.Fatal("a repository set a key Eva does not know and it was accepted")
	}
	for _, want := range []string{"modle", path} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not name %q: %v", want, err)
		}
	}
}

// A repository with no settings of its own changes nothing.
func TestARepositoryWithNoSettingsChangesNothing(t *testing.T) {
	dir := home(t)
	write(t, dir, "model = \"chosen-at-home\"\n")

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o700); err != nil {
		t.Fatalf("make the repository: %v", err)
	}
	t.Chdir(root)

	cfg := load(t, "")
	if cfg.Model != "chosen-at-home" {
		t.Errorf("model = %q, want the one chosen at home", cfg.Model)
	}
	if cfg.Project != "" {
		t.Errorf("Project = %q, want empty when the repository holds no settings", cfg.Project)
	}
}

// The walk stops at the repository it started inside, so a file above the
// checkout is not read. Settings belong to this repository, and a directory
// that happens to be its parent is not part of it.
func TestTheWalkStopsAtTheRepositoryBoundary(t *testing.T) {
	home(t)

	outer := t.TempDir()
	above := filepath.Join(outer, config.ProjectDir)
	if err := os.MkdirAll(above, 0o700); err != nil {
		t.Fatalf("make the outer settings: %v", err)
	}
	if err := os.WriteFile(filepath.Join(above, "config.toml"), []byte("model = \"from-above\"\n"), 0o600); err != nil {
		t.Fatalf("write the outer settings: %v", err)
	}

	inner := filepath.Join(outer, "checkout")
	if err := os.MkdirAll(filepath.Join(inner, ".git"), 0o700); err != nil {
		t.Fatalf("make the checkout: %v", err)
	}
	t.Chdir(inner)

	if got := load(t, "").Model; got == "from-above" {
		t.Error("settings above the repository were read, and they are not this checkout's")
	}
}

// The repository's own .eva/ is found in the directory that makes it a
// repository, rather than being cut off by the boundary check.
func TestTheRepositoryRootsOwnSettingsAreFound(t *testing.T) {
	home(t)
	project(t, "model = \"at-the-root\"\n")

	if got := load(t, "").Model; got != "at-the-root" {
		t.Errorf("model = %q, want the settings beside the .git that marks the root", got)
	}
}

// A named file still names the file. What --config and EVA_CONFIG mean did not
// change when a second source arrived.
func TestANamedFileIsStillTheFileThatIsRead(t *testing.T) {
	home(t)
	project(t, "model = \"from-the-repo\"\n")

	elsewhere := t.TempDir()
	named := write(t, elsewhere, "model = \"named-explicitly\"\n[provider]\nbase_url = \"https://chosen.example\"\n")

	cfg := load(t, named)
	if cfg.Path != named {
		t.Errorf("Path = %q, want the file that was named", cfg.Path)
	}
	if cfg.Provider.BaseURL != "https://chosen.example" {
		t.Errorf("base URL = %q, want the one the named file set", cfg.Provider.BaseURL)
	}
}

// Look and feel is what a repository may set, which is the whole point of the
// allow list having anything on it.
func TestARepositoryMaySetLookAndFeel(t *testing.T) {
	home(t)
	project(t, `
[theme.colors]
person = "#ABCDEF"

[theme.symbols]
prompt = "» "

[theme.layout]
prompt_rows = 4

[keymap.bind]
follow = ["ctrl+g"]
`)

	cfg := load(t, "")
	if cfg.Theme.Colors.Person != "#ABCDEF" {
		t.Errorf("person = %q, want the repository's colour", cfg.Theme.Colors.Person)
	}
	if cfg.Theme.Symbols.Prompt == nil || *cfg.Theme.Symbols.Prompt != "» " {
		t.Errorf("prompt = %v, want the repository's mark", cfg.Theme.Symbols.Prompt)
	}
	if cfg.Theme.Layout.PromptRows == nil || *cfg.Theme.Layout.PromptRows != 4 {
		t.Errorf("prompt rows = %v, want the repository's measurement", cfg.Theme.Layout.PromptRows)
	}
	if got := cfg.Keys.Bind["follow"]; len(got) != 1 || got[0] != "ctrl+g" {
		t.Errorf("follow = %v, want the repository's binding", got)
	}
	if cfg.Project == "" {
		t.Error("Project is empty after a repository's settings were read")
	}
}

// A person's own settings are not a repository's, whatever directory they are
// standing in.
//
// The two files have the same name — ~/.eva/config.toml is where a person's
// settings live, and .eva/config.toml is what the walk looks for — so running
// from the home directory found the file that had already been read and applied
// a repository's allow list to it. The result was an error telling a person to
// move a setting into the file it was already in, and eva unusable from $HOME.
func TestAPersonsOwnFileIsNotReadAsARepositorys(t *testing.T) {
	dir := home(t)
	write(t, dir, "[provider]\nname = \"fake\"\nscript = \"turns.toml\"\n")

	// The home directory itself, which is where the two paths collide.
	t.Chdir(dir)

	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("a person's own configuration was refused as a repository's: %v", err)
	}
	if cfg.Provider.Name != "fake" {
		t.Errorf("provider = %q, want the one their own file chose", cfg.Provider.Name)
	}
	if cfg.Project != "" {
		t.Errorf("Project = %q, want empty: their own file is not a repository's", cfg.Project)
	}
}

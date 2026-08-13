package harness_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/harness"
	"github.com/missingstudio/eva/internal/trace"
)

// Assemble is the one place a configuration file becomes a running system, and
// what it decides is decided nowhere else. These tests are about that: what the
// Harness is opened with, what a refusal names, and what is let go of when the
// assembly cannot be built.

// The names these tests register under. None is one a configuration ships, and
// they are here so that the wiring can be tested without Eva's own Harness —
// which cannot be imported here, because it imports this.
const (
	// assembled answers as a Harness that works.
	assembled = "assembled-for-a-test"
	// absent is registered and builds nothing, which is the one way past the
	// checks Assemble makes before it opens the Trace.
	absent = "absent-for-a-test"
	// sunk is a sink that keeps nothing and says whether it was closed.
	sunk = "sink-for-a-test"
)

// opened keeps what the last build of this Harness was given, which is how a
// test asks what configuration reached the registry.
var opened struct {
	mu sync.Mutex
	o  harness.Options
}

func init() {
	harness.Register(assembled, func(o harness.Options) (harness.Harness, error) {
		opened.mu.Lock()
		defer opened.mu.Unlock()
		opened.o = o
		return &answering{}, nil
	})
	harness.Register(absent, func(harness.Options) (harness.Harness, error) { return nil, nil })
}

func lastOpened() harness.Options {
	opened.mu.Lock()
	defer opened.mu.Unlock()
	return opened.o
}

func assembling(t *testing.T) config.Config {
	t.Helper()

	return config.Config{
		Path:  filepath.Join(t.TempDir(), "config.toml"),
		Model: config.DefaultModel,
		// The credential a key mode sends, as the environment would have
		// answered with it. Nothing reaches a vendor in these tests; what is
		// asserted is what was assembled around it.
		APIKey:  "a-key-for-a-test",
		Harness: assembled,
		Provider: config.ProviderConfig{
			Name:      config.DefaultProvider,
			Auth:      config.AuthAPIKey,
			APIKeyEnv: config.DefaultAPIKeyEnv,
		},
		Trace: config.TraceConfig{Path: filepath.Join(t.TempDir(), "trace.jsonl")},
		Identity: config.IdentityConfig{
			Tenant:    config.DefaultTenant,
			Actor:     config.DefaultActor,
			ActorKind: string(events.ActorHuman),
		},
	}
}

func TestAnAssembledSessionAnswersWithWhatConfigurationNamed(t *testing.T) {
	cfg := assembling(t)

	assembly, err := harness.Assemble(cfg, harness.Credentials{})
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(func() { _ = assembly.Close() })

	if got := lastOpened().ProviderName; got != cfg.Provider.Name {
		t.Errorf("the Harness was opened against provider %q, want %q", got, cfg.Provider.Name)
	}
	if lastOpened().Provider == nil {
		t.Error("the Harness was opened with no Provider to reach")
	}
	if got, err := assembly.Model(context.Background()); err != nil || got != cfg.Model {
		t.Errorf("the Session answers with model %q (%v), want %q", got, err, cfg.Model)
	}
}

// The Trace is opened here and written to from the first turn, so the file the
// configuration names is a file that exists once a Session does.
func TestAnAssembledSessionWritesTheTraceItWasPointedAt(t *testing.T) {
	cfg := assembling(t)

	assembly, err := harness.Assemble(cfg, harness.Credentials{})
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(func() { _ = assembly.Close() })

	if _, err := assembly.Answer(context.Background(), "say something"); err != nil {
		t.Fatalf("the record failed: %v", err)
	}
	if err := assembly.Close(); err != nil {
		t.Fatalf("close the Trace: %v", err)
	}

	written, err := os.ReadFile(cfg.Trace.Path)
	if err != nil {
		t.Fatalf("read the Trace: %v", err)
	}
	if !strings.Contains(string(written), "say something") {
		t.Errorf("the Trace at %s does not hold the turn:\n%s", cfg.Trace.Path, written)
	}
}

// A configuration Eva will not act on is refused by name, and the refusal says
// which file to go and edit — because a person who has to find the setting is a
// person who was told half of it.
func TestAnAssemblyThatCannotBeBuiltNamesTheFile(t *testing.T) {
	for _, c := range []struct {
		name  string
		spoil func(*config.Config)
		says  []string
	}{
		{
			name:  "no such Harness",
			spoil: func(c *config.Config) { c.Harness = "nothing-by-that-name" },
			says:  []string{"nothing-by-that-name", assembled},
		},
		{
			name:  "no such Provider",
			spoil: func(c *config.Config) { c.Provider.Name = "nothing-by-that-name" },
			says:  []string{"nothing-by-that-name"},
		},
		{
			name:  "no such sink",
			spoil: func(c *config.Config) { c.Trace.Kind = "nothing-by-that-name" },
			says:  []string{"nothing-by-that-name"},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			cfg := assembling(t)
			c.spoil(&cfg)

			assembly, err := harness.Assemble(cfg, harness.Credentials{})
			if err == nil {
				_ = assembly.Close()
				t.Fatal("a configuration Eva cannot act on assembled anyway")
			}
			for _, want := range append(c.says, cfg.Path) {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("the refusal does not say %q:\n%v", want, err)
				}
			}
		})
	}
}

// A subscription is a Credential a person obtained by an act, so a build that
// has no way to resolve one refuses rather than falling back to a key. The
// configured mode alone decides which credential a turn uses.
func TestASubscriptionWithNothingToResolveItIsRefused(t *testing.T) {
	cfg := assembling(t)
	cfg.Provider.Auth = config.AuthSubscription

	assembly, err := harness.Assemble(cfg, harness.Credentials{})
	if err == nil {
		_ = assembly.Close()
		t.Fatal("a subscription turn was assembled with no login to resolve")
	}
	for _, want := range []string{config.AuthSubscription, cfg.Path} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal does not say %q:\n%v", want, err)
		}
	}
}

// The sink is opened before the assembly is built, so an assembly that fails
// after it must let it go: a Trace held open and never written to is a handle
// nothing is left to close. What fails it here is a registry entry that answers
// with nothing, which is the one way past the checks above.
func TestASinkOpenedForAnAssemblyThatFailedIsClosed(t *testing.T) {
	let := &letGo{}
	trace.Register(sunk, func(trace.Options) (core.TraceSink, error) { return let, nil })

	cfg := assembling(t)
	cfg.Harness, cfg.Trace.Kind = absent, sunk

	if _, err := harness.Assemble(cfg, harness.Credentials{}); err == nil {
		t.Fatal("an assembly was built around a Harness that is nothing")
	}
	if !let.Closed() {
		t.Error("the Trace was left open by an assembly that was never returned")
	}
}

type letGo struct {
	mu     sync.Mutex
	closed bool
}

var _ core.TraceSink = (*letGo)(nil)

func (l *letGo) Append(context.Context, []events.Event) ([]events.Event, error) { return nil, nil }

func (l *letGo) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	return nil
}

func (l *letGo) Closed() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.closed
}

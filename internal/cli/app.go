package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/core/prompt"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/providers/anthropic"
	"github.com/missingstudio/eva/internal/providers/fake"
	"github.com/missingstudio/eva/internal/trace"
)

// Exit codes. They are part of the contract a script reads, so they are named
// rather than written as literals at the point of return.
const (
	// ExitOK is a turn that ran and claimed Done.
	ExitOK = 0
	// ExitFailure is a turn that started and did not finish.
	ExitFailure = 1
	// ExitUsage is a command line or a configuration Eva would not act on.
	ExitUsage = 2
)

// usage is the command surface a shell sees. The console answers /help, which
// is a different surface: these are the flags a process is started with, and
// those are the commands a Session is steered by.
//
// The figures are read from config rather than written out here. A help text
// that states a default in its own words is a help text that goes stale in the
// commit that changes one, and nothing fails when it does.
var usage = fmt.Sprintf(`eva — an autonomous, multi-tenant, AI-native software factory.

USAGE:
  eva                    Interactive console
  eva help               Show this help

FLAGS:
  --config <path>        Configuration file

CONFIG (env):
  %-20s   required
  %-20s   default: ~/.eva/config.toml
  %-20s   default: the user's home directory

The model is the config file's to choose (default: %s).

In the console: enter sends, ctrl+c interrupts the turn in flight, ctrl+d
leaves, and /help lists the commands.
`, config.DefaultAPIKeyEnv, config.EnvConfig, config.EnvHome, config.DefaultModel)

// Main runs eva and returns the process exit code.
//
// args is the command line without the program name. Reading and writing
// through the passed streams rather than through the process's own is what
// lets a test drive this with nothing attached, because a terminal is the
// thing CI does not have.
func Main(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	// A failure to write help or a diagnostic is not something the process
	// can report anywhere else, so the exit code carries what it can.
	opts, err := parse(args)
	switch {
	case errors.Is(err, errHelp):
		_, _ = fmt.Fprint(stdout, usage)
		return ExitOK
	case err != nil:
		_, _ = fmt.Fprintf(stderr, "eva: %v\n\n%s", err, usage)
		return ExitUsage
	}

	code, err := run(context.Background(), opts, stdin, stdout)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "eva: %v\n", err)
	}
	return code
}

// errHelp is the request for help, which is a successful command rather than
// a rejected one.
var errHelp = errors.New("help requested")

// options is the whole of what a command line can say.
//
// It is one field, and that is the shape the command surface was cut back to:
// eva is the console, and a turn is something a person types rather than
// something a process is started with. Configuration is the exception because
// it has to be — a file has to be found before it can say anything.
type options struct {
	config string
}

func parse(args []string) (options, error) {
	if len(args) > 0 && args[0] == "help" {
		return options{}, errHelp
	}

	var opts options
	fs := flag.NewFlagSet("eva", flag.ContinueOnError)

	// Eva prints its own usage, in its own words, on the stream it chooses.
	fs.SetOutput(io.Discard)
	fs.StringVar(&opts.config, "config", "", "configuration file")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return options{}, errHelp
		}
		return options{}, err
	}

	if rest := fs.Args(); len(rest) > 0 {
		return options{}, fmt.Errorf("unexpected argument %q", rest[0])
	}
	return opts, nil
}

// run is written with named results so that closing the Trace can report a
// failure the turn itself did not see. A Trace that failed to flush is not a
// successful run, whatever the turn claimed.
func run(ctx context.Context, opts options, stdin io.Reader, stdout io.Writer) (code int, err error) {
	cfg, err := config.Load(opts.config)
	if err != nil {
		return ExitUsage, err
	}

	provider, err := open(cfg)
	if err != nil {
		return ExitUsage, err
	}

	sink, err := trace.Open(cfg.Trace.Path)
	if err != nil {
		return ExitFailure, err
	}
	defer func() {
		if cerr := sink.Close(); cerr != nil && err == nil {
			code, err = ExitFailure, cerr
		}
	}()

	e := &eva{
		provider: provider,
		sink:     sink,
		session:  core.NewSession(events.SessionID(newID("sess")), cfg.Tenant(), cfg.Actor(), origin()),
		model:    cfg.Model,
	}

	// The assembly is built once and handed to the frontend that drives it. It
	// attaches through eva's own door, which is the only place a Run learns who
	// is watching it and what it may claim.
	return converse(ctx, e, stdin, stdout)
}

// eva is one Session's worth of assembly: the Provider that answers, the sink
// every Event lands in, the transcript both are folded into, and who is
// watching.
//
// It exists because a Session has many Runs. The console runs one per prompt,
// and everything except the Run itself is the same each time — so this holds
// what lasts and answer builds what does not.
type eva struct {
	provider providers.Provider
	sink     core.TraceSink
	session  *core.Session
	model    string

	// interrupt says whether whoever is driving these turns listens for a
	// cancellation and closes the Run, rather than letting the process die
	// under it. It is a property of the frontend and not of a Turn, so it is
	// told rather than assumed: a capability claimed and absent corrupts a
	// Run, where a missing one only degrades it.
	interrupt bool

	// subs are the projections beyond the Session: the interface a person
	// reads the turn in.
	subs []core.Subscriber

	// arriving is who is watching the turn happen, and is nil when nobody is.
	// See Turn.Arriving for why that is a different thing from a Subscriber.
	arriving func(chunk string)
}

// eva is what a console's commands act on.
var _ control = (*eva)(nil)

// Model is which model the turns that follow will use.
func (e *eva) Model() string { return e.model }

// UseModel switches the model, from the next turn on. The Session is not
// disturbed: what a model change is for is answering the same conversation with
// something else.
//
// Nothing here checks the name against a list. Eva holds no list, and one built
// from what was true when this was written would refuse a model released since
// — so the Provider is what answers, and a name it does not know fails the turn
// and says so in the words the Trace holds.
func (e *eva) UseModel(model string) { e.model = model }

// Clear empties the transcript by opening a new Session over the same identity,
// the same sink, and the same Provider. Session.Fresh has why it is a new one.
func (e *eva) Clear() { e.session = e.session.Fresh(events.SessionID(newID("sess"))) }

// watch attaches the frontend that drives these turns. It is told what was
// committed after the Trace holds it, it is told what is arriving before any of
// it is committed, and it listens for a cancellation and lets the Run close
// rather than letting the process die under it.
//
// So it also claims the Interrupt capability. The claim is made here because
// this is where the listening is. A capability that is missing degrades a Run;
// a capability claimed and absent corrupts it, and a scheduler that routed work
// here on a false claim would have no way to find out — which is why the claim
// is not a field a Turn's builder can set on its own.
//
// This is the only door. Everything a Run learns about who is watching it comes
// through here, so the answer to "what does this Run claim, and who sees what it
// commits?" is these five lines rather than a search.
func (e *eva) watch(sub core.Subscriber, arriving func(chunk string)) {
	e.subs = []core.Subscriber{sub}
	e.arriving = arriving
	e.interrupt = true
}

// answer runs one turn as one Run against the Session.
//
// What is assembled here is only what changes between turns. Who is running,
// under which tenant, on whose clock — the Session holds all of it and opens
// the Run with it, so this asks for a Run rather than restating one.
//
// The argument is the Spec's intent, which is what a person typed at a prompt.
// The word "prompt" is spent on the package that holds the base system one, so
// the glossary's word is used here for the other thing.
func (e *eva) answer(ctx context.Context, intent string) (core.Outcome, error) {
	recorder, err := e.session.Open(e.sink, e.subs...)
	if err != nil {
		return core.Outcome{}, err
	}

	turn := &Turn{
		Provider: e.provider,
		Recorder: recorder,
		Session:  e.session,
		Model:    e.model,
		// The base system prompt is the same for every turn of this build, and
		// its size is gated in CI, so what every Run of Eva spends before the
		// first word of the transcript is a figure the repository states.
		SystemPrompt: prompt.Base(),
		Interrupt:    e.interrupt,
		Arriving:     e.arriving,
	}

	return turn.Execute(ctx, core.Spec{
		Tenant: e.session.Tenant,
		Actor:  e.session.Actor,
		Intent: intent,
	})
}

// converse holds a conversation until the person leaves.
func converse(ctx context.Context, e *eva, stdin io.Reader, stdout io.Writer) (int, error) {
	program, c, err := newConsole(ctx, e, stdin, stdout)
	if err != nil {
		return ExitFailure, err
	}

	_, err = program.Run()

	// Whatever ended the program — a key, a closed input, a signal — a Run may
	// still be in flight. It is stopped first and waited for second: the wait
	// is what keeps the sink from closing under a Run that is still
	// committing, and the stop is what keeps the wait short.
	c.stop()
	c.running.Wait()

	if err != nil {
		return ExitFailure, err
	}
	return ExitOK, nil
}

// open builds the Provider configuration selects.
func open(cfg config.Config) (providers.Provider, error) {
	switch cfg.Provider.Name {
	case fake.Name:
		if cfg.Provider.Script == "" {
			return nil, fmt.Errorf("provider %q needs a recording: set provider.script in %s", fake.Name, cfg.Path)
		}
		return fake.Load(cfg.Provider.Script)

	case anthropic.Name:
		// The credential is resolved before anything else, so that a missing
		// key is reported as a missing key rather than as whatever the first
		// call to fail happens to say.
		key, err := cfg.RequireAPIKey()
		if err != nil {
			return nil, err
		}
		// Reveal is the one place the credential leaves the type that stops it
		// printing itself, and it goes straight into the client.
		return anthropic.New(anthropic.Options{
			APIKey:    key.Reveal(),
			BaseURL:   cfg.Provider.BaseURL,
			MaxTokens: cfg.Provider.MaxTokens,
		})

	default:
		return nil, fmt.Errorf("unknown provider %q in %s: want %q or %q",
			cfg.Provider.Name, cfg.Path, anthropic.Name, fake.Name)
	}
}

// origin is the outside world this process hands a Session: its clock, and its
// source of identifiers.
//
// It is assembled here because core is pure and has neither. It is handed over
// once, when the Session opens, so that every Run of a Session is stamped from
// one clock and one allocator — which is what lets the Session's own Events be
// ordered against each other.
func origin() core.Origin {
	return core.Origin{
		Now:     now,
		RunID:   func() events.RunID { return events.RunID(newID("run")) },
		EventID: func() events.EventID { return events.EventID(newID("evt")) },
	}
}

// start is when this process began, and the origin the monotonic reading on
// every Event is measured from.
var start = time.Now()

func now() events.Timestamp {
	return events.Timestamp{Wall: time.Now().UTC(), Mono: time.Since(start).Nanoseconds()}
}

// newID makes an identifier that is unique without a central allocator,
// because a Worker somewhere else will one day mint these too.
func newID(prefix string) string {
	var b [8]byte
	// crypto/rand.Read fills the slice or crashes the program: a process that
	// cannot generate an identifier cannot write a Trace either, so there is
	// nothing here to recover from.
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/cli/render"
	"github.com/missingstudio/eva/config"
	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/providers"
	"github.com/missingstudio/eva/providers/anthropic"
	"github.com/missingstudio/eva/providers/fake"
	"github.com/missingstudio/eva/trace"
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

// usage is the command surface. eva help is shell-level help; the in-REPL
// /help is a separate surface, and arrives with the REPL.
const usage = `eva — a model client that leaves a complete record.

USAGE:
  eva -p <prompt>              One-shot: the answer, rendered, and what it cost
  eva -p <prompt> --json       One-shot: the turn as typed Events on stdout
  eva help                     Show this help

FLAGS:
  -p, --prompt <text>          The prompt to answer
      --json                   Emit typed Events, one per line, unrendered
      --config <path>          Configuration file
                               (default $EVA_CONFIG, then ~/.eva/config.toml)

Configuration is a file rather than a pile of flags. An API key is read from
the environment — by default $ANTHROPIC_API_KEY — and never from that file.
`

// Main runs eva and returns the process exit code.
//
// args is the command line without the program name. Writing through the
// passed streams rather than through os.Stdout is what lets a test drive this
// with nothing attached.
func Main(args []string, stdout, stderr io.Writer) int {
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

	code, err := run(context.Background(), opts, stdout)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "eva: %v\n", err)
	}
	return code
}

// errHelp is the request for help, which is a successful command rather than
// a rejected one.
var errHelp = errors.New("help requested")

type options struct {
	prompt string
	json   bool
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
	fs.StringVar(&opts.prompt, "p", "", "the prompt to answer")
	fs.StringVar(&opts.prompt, "prompt", "", "the prompt to answer")
	fs.BoolVar(&opts.json, "json", false, "emit typed Events, unrendered")
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

	if opts.prompt == "" {
		return options{}, errors.New("interactive mode is not built yet; answer one prompt with -p <prompt>")
	}
	return opts, nil
}

// run is written with named results so that closing the Trace can report a
// failure the turn itself did not see. A Trace that failed to flush is not a
// successful run, whatever the turn claimed.
func run(ctx context.Context, opts options, stdout io.Writer) (code int, err error) {
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

	session := core.NewSession(events.SessionID(newID("sess")), cfg.Tenant(), cfg.Actor())

	output, err := projection(opts, stdout)
	if err != nil {
		return ExitFailure, err
	}

	// The Session comes first, so the transcript is folded before the Event
	// is printed. Both are projections of the same committed record; the order
	// only decides which one is built first.
	recorder, err := core.NewRecorder(core.RecorderOptions{
		Sink:        sink,
		Tenant:      cfg.Tenant(),
		Actor:       cfg.Actor(),
		Run:         events.RunID(newID("run")),
		Session:     session.ID,
		Now:         now,
		NewID:       func() events.EventID { return events.EventID(newID("evt")) },
		Subscribers: []core.Subscriber{session, output},
	})
	if err != nil {
		return ExitFailure, err
	}

	turn := &Turn{
		Provider: provider,
		Recorder: recorder,
		Session:  session,
		Model:    cfg.Model,
	}

	outcome, err := turn.Execute(ctx, core.Spec{
		Tenant: cfg.Tenant(),
		Actor:  cfg.Actor(),
		Intent: opts.prompt,
	})
	if err != nil {
		return ExitFailure, err
	}
	if outcome.Result != events.ResultDone {
		return ExitFailure, fmt.Errorf("%s: %s", outcome.Result, outcome.Summary)
	}
	return ExitOK, nil
}

// projection builds what writes to stdout: typed Events, or the turn rendered
// for a person. Both are folds over the same committed record, which is what
// lets them be swapped here and still describe one turn.
//
// The two are exclusive, and the machine-readable one builds no Renderer at
// all. Not built and suppressed — never built. Otherwise the terminal stack
// would sit in the output path a script parses, and the render boundary would
// stop being a property of the program and become a habit.
func projection(opts options, stdout io.Writer) (core.Subscriber, error) {
	if opts.json {
		return eventStream{out: stdout}, nil
	}
	return render.New(stdout, darkBackground(stdout))
}

// darkBackground asks the terminal what colour it is.
//
// Nothing configures this. A style a user had to select is a style most users
// never select, and the answer is one the terminal already knows.
//
// A destination that is not a terminal has nothing to ask, and gets dark —
// which is what an unknown terminal is assumed to be, and what the markdown
// renderer would have defaulted to anyway. Colour never reaches such a
// destination in any case: it is removed on the way out.
func darkBackground(stdout io.Writer) bool {
	file, isFile := stdout.(*os.File)
	if !isFile {
		return true
	}
	return lipgloss.HasDarkBackground(os.Stdin, file)
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

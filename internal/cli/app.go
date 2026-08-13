package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"

	"github.com/missingstudio/eva/internal/api"
	"github.com/missingstudio/eva/internal/auth"
	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/tui"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

// usage is the command surface a shell sees. The console answers /help, which
// is a different surface: these are the flags a process is started with, and
// those are the commands a Session is steered by.
var usage = fmt.Sprintf(`eva — an autonomous, multi-tenant, AI-native software factory.

USAGE:
  eva                    Interactive console
  eva -p <prompt>        Answer one prompt and leave
  eva login              Log in to an OpenAI ChatGPT/Codex subscription
  eva auth status        Show how each turn authenticates
  eva init               Write a starter configuration
  eva version            Show the build, the toolchain, and the platform
  eva help               Show this help

FLAGS:
  --config <path>        Configuration file
  -p <prompt>            One turn, rendered to stdout; non-zero if it failed,
                         with why on stderr

CONFIG (env):
  %-20s   required when the provider is %q
  %-20s   required when the provider is %q with api_key auth,
                         and unused when a login authenticates instead
  %-20s   default: ~/.eva/config.toml
  %-20s   default: the user's home directory

In the console: enter sends, ctrl+c interrupts the turn in flight, ctrl+d
leaves, and /help lists the commands.
`, config.DefaultAPIKeyEnv, config.DefaultProvider,
	config.DefaultOpenAIAPIKeyEnv, auth.ProviderOpenAI,
	config.EnvConfig, config.EnvHome)

func Main(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	// A refused command line is answered with the usage beside it, which is the
	// one diagnostic that is worth more than the sentence alone: a person who
	// got the words wrong is holding the list of the right ones before they can
	// ask for it.
	opts, err := parse(args)
	switch {
	case errors.Is(err, errHelp):
		_, _ = fmt.Fprint(stdout, usage)
		return ExitOK
	case err != nil:
		_, _ = fmt.Fprintf(stderr, "eva: %v\n\n%s", err, usage)
		return ExitUsage
	}

	// Before the run, so that a signal arriving during the first read of a file
	// is caught by Eva rather than by the runtime.
	ctx, asked, release := listen(context.Background())
	defer release()

	// stdout goes to the run and stderr does not, which is the whole of where a
	// diagnostic may be written. Commands write answers; what a failure costs
	// and what a person reads of it is decided here, and a command holding
	// stderr would be a command that could decide it too.
	answering := &run{opts: opts, stdin: stdin, stdout: stdout}

	err = answering.perform(ctx)
	report(stderr, err)

	// A signal outranks whatever the run made of it. The run reports what
	// happened to the turn; this reports what happened to the process, and a
	// process that stopped because it was told to did not succeed at staying
	// open however cleanly it went. Left to the frontend, a terminated console
	// exited zero and a supervisor read that as a job that finished.
	if s := asked(); s != nil {
		return stopCode(s)
	}
	return code(err)
}

// errHelp is the request for help, which is a successful command rather than
// a rejected one.
var errHelp = errors.New("help requested")

type options struct {
	config string
	// command is the word eva was asked with, and is empty for a turn — which
	// is what eva is with no word at all.
	command       string
	loginProvider string
	// prompt is one turn asked from the command line. It is empty for the
	// console, which is what eva is with nothing to answer.
	prompt string
}

func parse(args []string) (options, error) {
	if len(args) > 0 && args[0] == "help" {
		return options{}, errHelp
	}

	var opts options
	// The empty word belongs to the turn and is not something anybody types, so
	// `eva ""` stays what it was: an argument Eva does not know.
	if len(args) > 0 && args[0] != "" {
		if cmd, found := lookup(args[0]); found {
			opts.command, args = cmd.name, args[1:]
			if cmd.parse != nil {
				rest, err := cmd.parse(args, &opts)
				if err != nil {
					return options{}, err
				}
				args = rest
			}
		}
	}
	fs := flag.NewFlagSet("eva", flag.ContinueOnError)

	// Eva prints its own usage, in its own words, on the stream it chooses.
	fs.SetOutput(io.Discard)
	fs.StringVar(&opts.config, "config", "", "configuration file")
	fs.StringVar(&opts.prompt, "p", "", "answer one prompt and leave")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return options{}, errHelp
		}
		return options{}, err
	}

	if rest := fs.Args(); len(rest) > 0 {
		return options{}, fmt.Errorf("unexpected argument %q", rest[0])
	}

	// A word and a prompt are two things to do, and eva does one. Taken
	// together the word won and the prompt was dropped in silence, which is a
	// person watching Eva answer something they did not ask.
	if opts.command != "" && opts.prompt != "" {
		return options{}, fmt.Errorf("eva %s and -p are two things to do, and eva does one", opts.command)
	}
	return opts, nil
}

func appearance(cfg config.Config) (theme.Theme, keymap.Keymap, error) {
	look, err := theme.Build(theme.Dark, theme.Settings{
		Name:           cfg.Theme.Name,
		Subdued:        cfg.Theme.Colors.Subdued,
		Failure:        cfg.Theme.Colors.Failure,
		Plain:          cfg.Theme.Markdown.Plain,
		Heading:        cfg.Theme.Markdown.Heading,
		Code:           cfg.Theme.Markdown.Code,
		CodeBlock:      cfg.Theme.Markdown.CodeBlock,
		Emphasis:       cfg.Theme.Markdown.Emphasis,
		Link:           cfg.Theme.Markdown.Link,
		LinkText:       cfg.Theme.Markdown.LinkText,
		Quote:          cfg.Theme.Markdown.Quote,
		Person:         cfg.Theme.Colors.Person,
		Eva:            cfg.Theme.Colors.Eva,
		Spinner:        cfg.Theme.Colors.Spinner,
		SpinnerName:    cfg.Theme.Symbols.Spinner,
		Prompt:         cfg.Theme.Symbols.Prompt,
		Placeholder:    cfg.Theme.Symbols.Placeholder,
		Truncation:     cfg.Theme.Symbols.Truncation,
		Border:         cfg.Theme.Border,
		Margin:         sides(cfg.Theme.Layout.Margin),
		Padding:        sides(cfg.Theme.Layout.Padding),
		PromptRows:     cfg.Theme.Layout.PromptRows,
		CaptionSeconds: cfg.Theme.Layout.CaptionSeconds,
		ElapsedSeconds: cfg.Theme.Layout.ElapsedSeconds,
		LiveShare:      cfg.Theme.Layout.LiveShare,
	})
	if err != nil {
		return theme.Theme{}, keymap.Keymap{}, fmt.Errorf("%w (in %s)", err, appearanceFile(cfg))
	}

	keys, err := keymap.Parse(cfg.Keys.Bind)
	if err != nil {
		return theme.Theme{}, keymap.Keymap{}, fmt.Errorf("%w (in %s)", err, appearanceFile(cfg))
	}
	return look, keys, nil
}

func sides(written config.SidesConfig) theme.Sides {
	return theme.Sides{
		Top:    written.Top,
		Right:  written.Right,
		Bottom: written.Bottom,
		Left:   written.Left,
	}
}

// appearanceFile is which file a person has to go and edit. Look and feel is
// the one thing a repository may set, so it is the more likely of the two.
func appearanceFile(cfg config.Config) string {
	if cfg.Project != "" {
		return cfg.Project
	}
	return cfg.Path
}

// The fold a person reads a turn in is a projection of what was committed, and
// this is where the compiler is told so.
var _ core.Subscriber = (*render.Renderer)(nil)

// once answers one prompt onto a stream and leaves. It drives the same Session
// API the console does, over the Transport that opens no socket — which is what
// lets one turn on a command line cost nothing to serve.
func once(ctx context.Context, session api.Session, facts tui.Local, prompt string, stdout io.Writer, look theme.Theme) error {
	// The Theme is the one a person configured, built for a dark terminal
	// because this path does not ask. Asking means writing a query to a
	// terminal and reading it back, and this path may have no terminal at all —
	// where it does not, lipgloss removes the escapes on the way out and the
	// assumption costs nothing.
	renderer, err := render.New(render.Stream(stdout), look)
	if err != nil {
		return err
	}

	// Nothing watches this turn arrive: what a script reads is the answer, not
	// the typing of it. Watching still claims the Interrupt capability, because
	// the process surface listens for the signal and lets the Run close.
	if err := session.Watch(ctx, renderer, nil); err != nil {
		return err
	}

	// Before the turn rather than after it. What a remedy says about a model
	// depends on which one answered, and asking once the turn has failed is
	// asking a Session that a failure may have left unreachable.
	model, err := session.Model(ctx)
	if err != nil {
		return err
	}

	outcome, err := session.Answer(ctx, prompt)
	if err != nil {
		return err
	}
	if outcome.Result != events.ResultDone {
		return unanswered{class: outcome.Class, remedy: facts.Remedy(outcome.Class, model)}
	}
	return nil
}

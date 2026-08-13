package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/missingstudio/eva/internal/api"
	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/harness"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/tui"
	"github.com/missingstudio/eva/internal/tui/keymap"

	// The Harnesses a build can select, each registering itself as it loads.
	// Eva is the configured default and today the only name.
	//
	// The Providers are imported where their registry is, and a Harness cannot
	// be: it imports that layer to register itself. The one that cannot go
	// where its registry is ends up here, where the wiring is.
	_ "github.com/missingstudio/eva/internal/harness/eva"
)

type stage uint8

const (
	// bare is a machine nothing is set up on, which is the machine version,
	// init and login exist for.
	bare stage = iota
	configured
	assembled
)

type command struct {
	name string
	// parse consumes the words that belong to this command and hands back the
	// rest for the flags. It is nil for a command that takes no words of its
	// own.
	parse func(args []string, opts *options) ([]string, error)
	needs stage
	do    func(ctx context.Context, r *run) error
}

func commands() []command {
	return []command{
		{
			name:  "",
			needs: assembled,
			do: func(ctx context.Context, r *run) error {
				if r.opts.prompt != "" {
					return once(ctx, r.session, r.local, r.opts.prompt, r.stdout, r.look)
				}
				return tui.Run(ctx, r.session, r.local, r.stdin, r.stdout, tui.WithTheme(r.look), tui.WithKeymap(r.keys))
			},
		},
		{
			// Before any file is read. What build this is has to be answerable
			// on a machine where nothing else works yet, because that is the
			// machine whose owner is about to file the report.
			name:  "version",
			needs: bare,
			do:    func(_ context.Context, r *run) error { return versionReport(r.stdout) },
		},
		{
			// Before the configuration is read, because writing one is what a
			// person does when they have none — and a starter run that first
			// insisted on a valid file would be a command nobody could use for
			// its own purpose.
			name:  "init",
			needs: bare,
			do:    func(_ context.Context, r *run) error { return initialise(r.opts.config, r.stdout) },
		},
		{
			// Like init: logging in is what a person does when nothing else
			// works yet, so it does not first insist on a valid configuration.
			name: "login",
			parse: func(args []string, opts *options) ([]string, error) {
				if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
					opts.loginProvider, args = args[0], args[1:]
				}
				return args, nil
			},
			needs: bare,
			do:    func(ctx context.Context, r *run) error { return login(ctx, r.opts.loginProvider, r.stdout) },
		},
		{
			// After the configuration and before the Provider: a status report
			// must answer for the credential that is missing, so it cannot
			// require one.
			name: "auth",
			parse: func(args []string, _ *options) ([]string, error) {
				// One word under auth today. The refusal spells the whole
				// command so a person who typed half of it is handed the other
				// half.
				if len(args) == 0 || args[0] != "status" {
					return nil, errors.New(`auth is asked with a word: "eva auth status"`)
				}
				return args[1:], nil
			},
			needs: configured,
			do:    func(_ context.Context, r *run) error { return authStatus(r.cfg, r.stdout) },
		},
	}
}

func lookup(word string) (command, bool) {
	for _, c := range commands() {
		if c.name == word {
			return c, true
		}
	}
	return command{}, false
}

type run struct {
	opts   options
	stdin  io.Reader
	stdout io.Writer

	cfg config.Config

	// The rest stand only for a command that needs an assembly: the Session API
	// a Frontend drives, what this machine answers for itself, the Assembly that
	// holds the Trace open, and the look a turn is drawn in.
	session  api.Session
	local    *local
	assembly *harness.Assembly
	look     theme.Theme
	keys     keymap.Keymap
}

func (r *run) perform(ctx context.Context) (err error) {
	cmd, found := lookup(r.opts.command)
	if !found {
		// parse sets a word only by finding it in this same table, so reaching
		// here means the table changed under a parser that did not.
		return fmt.Errorf("no command answers to %q", r.opts.command)
	}

	if cmd.needs == bare {
		return cmd.do(ctx, r)
	}

	cfg, err := config.Load(r.opts.config)
	if err != nil {
		return rejected(err)
	}
	r.cfg = cfg

	if cmd.needs == configured {
		return cmd.do(ctx, r)
	}

	if err := r.assemble(); err != nil {
		return err
	}
	// A Trace that failed to flush is not a successful run, whatever the turn
	// claimed.
	defer func() {
		cerr := r.assembly.Close()
		switch {
		case cerr == nil:
		case err == nil:
			err = cerr
		default:
			err = errors.Join(err, cerr)
		}
	}()
	return cmd.do(ctx, r)
}

// assemble builds the service in this process and takes hold of the Session API
// onto it, over the Transport that opens no socket. What a turn is answered
// with — the Harness, the Provider, the sink, and the Session — is the layer
// below's to wire; what stays here is the credential a person obtained, the
// look the answer is drawn in, and the facts about this machine.
func (r *run) assemble() error {
	var creds harness.Credentials
	if r.cfg.Subscription() {
		resolve, err := subscriptionCredential(r.cfg)
		if err != nil {
			return err
		}
		creds.Subscription = resolve
	}

	assembly, err := harness.Assemble(r.cfg, creds)
	if err != nil {
		return rejected(err)
	}

	look, keys, err := appearance(r.cfg)
	if err != nil {
		// The Trace is open and the configuration it was opened from is one Eva
		// will not act on. Its own failure to close on the way back out is not
		// what this person has to hear about instead.
		_ = assembly.Close()
		return rejected(err)
	}

	r.assembly = assembly
	// The Session API in this process is the assembly itself, which is what
	// lets one turn on a command line cost nothing to serve. A browser reaching
	// the same five methods over the wire is the other Transport, and neither
	// knows which it is.
	r.session = assembly
	r.local = &local{
		editor: r.cfg.Editor,
		checks: checks{
			provider:     r.cfg.Provider.Name,
			model:        r.cfg.Model,
			subscription: r.cfg.Subscription(),
			keyEnv:       r.cfg.Provider.APIKeyEnv,
			baseURL:      r.cfg.Provider.BaseURL,
			configPath:   r.cfg.Path,
			login:        storedLogin,
		},
	}
	r.look, r.keys = look, keys
	return nil
}

package tui

import (
	"context"
	"fmt"
	"strings"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
)

// command is one thing a person types in the console instead of a prompt.
type command struct {
	name     string
	argument string
	about    string
	// run does the thing and says what to show for it.
	run func(r reach, argument string) string
}

type reach interface {
	// usingModel is which model answers the turns that follow, and useModel
	// switches it from the next turn on.
	usingModel() string
	useModel(name string)

	// spent is what this Session has cost so far, already drawn. It is a fold over
	// the Usage records the Trace holds, which is why a Command asks for it rather
	// than counting.
	spent() string

	// empty empties the transcript, and the Session behind it. Nothing is
	// destroyed: see clear, and ADR 0019.
	empty()

	// aside is a line in the interface's own voice — subdued, because a command's
	// answer is not part of the conversation.
	aside(text string) string
}

var _ reach = (*Console)(nil)

// The console's own half of that list. Each is one line, and each is the reason
// the list is short: a Command that wanted anything else would have to say so
// here, where a reader would see it.
func (c *Console) usingModel() string       { return c.control.Model() }
func (c *Console) useModel(name string)     { c.control.UseModel(name) }
func (c *Console) spent() string            { return c.renderer.Cost() }
func (c *Console) aside(text string) string { return c.styles.hint.Render(text) }

type Control interface {
	// Answer runs one turn as one Run, and returns when the Run is closed.
	Answer(ctx context.Context, intent string) (core.Outcome, error)
	// Watch attaches the frontend that drives these turns: what was committed,
	// what is arriving, and the Interrupt capability that listening claims.
	Watch(sub core.Subscriber, arriving func(chunk string))

	// About is what this console can say about the run behind it before anyone
	// has asked anything: the build, the branch, the directory.
	About() About

	// Remedy is what was checked about this machine after a turn failed this
	// way, and the one command that follows from it.
	Remedy(class events.ErrorClass) render.Remedy

	// Editor is the program a person writes a long prompt in, and is the zero
	// Editor when this machine names none.
	Editor() Editor

	// Model is which model the turns that follow will use.
	Model() string
	// UseModel switches it, from the next turn on.
	UseModel(model string)
	// Clear empties the transcript.
	Clear()
}

func commands() []command {
	return []command{
		{
			name:  "help",
			about: "list these commands",
			run:   help,
		},
		{
			name:  "cost",
			about: "what this Session has cost so far",
			run:   cost,
		},
		{
			name:  "clear",
			about: "empty the transcript",
			run:   clear,
		},
		{
			name:     "model",
			argument: "[name]",
			about:    "report which model answers, or switch to another",
			run:      model,
		},
		{
			name:  "login",
			about: "where to log in to a subscription, which is not here",
			run:   login,
		},
	}
}

func help(r reach, _ string) string {
	var listed strings.Builder
	for _, cmd := range commands() {
		typed := "/" + cmd.name
		if cmd.argument != "" {
			typed += " " + cmd.argument
		}
		fmt.Fprintf(&listed, "%-16s %s\n", typed, cmd.about)
	}
	return r.aside(strings.TrimRight(listed.String(), "\n"))
}

func model(r reach, name string) string {
	if name == "" {
		return r.aside("model " + r.usingModel())
	}
	was := r.usingModel()
	r.useModel(name)
	return r.aside("model " + was + " → " + name)
}

// login says where a login happens, and it is not here.
func login(r reach, _ string) string {
	return r.aside(`run "eva login" in a shell — a login opens a browser, and a command opens nothing`)
}

func cost(r reach, _ string) string { return r.spent() }

// clear empties the transcript, and the spend with it, because both belong to
// the Session that is being left behind. Session.Fresh has the argument.
func clear(r reach, _ string) string {
	r.empty()
	return ""
}

// obey answers what was typed at the console rather than sending it to the
// model.
func (c *Console) obey(typed string) string {
	name, argument, _ := strings.Cut(strings.TrimPrefix(typed, "/"), " ")
	argument = strings.TrimSpace(argument)

	for _, cmd := range commands() {
		if cmd.name == name {
			return cmd.run(c, argument)
		}
	}
	return c.styles.hint.Render("/" + name + " is not a command — /help lists them")
}

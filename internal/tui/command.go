package tui

import (
	"fmt"
	"strings"

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
	// switches it from the next turn on. Switching reaches the Session and can
	// fail; reading does not, because a frame a person is looking at is drawn
	// from what this console already knows.
	usingModel() string
	useModel(name string) error

	// spent is what this Session has cost so far, already drawn. It is a fold over
	// the Usage records the Trace holds, which is why a Command asks for it rather
	// than counting.
	spent() string

	// empty empties the transcript, and the Session behind it. Nothing is
	// destroyed: see clear, and ADR 0019.
	empty() error

	// aside is a line in the interface's own voice — subdued, because a command's
	// answer is not part of the conversation.
	aside(text string) string
}

var _ reach = (*Console)(nil)

// The console's own half of that list. Each is one line, and each is the reason
// the list is short: a Command that wanted anything else would have to say so
// here, where a reader would see it.
func (c *Console) usingModel() string       { return c.model }
func (c *Console) spent() string            { return c.renderer.Cost() }
func (c *Console) aside(text string) string { return c.styles.hint.Render(text) }

// useModel switches the model and keeps what this console draws in step with
// what answered. The console's own copy moves only after the Session took the
// change, so a frame never reports a model that is not answering.
func (c *Console) useModel(name string) error {
	if err := c.session.UseModel(c.ctx, name); err != nil {
		return err
	}
	c.model = name
	return nil
}

// Local is what a Frontend answers about its own machine. No Transport carries
// one: a program starts where a person is sitting, a build and a directory
// describe one computer, and what was checked after a turn failed was checked
// where the request was made.
type Local interface {
	// About is what this console can say about the machine it runs on before
	// anyone has asked anything: the build, the branch, the directory.
	About() About

	// Remedy is what was checked about this machine after a turn failed this
	// way on this model, and the one command that follows from it. The model is
	// handed in because where its name came from is a fact about this machine's
	// own configuration, and the name itself is not.
	Remedy(class events.ErrorClass, model string) render.Remedy

	// Editor is the program a person writes a long prompt in, and is the zero
	// Editor when this machine names none.
	Editor() Editor
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
	if err := r.useModel(name); err != nil {
		// The switch did not happen, so the line says so rather than reporting
		// a change nothing made. A person acting on the wrong one would send
		// the next turn to a model that is not answering it.
		return r.aside("model is still " + was + " — " + err.Error())
	}
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
	if err := r.empty(); err != nil {
		return r.aside("the transcript is unchanged — " + err.Error())
	}
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

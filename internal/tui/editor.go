package tui

import (
	"os"
	"os/exec"

	tea "charm.land/bubbletea/v2"
)

// Editor is the program a person writes a long prompt in.
//
// It is told rather than discovered, for the reason everything else this console
// knows about the outside world is: which editor a person uses is an environment
// variable and a configuration key, and this layer can read neither. The layer
// that wires a run reads both and hands the answer over.
//
// A zero Editor is a machine that named none, and nothing is run for it.
type Editor struct {
	// Command is the program to run.
	Command string
	// Args are what goes before the file's name.
	Args []string
}

// edited says the editor has closed. The path is the file it was given, and it is
// this message's to clean up whatever happened.
type edited struct {
	path string
	err  error
}

// promptFile is what the file the editor opens is called.
//
// The suffix is markdown because a prompt is markdown — a person writing a long
// one writes lists and fenced blocks, and an editor that knows the language gives
// them the wrapping and the highlighting they already expect from it.
const promptFile = "eva-prompt-*.md"

// edit hands the prompt to an editor and takes back what was saved.
//
// Running it is the console's to do and nothing else can do it: the editor draws
// on the same terminal this program owns, so somebody has to release it and take
// it back, and only the thing holding it can. What the console must not decide is
// which editor — that is a person's configuration, and it arrives through Control.
//
// The file starts as what is in the prompt, so a person who changes nothing and
// saves nothing gets their own words back. It is removed as soon as it has been
// read: a prompt can hold whatever somebody pasted into it, and a file in the
// temporary directory outliving the keystroke that made it is a copy nobody asked
// for.
func (c *Console) edit(editor Editor, text string) tea.Cmd {
	file, err := os.CreateTemp("", promptFile)
	if err != nil {
		c.blame(err)
		return nil
	}

	// The failures below all leave a file behind if they are not cleaned up, and
	// none of the cleanups has anything to report: a file that cannot be removed
	// after a write that already failed is not the thing to tell a person about.
	path := file.Name()
	if _, err := file.WriteString(text); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		c.blame(err)
		return nil
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		c.blame(err)
		return nil
	}

	// The command is the one this machine's own configuration named, which is why
	// it is not built from anything a model or a repository said. See Editor, and
	// the allow list that keeps a repository out of this.
	run := exec.Command(editor.Command, append(append([]string{}, editor.Args...), path)...) //nolint:gosec // the editor is the person's own, from their environment or their configuration.

	// ExecProcess is the library's own release-and-restore: it gives the terminal
	// to the child, waits, and takes it back. Doing that by hand would mean this
	// console holding a raw-mode terminal while another program drew on it.
	return tea.ExecProcess(run, func(err error) tea.Msg {
		return edited{path: path, err: err}
	})
}

// wrote takes what the editor saved, and puts it in the prompt.
//
// An editor that failed says so and changes nothing. A person who quit without
// saving is not a failure: the file still holds what the prompt held, so what
// comes back is what they started with.
func (c *Console) wrote(e edited) tea.Cmd {
	// Removed whatever happened, and the removal has nothing to say: the file has
	// already given up what it held, and a temporary file that will not go away is
	// not what a person typing a prompt needs to hear about.
	defer func() { _ = os.Remove(e.path) }()

	if e.err != nil {
		c.blame(e.err)
		return nil
	}

	written, err := os.ReadFile(e.path)
	if err != nil {
		c.blame(err)
		return nil
	}

	c.input.SetValue(string(written))
	c.input.MoveToEnd()
	c.fit()
	return nil
}

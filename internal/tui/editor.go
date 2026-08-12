package tui

import (
	"os"
	"os/exec"

	tea "charm.land/bubbletea/v2"
)

type Editor struct {
	Command string
	Args    []string
}

type edited struct {
	path string
	err  error
}

const promptFile = "eva-prompt-*.md"

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

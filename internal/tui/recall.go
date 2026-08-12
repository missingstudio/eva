package tui

import "strings"

// The prompts this console has sent, and where in them a person is looking.
type recall struct {
	// sent is every prompt this console has answered, oldest first. A prompt
	// identical to the one before it is not kept twice: a person pressing enter
	// on the same words twice has one thing to recall, not two.
	sent []string

	// at is where in them a person is looking, and equals len(sent) when they are
	// not looking at any of them — which is to say, when they are writing.
	at int

	// writing is what was in the prompt when recall began, so that walking past
	// the newest entry gives it back. A person who reached for an old prompt and
	// changed their mind is owed the words they had already written.
	writing string
}

func (r *recall) remember(prompt string) {
	prompt = strings.TrimRight(prompt, "\n")
	if prompt == "" {
		return
	}
	if len(r.sent) == 0 || r.sent[len(r.sent)-1] != prompt {
		r.sent = append(r.sent, prompt)
	}
	r.done()
}

// done ends recall, so that the next key is typing rather than walking.
func (r *recall) done() {
	r.at = len(r.sent)
	r.writing = ""
}

func (r *recall) back(typed string) (string, bool) {
	if len(r.sent) == 0 || r.at == 0 {
		return "", false
	}
	if r.at == len(r.sent) {
		r.writing = typed
	}
	r.at--
	return r.sent[r.at], true
}

func (r *recall) forward() (string, bool) {
	if r.at >= len(r.sent) {
		return "", false
	}
	r.at++
	if r.at == len(r.sent) {
		writing := r.writing
		r.writing = ""
		return writing, true
	}
	return r.sent[r.at], true
}

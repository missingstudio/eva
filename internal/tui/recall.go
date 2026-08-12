package tui

import "strings"

// The prompts this console has sent, and where in them a person is looking.
//
// A prompt is retyped more often than anything else in this interface: the one
// that failed, the one that needed a word changed, the one that was nearly right.
// Before this, every one of them was typed again from nothing.
//
// It is the Session's own prompts and it does not outlive the process. The Trace
// holds every prompt ever sent — `Started.Intent` is the first message of the
// transcript — so recall across a restart is a fold over the record rather than a
// second file beside it. That fold is not written yet, and a history file would
// be the wrong way to get there: a second copy of what a person typed, in a place
// nobody asked for it, holding whatever they pasted.
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

// remember keeps a prompt that was sent, and ends any recall in progress.
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

// back is the previous prompt, and reports false when there is none.
//
// What is being written is taken on the first step back, so that the last step
// forward can return it.
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

// forward is the next prompt, and then what was being written.
//
// The step past the newest entry is the one that matters: it gives back the words
// a person had typed before they went looking, rather than leaving them with
// somebody else's sentence and no way back to their own.
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

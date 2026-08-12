package tui

import (
	"context"
	"strings"
	"sync"
)

// shown is what the console has published about the frame in front of a person,
// for whoever is driving the program rather than typing at it.
type shown struct {
	mu sync.Mutex

	// rows is the frame refresh last composed. Rows rather than one piece of text,
	// because that is what a frame is made of; joining per frame for a reader that
	// is usually not there would copy the conversation on every chunk that arrives.
	rows []string

	// cancel ends the Run in flight, and is nil when there is none. It answers
	// "is a turn running" from both sides at once: the update loop asks before it
	// opens another, and whoever is driving the program asks on the way out. Two
	// fields for one fact were two things to keep in step, and nothing made them.
	cancel context.CancelFunc

	// queued is the prompt typed while a turn was still running, and is sent when
	// that turn closes. Only one is held: a person who types a second has changed
	// their mind about the first, and a console that ran both would be answering a
	// question nobody has read the answer to yet.
	queued string
}

// show publishes the frame. The slice is kept rather than copied, and the caller
// builds a fresh one per frame — see refresh, and ADR 0043.
func (s *shown) show(rows []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rows = rows
}

func (s *shown) frame() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Join(s.rows, "\n")
}

// hold takes the Run in flight, and busy reports whether there is one.
func (s *shown) hold(cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancel = cancel
}

func (s *shown) busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cancel != nil
}

// holding is how to end the Run in flight without forgetting it, and release is
// how to end it and let go.
func (s *shown) holding() context.CancelFunc {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cancel
}

func (s *shown) release() context.CancelFunc {
	s.mu.Lock()
	defer s.mu.Unlock()

	cancel := s.cancel
	s.cancel = nil
	return cancel
}

// queue takes the prompt that will be sent when the turn in flight closes, and
// hands back the one that was waiting.
func (s *shown) queue(next string) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	was := s.queued
	s.queued = next
	return was
}

// waiting is the prompt behind the turn in flight, and is empty when there is
// none.
func (s *shown) waiting() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.queued
}

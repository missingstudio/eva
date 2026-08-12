package tui

import (
	"context"
	"strings"
	"sync"
)

// shown is what the console has published about the frame in front of a person,
// for whoever is driving the program rather than typing at it.
//
// Three facts, and one lock over them. They have nothing in common but that: the
// rows on screen, whether a Run is in flight, and the prompt waiting behind it.
// What makes them one module is the goroutine — every one of them is written in
// the update loop and read from outside it, and a console drawn in place cannot be
// read off its own bytes, so a driver has to ask.
//
// # Why this is a module and not three fields
//
// The locking was the console's, spread over seven methods. Two of them were the
// same method twice, two more differed by one assignment, and the one that
// mattered was invisible: refresh publishes the frame, and nothing in its
// signature says it takes a lock to do it. An eighth accessor written without one
// is the failure this shape prevents rather than documents.
//
// So every lock and unlock in this package is in this file, and there is no way to
// reach the fields without one.
//
// The reader is real, and it is not hypothetical: the dialogue in
// internal/cli/console_test.go runs the program on its own goroutine and polls all
// three of these while a turn is in flight. That is what the race detector is
// pointed at, and shown_test.go asserts the same thing here without a program.
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

// frame is everything the console has put in front of a person: the turns it kept,
// and the one arriving if there is one.
//
// It is joined here rather than held joined, because the reader wants a transcript
// and the writer has rows.
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
//
// The difference between them is the whole of what "busy" means. A cancelled Run
// is not over: its goroutine is still unwinding and its close has not been folded
// in yet. Letting go here would make the console idle for that window, so the next
// prompt would open a second Run instead of queueing — and then the first Run's
// close would arrive and cancel the second one, reset its stream, and drop its
// queued prompt.
//
// So an interrupt holds on, and the Run's own close releases.
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
//
// One method for both because they are the same field under the same lock, and a
// caller that only ever swaps cannot leave the two out of step.
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

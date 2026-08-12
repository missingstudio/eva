// Package tui is the interactive frontend: the console, its commands, and the
// terminal they run on.
//
// Layer contract: tui is a consumer. It reaches core for the Subscriber it
// satisfies and the Outcome it reads, and render for the fold a person reads a turn
// in. config, providers and trace are absent, and that absence is why this is a
// layer of its own rather than a file inside the one that assembles a run —
// everything the interface could do with a Provider, a Recorder, or the Trace
// is something it must not do, and here that is an allow list rather than a
// discipline.
//
// glamour is absent too. Rendering an answer is what a fold does, and the fold
// is render.
//
// What a console may reach of the assembly behind it is Control, and it is the
// whole of it. Nothing imports tui but the frontend that assembles a run.
//
// # What is in here
//
// The Console holds the frame and the keys. Everything with a rule of its own is a
// module beside it, each with an interface a reader can finish and tests that go
// through that interface rather than through a window:
//
//   - pane — the window onto the transcript: rows, and where in them a person is.
//   - live — the Live area: the answer as it arrives, and how often it may be
//     folded, decided by what the last fold cost.
//   - shown — what the console publishes for whoever is driving the program rather
//     than typing at it. Every lock this package takes is in there.
//   - palette — the command list, tab completion, and the table both of them read.
//   - recall — the prompts this Session has sent, and where in them a person is.
//   - edges — what a window holds back at its sides, and what a narrow one gives up.
//   - reach — the whole of what a Command may touch of the console it was typed at.
//
// A Command is a function over reach rather than over the Console, which is the
// same move Control makes one layer out: what a Command can do is a list, not a
// discipline.
package tui

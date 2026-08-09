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
package tui

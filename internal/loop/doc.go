// Package loop is the Unit that answers a prompt: it assembles one call out of
// what it was handed, replays what the Provider yields into the Trace, and
// closes the Run with the claim of how it went.
//
// It runs one provider turn today and nothing between turns. What it becomes is
// the cycle that proposes, acts, and observes — tool dispatch, parallel groups,
// approval gates, and the fuse that stops a runaway — and the name is here
// first so that arriving at those does not also move the type.
//
// Layer contract: loop may import events, core, and providers. What it may not
// reach is the point. No config, so the layer that reads a person's file is
// still the only one that reads it; no trace, so the sink a Run commits to is
// chosen above and handed in as a Recorder; no tui and no render, so a Loop
// cannot show a person anything it did not first commit.
//
// It sits below the frontend rather than inside it, because a loop that grew
// tool dispatch inside the layer holding the terminal would be a loop no second
// frontend could drive and no test could run without one.
package loop

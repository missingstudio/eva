// Package openai answers turns from OpenAI's Responses API.
//
// One Provider, two transports. An API key speaks to the public API; a
// subscription login speaks to the ChatGPT/Codex backend, which serves the
// same request shape at a different host behind different headers. The mode is
// chosen where a run is wired, and everything past the dial is one code path.
//
// The client is hand-rolled over the standard library rather than a vendor
// SDK. The surface this package needs — one POST, one SSE body — is small, the
// subscription backend needs a host and headers no SDK ships with, and the
// dependency a whole SDK brings is not paid for by either.
package openai

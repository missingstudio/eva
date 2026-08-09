// Package providers holds the Provider interface and its implementations,
// including Anthropic and the fake Provider that makes tests deterministic.
//
// Layer contract: providers talk to the network, so they sit outside core. They
// may import events and core.
package providers

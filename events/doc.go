// Package events holds the Event schema: the one typed, versioned, sequence-numbered
// record that every observable thing in Eva is an instance of.
//
// Layer contract: this package imports nothing outside the standard library, and
// nothing from within Eva. Every other layer may depend on it, so a dependency
// here would become a dependency everywhere.
package events

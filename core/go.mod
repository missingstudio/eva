module github.com/missingstudio/eva/core

go 1.26

require github.com/missingstudio/eva/events v0.0.0

// The workspace is the root of this repository and go.work is what ties the
// modules together. These replacements exist so that each module also resolves
// on its own — `go mod tidy` runs per module, and it cannot reach a sibling
// that has never been published.
replace github.com/missingstudio/eva/events => ../events

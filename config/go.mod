module github.com/missingstudio/eva/config

go 1.26

require (
	github.com/BurntSushi/toml v1.6.0
	github.com/missingstudio/eva/events v0.0.0
)

// See core/go.mod for why the sibling is replaced rather than required by
// version.
replace github.com/missingstudio/eva/events => ../events

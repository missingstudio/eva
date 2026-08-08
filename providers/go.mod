module github.com/missingstudio/eva/providers

go 1.26

require (
	github.com/BurntSushi/toml v1.6.0
	github.com/missingstudio/eva/core v0.0.0
	github.com/missingstudio/eva/events v0.0.0
)

// See core/go.mod for why the siblings are replaced rather than required by
// version.
replace (
	github.com/missingstudio/eva/core => ../core
	github.com/missingstudio/eva/events => ../events
)

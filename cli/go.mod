module github.com/missingstudio/eva/cli

go 1.26

require (
	github.com/missingstudio/eva/config v0.0.0
	github.com/missingstudio/eva/core v0.0.0
	github.com/missingstudio/eva/events v0.0.0
	github.com/missingstudio/eva/providers v0.0.0
	github.com/missingstudio/eva/trace v0.0.0
)

require github.com/BurntSushi/toml v1.6.0 // indirect

// See core/go.mod for why the siblings are replaced rather than required by
// version.
replace (
	github.com/missingstudio/eva/config => ../config
	github.com/missingstudio/eva/core => ../core
	github.com/missingstudio/eva/events => ../events
	github.com/missingstudio/eva/providers => ../providers
	github.com/missingstudio/eva/trace => ../trace
)

package main

import (
	"os"

	"github.com/missingstudio/eva/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:], os.Stdout, os.Stderr))
}

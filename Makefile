GO ?= go

# Pinned so local and CI run the same linter. `go run` caches after the first
# use, so this costs nothing on later runs and needs no system install.
GOLANGCI_VERSION ?= v2.12.2
GOLANGCI = $(GO) run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)

.PHONY: help check fmt build vet lint test tidy eva

## help: list the targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## check: everything CI runs
check: fmt build vet lint test

## fmt: fail when any file is not gofmt-clean
fmt:
	@out=$$(gofmt -l .); \
	if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi
	@echo "fmt      ok"

## build: compile every package
build:
	@$(GO) build ./...
	@echo "build    ok"

## vet: Go's built-in analysis
vet:
	@$(GO) vet ./...
	@echo "vet      ok"

## lint: golangci-lint, which is where the layer boundaries are enforced
lint:
	@$(GOLANGCI) run ./...
	@echo "lint     ok"

## test: every package
test:
	@$(GO) test ./...
	@echo "test     ok"

## tidy: reconcile the module's dependencies
tidy:
	@$(GO) mod tidy

## eva: build the command into the repository root
eva:
	@$(GO) build -o eva ./cmd/eva
	@echo "eva      ok"

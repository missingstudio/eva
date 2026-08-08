GO ?= go

# Pinned so local and CI run the same linter. `go run` caches after the first
# use, so this costs nothing on later runs and needs no system install.
GOLANGCI_VERSION ?= v2.12.2
GOLANGCI = $(GO) run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)

# Every module in the workspace, by directory.
#
# This indirection is the point. `go build ./...` from the repository root
# matches only the module it is run in, so a bare ./... reports success while
# another module is broken. Iterating the workspace is what makes the check
# honest. `:=` so `go list` runs once rather than once per target.
MODULES := $(shell $(GO) list -m -f '{{.Dir}}')

.PHONY: help check fmt build vet lint test tidy

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

## build: compile every package in every module
build:
	@for d in $(MODULES); do \
		(cd $$d && $(GO) build ./...) || exit 1; \
	done
	@echo "build    ok"

## vet: Go's built-in analysis, every module
vet:
	@for d in $(MODULES); do \
		(cd $$d && $(GO) vet ./...) || exit 1; \
	done
	@echo "vet      ok"

## lint: golangci-lint, which is where the layer boundaries are enforced
lint:
	@for d in $(MODULES); do \
		(cd $$d && $(GOLANGCI) run --config $(CURDIR)/.golangci.yml ./...) || exit 1; \
	done
	@echo "lint     ok"

## test: every module
test:
	@for d in $(MODULES); do \
		(cd $$d && $(GO) test ./...) || exit 1; \
	done
	@echo "test     ok"

## tidy: reconcile every module's dependencies
tidy:
	@for d in $(MODULES); do \
		(cd $$d && $(GO) mod tidy) || exit 1; \
	done

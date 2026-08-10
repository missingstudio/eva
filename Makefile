GO ?= go

# Pinned so local and CI run the same tools. `go run` caches after the first
# use, so this costs nothing on later runs and needs no system install.
GOLANGCI_VERSION    ?= v2.12.2
GOVULNCHECK_VERSION ?= v1.6.0
GORELEASER_VERSION  ?= v2.17.1

GOLANGCI    = $(GO) run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)
GOVULNCHECK = $(GO) run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION)
GORELEASER  = $(GO) run github.com/goreleaser/goreleaser/v2@$(GORELEASER_VERSION)

# What CI runs, declared once. CI reads both lists back through `make
# check-list` and fails when its own jobs do not cover them. So a target added
# here cannot become a target nobody runs, and CI cannot quietly check less
# than this file says it does.
#
# The split is what a check needs, not what it looks at. CHECKS need nothing but
# this repository. AUDITS reach the network, which is why they are named apart
# rather than folded in: their answer can change while the tree does not.
CHECKS = fmt build vet lint test gosec
AUDITS = tidy-check mod-verify vuln

.PHONY: help check audit verify check-list fmt build vet lint gosec test \
        tidy tidy-check mod-verify vuln eva snapshot

## help: list the targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## check: everything CI runs that needs no network
check: $(CHECKS)

## audit: the checks that reach the network
audit: $(AUDITS)

## verify: check and audit, which together are exactly what CI runs
verify: check audit

## check-list: the targets CI must cover, one per line
check-list:
	@printf '%s\n' $(CHECKS) $(AUDITS)

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

## gosec: security patterns in Eva's own code
#
# A second invocation of the linter rather than a second tool, so it reads the
# same .golangci.yml — the exclusions there are what make this a gate and not a
# wall of known-good findings. `--default=none` is what keeps it from repeating
# the work `make lint` already did.
gosec:
	@$(GOLANGCI) run --default=none --enable=gosec ./...
	@echo "gosec    ok"

## test: every package, under the race detector, in a shuffled order
#
# The race detector is not optional here. The sink assigns Trace position under
# a mutex, and core holds sync because a turn's tool groups run in parallel
# against one Recorder. Those invariants are asserted by tests that cannot fail
# without it. It needs a C toolchain, which every platform CI runs on has.
test:
	@$(GO) test -race -shuffle=on ./...
	@echo "test     ok"

## tidy: reconcile the module's dependencies
tidy:
	@$(GO) mod tidy

## tidy-check: fail when go.mod or go.sum is not what the imports imply
#
# `-diff` reports what tidy would change and writes nothing, so this reads the
# same in CI as it does on a tree somebody is working in.
tidy-check:
	@$(GO) mod tidy -diff
	@echo "tidy     ok"

## mod-verify: fail when a module's content no longer matches go.sum
mod-verify:
	@$(GO) mod verify >/dev/null
	@echo "modverify ok"

## vuln: known vulnerabilities in code this module actually calls
#
# govulncheck reports by reachable symbol rather than by module version, so a
# vulnerability in code Eva never calls does not fail this. The database is
# fetched at run time: the tool is pinned, the answer is not.
vuln:
	@$(GOVULNCHECK) ./...
	@echo "vuln     ok"

## eva: build the command into the repository root
eva:
	@$(GO) build -o eva ./cmd/eva
	@echo "eva      ok"

## snapshot: build every release target locally, publishing nothing
#
# This is the release path, run without a tag. Signing and the SBOM are skipped
# because both need a binary that only CI installs; everything that decides
# what an artifact contains is exercised.
snapshot:
	@$(GORELEASER) release --snapshot --clean --skip=publish,sign,sbom,announce
	@echo "snapshot ok"

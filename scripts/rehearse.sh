#!/bin/sh
#
# The release, rehearsed. Everything a tag sets off that does not need a tag.
#
# Nine defects reached a runner on the first two releases, and every one of them
# was in the release path rather than in Eva. They were reachable only by
# pushing a tag, because the release path had no interface anything else could
# call. This is that interface.
#
#   1. the guard's cases                  (a tag shape cannot regress)
#   2. the installer's channel cases      (a channel cannot regress)
#   3. the guard, against the built binary
#   4. a snapshot build of every target
#   5. an install from that build         (the archive names agree, or this fails)
#
# What it cannot run is signing. Keyless signing needs an OIDC token a laptop
# does not have, so cosign stays a tag-time contract — which is the argument for
# spending a release candidate before spending a release.
set -eu

cd "$(dirname "$0")/.."

MAKE="${MAKE:-make}"

echo "== 1. the guard's cases"
sh scripts/release-guard_test.sh

echo
echo "== 2. the installer's channel cases"
sh scripts/install_test.sh

echo
echo "== 3. the guard, against this tree's binary"
# The version the source declares, and the version the built program reports.
# Comparing them is not a tautology: it fails on a stale binary, and on a
# version() that stopped reading the constant.
declared=$(sed -n 's/^const Version = "\([^"]*\)".*/\1/p' internal/cli/about.go)
[ -n "$declared" ] || {
	echo "rehearse: cannot read Version from internal/cli/about.go" >&2
	exit 1
}
"$MAKE" eva >/dev/null
reported=$(./eva version | awk '/^eva:/ { print $2 }')
sh scripts/release-guard.sh version "v$declared" "$reported"
sh scripts/release-guard.sh range "v$declared"

echo
echo "== 4. a snapshot build of every target"
"$MAKE" snapshot >/dev/null
echo "snapshot ok"

echo
echo "== 5. an install from that build"
# This is also what checks the archive names: the installer derives the name it
# wants from .goreleaser.yaml's template, and finds the file or does not.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
sh scripts/install.sh --from-dist dist --dir "$work/bin"
"$work/bin/eva" version | sed 's/^/  /'

echo
echo "rehearse ok — everything a release does that a tag is not needed for"

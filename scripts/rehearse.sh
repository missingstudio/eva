#!/bin/sh
#
# The release, rehearsed. Everything a tag sets off that does not need a tag.
#
# Nine defects reached a runner on the first two releases, every one of them in
# the release path and reachable only by pushing a tag. This is the interface
# that path did not have.
#
#   1. the guard's cases                  (a tag shape cannot regress)
#   2. the installer's channel cases      (a channel cannot regress)
#   3. the guard, against the built binary
#   4. a snapshot build of every target
#   5. an install from that build         (the archive names agree, or this fails)
#   6. the cask the tap would receive     (a second repository cannot be checked
#                                          by the run that writes to it)
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
echo "== 6. the cask the tap would receive"
# The tap is a second repository, and it is written to after the release is
# already published. A cask naming an archive nobody built is therefore found by
# a user rather than by the run that wrote it. This is where it is found instead.
#
# The snapshot wrote this with no tag and no token, which is the only reason
# any of it can be read here.
cask=dist/homebrew/Casks/eva.rb
[ -f "$cask" ] || {
	echo "rehearse: no cask at $cask — did the snapshot stop running the homebrew pipe?" >&2
	exit 1
}

# The stanza that makes it an install and not a download.
grep -q 'binary "eva"' "$cask" || {
	echo "rehearse: the cask installs no eva binary" >&2
	exit 1
}

# The hook this whole surface exists for. Without it, a cask is no better on
# macOS than the archive the install script already fetches.
grep -q 'com.apple.quarantine' "$cask" || {
	echo "rehearse: the cask does not clear the quarantine attribute" >&2
	exit 1
}

# And every archive it points at is one this build wrote. The cask interpolates
# #{version}, so the names are rebuilt from the version the cask declares.
cask_version=$(sed -n 's/^  version "\([^"]*\)".*/\1/p' "$cask")
[ -n "$cask_version" ] || {
	echo "rehearse: the cask declares no version" >&2
	exit 1
}
names=$(
	sed -n 's|.*/releases/download/[^/]*/\([^"]*\)".*|\1|p' "$cask" |
		sed "s/#{version}/$cask_version/g" | sort -u
)
# An empty list would make the loop below vacuously true, so reading nothing is
# the one thing this must not do quietly.
[ -n "$names" ] || {
	echo "rehearse: the cask names no archive" >&2
	exit 1
}
for name in $names; do
	[ -f "dist/$name" ] || {
		echo "rehearse: the cask names dist/$name, which this build did not write" >&2
		exit 1
	}
done
echo "cask ok — $(printf '%s\n' "$names" | wc -l | tr -d ' ') archives, all built"

echo
echo "rehearse ok — everything a release does that a tag is not needed for"

#!/bin/sh
#
# The install script's cases, against recorded releases.
#
# `fetch` is the only thing in install.sh that reaches the network, so replacing
# it here is what makes channel resolution testable at a desk. That is the part
# that shipped broken: --channel next read the releases list by splitting it on
# '{', which the nested author and assets objects split too.
#
# Everything else install.sh does — checksums, unpacking, installing — is run
# for real by `make rehearse` against a snapshot build, so it is not repeated
# here.
set -eu

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
EVA_INSTALL_LIB=1 . ./scripts/install.sh

FIXTURES="./scripts/testdata"
failures=0

equals() { # <name> <got> <want>
	if [ "$2" = "$3" ]; then
		printf '  ok    %s\n' "$1"
	else
		printf '  FAIL  %s: got %s, want %s\n' "$1" "$2" "$3" >&2
		failures=$((failures + 1))
	fi
}

# The seam, serving what GitHub actually returns. A URL nothing recorded is an
# error rather than an empty body, so a test cannot pass by reading nothing.
fetch() {
	case "$1" in
	*/releases/latest) cat "$FIXTURES/releases-latest.json" ;;
	*/releases\?per_page=*) cat "$FIXTURES/releases-list.json" ;;
	*/releases/tags/*) cat "$FIXTURES/release-${1##*/}.json" ;;
	*)
		echo "no fixture for $1" >&2
		return 1
		;;
	esac
}

equals "stable is the latest endpoint's tag" "$(resolve_tag stable)" "v0.2.0"

# The list holds a stable release ahead of the prerelease, so this only passes
# if the walk reads each release's own flag rather than the list's shape.
equals "next walks past a stable release to the prerelease" \
	"$(resolve_tag next)" "v0.3.0-rc.1"

# What .goreleaser.yaml names an archive, stated once here and used by the
# rehearsal to install what the build wrote.
equals "windows is a zip and the rest are tarballs" \
	"$(archive_name 0.2.0 linux amd64) $(archive_name 0.2.0 windows amd64)" \
	"eva_0.2.0_linux_amd64.tar.gz eva_0.2.0_windows_amd64.zip"

if [ "$failures" -ne 0 ]; then
	echo "$failures install case(s) failed" >&2
	exit 1
fi
echo "install  ok"

#!/bin/sh
#
# The install script's cases, against recorded releases.
#
# `fetch` is replaced here, which makes channel resolution testable at a desk.
# That is the part that shipped broken.
#
# The signature is the second seam, and `make rehearse` cannot cover it: keyless
# signing needs an OIDC token a laptop does not have, so a snapshot build is
# unsigned. A bad signature and a missing cosign would otherwise be reachable
# only by publishing a release.
#
# Everything else install.sh does is run for real by `make rehearse`, so it is
# not repeated here.
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

# refuses and allows run the case in a subshell, because die exits — and a test
# that let it exit would report the suite as passing by ending it.
refuses() { # <name> <command...>
	name="$1"
	shift
	if ("$@") >/dev/null 2>&1; then
		printf '  FAIL  %s: it installed anyway\n' "$name" >&2
		failures=$((failures + 1))
	else
		printf '  ok    %s\n' "$name"
	fi
}

allows() { # <name> <command...>
	name="$1"
	shift
	if ("$@") >/dev/null 2>&1; then
		printf '  ok    %s\n' "$name"
	else
		printf '  FAIL  %s: it refused\n' "$name" >&2
		failures=$((failures + 1))
	fi
}

# contains asserts on what a case said, because half of what this script owes a
# person is the sentence explaining which of the two checks it managed.
contains() { # <name> <haystack> <needle>
	case "$2" in
	*"$3"*) printf '  ok    %s\n' "$1" ;;
	*)
		printf '  FAIL  %s: %s does not mention %s\n' "$1" "$2" "$3" >&2
		failures=$((failures + 1))
		;;
	esac
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

# The signature.
#
# A bundle to point at. Its contents are never read: cosign is the thing that
# reads a bundle, and cosign is the seam.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
: >"$work/checksums.txt"
: >"$work/checksums.txt.sigstore.json"

# The identity is what the whole check rests on. A verification that did not pin
# it says only that somebody signed something.
equals "the signer is this repository's release workflow, on a tag" \
	"$(signer_identity)" \
	'^https://github\.com/missingstudio/eva/\.github/workflows/release\.yml@refs/tags/'

# A dot in a repository name is a dot, not "any character". GitHub allows one, and
# without escaping, an identity built for one repository matches another.
equals "a dot in a repository name is escaped" \
	"$(REPO='evil.com/eva' signer_identity)" \
	'^https://github\.com/evil\.com/eva/\.github/workflows/release\.yml@refs/tags/'

# A signature that holds: the install goes on, and it says which check it made.
have_cosign() { return 0; }
cosign_verify() { return 0; }
allows "a signature that holds installs" \
	verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json"
contains "a signature that holds is reported" \
	"$(verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json")" \
	"signature ok"

# A signature that does not hold installs nothing. This is the case that has to be
# a refusal rather than a warning, and it is a refusal whatever the flags say —
# so it is asserted with the flag off, which is the setting that could get it
# wrong.
cosign_verify() { return 1; }
REQUIRE_SIG=0
refuses "a signature that does not hold installs nothing" \
	verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json"
REQUIRE_SIG=1
refuses "and it is still a refusal when one was required" \
	verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json"
REQUIRE_SIG=0

# The refusal names what it wanted, because "the signature is wrong" sends a
# person nowhere.
identity_said=$( (verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json") 2>&1 || true)
contains "the refusal names the identity it expected" "$identity_said" \
	'workflows/release\.yml'

# And it names both ways a verification fails, because cosign reports one status
# for the two and this does not parse its prose to tell them apart. A message that
# named only the signer would send somebody hunting for an impostor when what they
# have is a corrupted file.
contains "the refusal names both causes" "$identity_said" "changed after it was signed"
contains "and says not to retry" "$identity_said" "not a case to"

# No cosign: the install goes on, and the warning says what that leaves unproven
# rather than only what is missing.
cosign_verify() { return 0; }
have_cosign() { return 1; }
REQUIRE_SIG=0
allows "no cosign installs on the checksum alone" \
	verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json"
said=$( (verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json") 2>&1 || true)
contains "and says the signature was not checked" "$said" "cosign is not installed"
contains "and says what that leaves unproven" "$said" "not that the release is Eva's"

# The same machine, told to require one.
REQUIRE_SIG=1
refuses "no cosign under --require-signature installs nothing" \
	verify_signature "$work/checksums.txt" "$work/checksums.txt.sigstore.json"

# A release with no bundle at all — every release published before signing began.
# It installs, saying so, and refuses when a signature was required.
have_cosign() { return 0; }
REQUIRE_SIG=0
allows "an unsigned build installs on the checksum alone" \
	verify_signature "$work/checksums.txt" "$work/nothing-here.sigstore.json"
unsigned=$( (verify_signature "$work/checksums.txt" "$work/nothing-here.sigstore.json") 2>&1 || true)
contains "and says the build is unsigned" "$unsigned" "publishes no signature"
REQUIRE_SIG=1
refuses "an unsigned build under --require-signature installs nothing" \
	verify_signature "$work/checksums.txt" "$work/nothing-here.sigstore.json"

if [ "$failures" -ne 0 ]; then
	echo "$failures install case(s) failed" >&2
	exit 1
fi
echo "install  ok"

#!/bin/sh
#
# Install Eva from a published release.
#
#   curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh
#   curl -fsSL … | sh -s -- --channel next
#   curl -fsSL … | sh -s -- --version 0.2.0 --dir /usr/local/bin
#
# A channel is resolved here rather than stored anywhere: stable is what
# GitHub's own latest-release endpoint returns, because that endpoint excludes
# prereleases by definition, and next is the newest release marked prerelease.
# Nothing in this script can move a version, and nothing it downloads is
# installed before its checksum matches.
#
# # What the two checks prove, and what they do not
#
# The checksum is fetched from the same host as the archive. That makes it a
# check on the download rather than on the release: it catches a truncated
# transfer, a half-published release whose assets and checksums disagree, and the
# wrong asset for the platform. It catches nothing an attacker serving both files
# would do, because such an attacker serves a matching checksums.txt — and this
# script itself, which arrives from the same host.
#
# The signature is the check that answers the other question. The release signs
# checksums.txt with cosign's keyless flow, so the signing certificate names the
# workflow, the repository, and the tag that produced it; verifying it proves the
# checksums came from this repository's release workflow and not from whoever is
# serving the bytes. So the signature is checked first, and the checksum is
# checked against a file that has been established as Eva's.
#
# It degrades rather than refusing, because cosign is not on the machine of
# somebody running one curl to try Eva out, and an installer that refused there
# would be an installer nobody runs. What it does instead is say which of the two
# checks it managed, on stderr, in the words of what that leaves unproven.
# `--require-signature` turns the degradation into a refusal, which is what a CI
# job or a hardened machine wants.
#
# Windows is not covered. Use the archive from the release page, or `go install`.
#
# This file is written as functions around two seams. `fetch` is how bytes
# arrive, and it is the only thing that reaches the network — so the tests in
# install_test.sh replace it with recorded releases and exercise the channel
# resolution that once shipped broken. `cosign_verify` and `have_cosign` are the
# second: a test cannot mint a sigstore bundle and cannot install cosign, so what
# it substitutes is the verdict, and what it asserts is what this script does with
# each one. `make rehearse` runs the whole of it against a local snapshot build
# with --from-dist, which is the same path without the network — and without a
# signature, because keyless signing needs an OIDC token a laptop does not have.
#
# Sourcing this file with EVA_INSTALL_LIB=1 defines the functions and installs
# nothing.
set -eu

REPO="${EVA_REPO:-missingstudio/eva}"
API="https://api.github.com/repos/$REPO"

# REQUIRE_SIG is whether a signature that cannot be checked stops the install.
#
# It is read here as well as from the flag, so that a machine can decide once for
# every install on it rather than at every call site. install_main overrides it
# when --require-signature is given, and never the other way round: a flag may
# tighten this and nothing may loosen it.
REQUIRE_SIG="${EVA_REQUIRE_SIGNATURE:-0}"

# The issuer that vouches for a release's signing certificate.
#
# It is GitHub's OIDC provider because the signing happens in a GitHub Actions
# job, and it is written here rather than passed in because a caller who could
# name a different issuer could name their own.
SIG_ISSUER="https://token.actions.githubusercontent.com"

die() {
	echo "install: $*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Install Eva.

USAGE:
  install.sh [--channel stable|next] [--version X.Y.Z] [--dir <path>]
             [--from-dist <dir>] [--require-signature]

OPTIONS:
  --channel <name>   stable (default) is the newest release; next is the newest
                     prerelease
  --version <X.Y.Z>  install exactly this version, whatever any channel says
  --dir <path>       where the binary goes; default ~/.local/bin, or
                     $EVA_INSTALL_DIR when that is set
  --from-dist <dir>  install from a local `make snapshot` build rather than a
                     release, reaching no network. This is how the rehearsal
                     runs this script before there is a tag.
  --require-signature
                     install nothing unless the release's signature is checked
                     and matches. Without it, a machine with no cosign installs
                     on the checksum alone and is told so. $EVA_REQUIRE_SIGNATURE
                     sets it for every install on a machine.
  --help             show this

VERIFICATION:
  The signature proves the checksums came from this repository's release
  workflow; the checksum proves the archive matches them. A bad signature or a
  bad checksum installs nothing, whatever the flags say.

Eva reports what it is with `eva version`.
EOF
}

# The seam.
#
# fetch <url>              writes the body to stdout
# fetch_to <url> <path>    writes the body to a file
#
# Defined here from whichever tool is present, and replaced wholesale by the
# tests. Everything that reaches the network goes through these two.
install_choose_fetch() {
	if command -v curl >/dev/null 2>&1; then
		fetch() { curl -fsSL "$1"; }
		fetch_to() { curl -fsSL -o "$2" "$1"; }
	elif command -v wget >/dev/null 2>&1; then
		fetch() { wget -qO- "$1"; }
		fetch_to() { wget -qO "$2" "$1"; }
	else
		die "neither curl nor wget is installed"
	fi
}

# The artifact contract.
#
# The one place this script states what a release is called. It mirrors
# .goreleaser.yaml's name_template and its windows format_override, and
# `make rehearse` asserts the two agree by checking these names against the
# files a snapshot build actually wrote.
archive_name() {
	case "${2:-}" in
	windows) printf 'eva_%s_%s_%s.zip' "$1" "$2" "$3" ;;
	*) printf 'eva_%s_%s_%s.tar.gz' "$1" "$2" "$3" ;;
	esac
}

# The platform, in the names the archives are built under.
detect_os() {
	os=$(uname -s | tr '[:upper:]' '[:lower:]')
	case "$os" in
	darwin | linux) printf '%s' "$os" ;;
	*) return 1 ;;
	esac
}

detect_arch() {
	case $(uname -m) in
	x86_64 | amd64) printf 'amd64' ;;
	arm64 | aarch64) printf 'arm64' ;;
	*) return 1 ;;
	esac
}

# Channels.
#
# resolve_tag <channel> writes the tag to stdout, or returns 1.
#
# The parsing is deliberately dependency-free: jq is not on every machine that
# will run this. It is also deliberately one object at a time. An earlier
# version read the whole releases list and split it on `{`, which the nested
# author and assets objects split too — so the piece holding "prerelease": true
# held no tag_name, and --channel next found nothing. Asking for one release by
# tag is a request more, and it cannot confuse two objects for one.
resolve_tag() {
	case "${1:-}" in
	stable)
		tag=$(fetch "$API/releases/latest" |
			sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
		[ -n "$tag" ] || return 1
		printf '%s' "$tag"
		;;
	next)
		for candidate in $(fetch "$API/releases?per_page=20" |
			sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p'); do
			if fetch "$API/releases/tags/$candidate" |
				grep -q '"prerelease": *true'; then
				printf '%s' "$candidate"
				return 0
			fi
		done
		return 1
		;;
	*) return 1 ;;
	esac
}

# The second seam.
#
# have_cosign      reports whether a signature can be checked at all
# cosign_verify    checks one, and reports whether it held
#
# These are two lines of shell each, and they are functions for the reason fetch
# is: a test can neither install cosign nor mint a sigstore bundle for a release
# it did not sign. So a test replaces the verdict and asserts what this script
# does with it — which is the part that has to be right, and the part that would
# otherwise be reachable only by publishing a release.
have_cosign() { command -v cosign >/dev/null 2>&1; }

# cosign_verify <bundle> <subject> <identity regexp> <issuer>
#
# The identity and the issuer are given rather than looked up here, because a
# verification that did not pin both is not a verification: a keyless signature
# with no expected identity says only that somebody, somewhere, signed this.
#
# Output is discarded and the exit status is the whole answer. What cosign prints
# on success is a line about a transparency log, and what it prints on failure is
# for whoever is debugging sigstore — neither is what a person installing Eva
# needs, and the caller says something better in both cases.
cosign_verify() {
	cosign verify-blob "$2" \
		--bundle "$1" \
		--certificate-identity-regexp "$3" \
		--certificate-oidc-issuer "$4" \
		>/dev/null 2>&1
}

# Verification.
#
# regexp_escape makes a literal string safe to put in a regexp.
#
# It escapes every character that is not a letter, a digit, an underscore, a
# slash, or a hyphen. Without it a repository whose name holds a dot — which
# GitHub allows — would have that dot match any character, so `evil.com/eva`
# would satisfy an identity built for `evil.com/eva` and also one built for
# `evilXcom/eva`. It is a small hole and it is the kind that is only ever found
# afterwards.
regexp_escape() { printf '%s' "$1" | sed 's/[^A-Za-z0-9/_-]/\\&/g'; }

# signer_identity is the identity a release's signing certificate must carry.
#
# It is the workflow, in this repository, running on a tag — which is read off a
# published certificate rather than guessed at:
#
#   URI:https://github.com/missingstudio/eva/.github/workflows/release.yml@refs/tags/v0.1.1
#
# Anchored at the front, and open at the end because the tag is the part that
# changes. Pinning the workflow as well as the repository is what makes this a
# statement about the release path rather than about the account: a token from any
# other workflow in this repository signs a certificate this rejects.
signer_identity() {
	printf '^https://github\.com/%s/\.github/workflows/release\.yml@refs/tags/' \
		"$(regexp_escape "$REPO")"
}

# unverified reports a signature that could not be checked, and stops when the
# caller said it must be.
#
# The second line is the point of the first. "cosign is not installed" is a fact
# about a machine; what a person needs is what that leaves unproven, and saying it
# every time is cheaper than a person having to know why the two checks are
# different. It goes to stderr because it is not the result of the install.
unverified() {
	if [ "$REQUIRE_SIG" = "1" ]; then
		die "$1
--require-signature was given, so nothing was installed."
	fi
	echo "warning: $1" >&2
	echo "         the checksum proves the download is intact, not that the release is Eva's" >&2
	echo "         install cosign, or pass --require-signature, to check that too" >&2
}

# verify_signature <subject> <bundle>
#
# A signature that does not hold installs nothing, whatever the flags say. A
# signature that cannot be checked is the degradation above.
verify_signature() {
	if [ ! -f "$2" ]; then
		unverified "this build publishes no signature for ${1##*/}"
		return 0
	fi
	if ! have_cosign; then
		unverified "cosign is not installed, so the signature was not checked"
		return 0
	fi

	identity=$(signer_identity)
	if ! cosign_verify "$2" "$1" "$identity" "$SIG_ISSUER"; then
		# Two things fail here and cosign reports one status for both: the file
		# changed after it was signed, or it was signed by somebody else. Which one
		# is in cosign's own prose, and this does not parse a dependency's prose to
		# find out — so the message names both causes and neither is guessed at.
		die "the signature on ${1##*/} did not verify
  expected identity: $identity
  expected issuer:   $SIG_ISSUER
Either the file was changed after it was signed, or it was not signed by this
repository's release workflow. Nothing was installed, and this is not a case to
retry: check it by hand before trusting these bytes.
  https://github.com/$REPO/blob/main/docs/how-to/install-eva.md#verify-what-you-downloaded"
	fi
	echo "signature ok — ${1##*/} was signed by $REPO's release workflow"
}

# checksum_of <file> writes the file's SHA-256 to stdout.
checksum_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d' ' -f1
	else
		die "neither sha256sum nor shasum is installed, so the archive cannot be verified"
	fi
}

# published_checksum <checksums.txt> <archive name>
published_checksum() {
	sed -n "s/^\\([0-9a-f]\\{64\\}\\)[[:space:]]*\\*\\{0,1\\}$2\$/\\1/p" "$1" | head -n 1
}

# verify_archive <archive path> <checksums.txt> <archive name>
#
# Nothing is installed before its checksum matches. A download that cannot be
# checked is a download that is thrown away.
#
# What this establishes is that the archive is the one checksums.txt names. Whether
# checksums.txt is Eva's own is the signature's question, asked before this — see
# verify_signature, and the note at the head of this file.
verify_archive() {
	sum=$(checksum_of "$1")
	want=$(published_checksum "$2" "$3")
	[ -n "$want" ] || die "checksums.txt names no entry for $3"

	if [ "$sum" != "$want" ]; then
		die "the checksum does not match
  archive:  $sum
  published: $want
Nothing was installed."
	fi
	echo "checksum ok"
}

# Installing.
#
# unpack_and_install <archive path> <workdir> <destination dir>
unpack_and_install() {
	tar -xzf "$1" -C "$2"
	[ -f "$2/eva" ] || die "the archive holds no eva binary"

	mkdir -p "$3"
	# A move across filesystems is a copy, and mv handles that. install(1) is
	# not on every machine.
	mv "$2/eva" "$3/eva"
	chmod 0755 "$3/eva"
	echo "installed $3/eva"
}

report_path() {
	case ":$PATH:" in
	*":$1:"*) ;;
	*) echo "
$1 is not on your PATH. Add it:
  export PATH=\"$1:\$PATH\"" ;;
	esac
}

report_quarantine() {
	if [ "$1" = "darwin" ]; then
		echo "
macOS may refuse an unsigned binary that was downloaded. If it does:
  xattr -d com.apple.quarantine \"$2/eva\"
Notarized builds are not published yet."
	fi
}

# Main.
install_main() {
	CHANNEL="stable"
	VERSION=""
	DIR="${EVA_INSTALL_DIR:-$HOME/.local/bin}"
	FROM_DIST=""

	while [ $# -gt 0 ]; do
		case "$1" in
		--channel)
			[ $# -ge 2 ] || die "--channel needs a name"
			CHANNEL="$2"
			shift 2
			;;
		--version)
			[ $# -ge 2 ] || die "--version needs a number"
			VERSION="${2#v}"
			shift 2
			;;
		--dir)
			[ $# -ge 2 ] || die "--dir needs a path"
			DIR="$2"
			shift 2
			;;
		--from-dist)
			[ $# -ge 2 ] || die "--from-dist needs a directory"
			FROM_DIST="$2"
			shift 2
			;;
		--require-signature)
			REQUIRE_SIG=1
			shift
			;;
		--help | -h)
			usage
			exit 0
			;;
		*) die "unknown option $1 (try --help)" ;;
		esac
	done

	case "$CHANNEL" in
	stable | next) ;;
	*) die "unknown channel $CHANNEL: it is stable or next" ;;
	esac

	os=$(detect_os) ||
		die "no release is built for $(uname -s); use \`go install github.com/$REPO/cmd/eva@latest\`"
	arch=$(detect_arch) || die "no release is built for $(uname -m)"

	tmp=$(mktemp -d)
	# shellcheck disable=SC2064 # tmp is expanded now on purpose: it cannot change.
	trap "rm -rf '$tmp'" EXIT INT TERM

	# A local snapshot build, reaching no network. Everything past this point
	# is the same for a release and for a rehearsal.
	if [ -n "$FROM_DIST" ]; then
		[ -d "$FROM_DIST" ] || die "$FROM_DIST is not a directory"
		[ -n "$VERSION" ] || VERSION=$(dist_version "$FROM_DIST") ||
			die "cannot tell what version $FROM_DIST holds"

		archive=$(archive_name "$VERSION" "$os" "$arch")
		[ -f "$FROM_DIST/$archive" ] ||
			die "$FROM_DIST holds no $archive
The archive names this script derives and the ones the build wrote disagree."
		echo "installing eva $VERSION ($os/$arch) from $FROM_DIST"

		cp "$FROM_DIST/$archive" "$tmp/$archive"
		[ -f "$FROM_DIST/checksums.txt" ] ||
			die "$FROM_DIST has no checksums.txt, so nothing can be verified"

		# A snapshot is unsigned, and this says so rather than passing over it. The
		# rehearsal is the caller that sees this line every time, which is correct:
		# what it is rehearsing is the path, and the signature is the one step of it
		# that a tag has and a laptop does not.
		verify_signature "$FROM_DIST/checksums.txt" "$FROM_DIST/checksums.txt.sigstore.json"
		verify_archive "$tmp/$archive" "$FROM_DIST/checksums.txt" "$archive"

		unpack_and_install "$tmp/$archive" "$tmp" "$DIR"
		report_path "$DIR"
		echo "
Check it:
  $DIR/eva version"
		return 0
	fi

	install_choose_fetch

	# The version, from the channel, unless one was named.
	if [ -z "$VERSION" ]; then
		if [ "$CHANNEL" = "stable" ]; then
			tag=$(resolve_tag stable) || die "no stable release found for $REPO
A prerelease may exist: try --channel next."
		else
			tag=$(resolve_tag next) || die "no prerelease found for $REPO
Try --channel stable."
		fi
		VERSION="${tag#v}"
	fi

	archive=$(archive_name "$VERSION" "$os" "$arch")
	base="https://github.com/$REPO/releases/download/v${VERSION}"

	echo "installing eva $VERSION ($os/$arch) from the $CHANNEL channel"

	fetch_to "$base/$archive" "$tmp/$archive" ||
		die "no archive at $base/$archive
Check the version, or the release page: https://github.com/$REPO/releases"
	fetch_to "$base/checksums.txt" "$tmp/checksums.txt" ||
		die "the release has no checksums.txt, so nothing can be verified"

	# The bundle is optional, so a release published before signing began still
	# installs — on the checksum alone, and saying so. The file is removed on a
	# failed fetch because curl and wget both leave one behind, and an empty file
	# would reach cosign as a bundle rather than as an absence.
	bundle="$tmp/checksums.txt.sigstore.json"
	fetch_to "$base/checksums.txt.sigstore.json" "$bundle" || rm -f "$bundle"

	# The signature first, because it is what makes the checksums Eva's. Checking
	# the archive against a file of unknown origin and then asking where the file
	# came from would be doing the two in the order that proves the least.
	verify_signature "$tmp/checksums.txt" "$bundle"
	verify_archive "$tmp/$archive" "$tmp/checksums.txt" "$archive"
	unpack_and_install "$tmp/$archive" "$tmp" "$DIR"

	report_path "$DIR"
	report_quarantine "$os" "$DIR"

	echo "
Check it:
  $DIR/eva version"
}

# dist_version <dir> reads the version a snapshot build stamped into its
# metadata, so the rehearsal does not have to be told what it just built.
dist_version() {
	[ -f "$1/metadata.json" ] || return 1
	v=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/metadata.json" | head -n 1)
	[ -n "$v" ] || return 1
	printf '%s' "$v"
}

[ "${EVA_INSTALL_LIB:-}" = "1" ] || install_main "$@"

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
# Windows is not covered. Use the archive from the release page, or `go install`.
#
# This file is written as functions around one seam. `fetch` is how bytes
# arrive, and it is the only thing that reaches the network — so the tests in
# install_test.sh replace it with recorded releases and exercise the channel
# resolution that once shipped broken. `make rehearse` runs the whole of it
# against a local snapshot build with --from-dist, which is the same path
# without the network.
#
# Sourcing this file with EVA_INSTALL_LIB=1 defines the functions and installs
# nothing.
set -eu

REPO="${EVA_REPO:-missingstudio/eva}"
API="https://api.github.com/repos/$REPO"

die() {
	echo "install: $*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Install Eva.

USAGE:
  install.sh [--channel stable|next] [--version X.Y.Z] [--dir <path>]
             [--from-dist <dir>]

OPTIONS:
  --channel <name>   stable (default) is the newest release; next is the newest
                     prerelease
  --version <X.Y.Z>  install exactly this version, whatever any channel says
  --dir <path>       where the binary goes; default ~/.local/bin, or
                     $EVA_INSTALL_DIR when that is set
  --from-dist <dir>  install from a local `make snapshot` build rather than a
                     release, reaching no network. This is how the rehearsal
                     runs this script before there is a tag.
  --help             show this

Eva reports what it is with `eva version`.
EOF
}

# --- the seam -------------------------------------------------------------
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

# --- the artifact contract ------------------------------------------------
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

# --- channels -------------------------------------------------------------
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

# --- verification ---------------------------------------------------------
#
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

# --- installing -----------------------------------------------------------
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

# --- main -----------------------------------------------------------------
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

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
set -eu

REPO="missingstudio/eva"
API="https://api.github.com/repos/$REPO"

CHANNEL="stable"
VERSION=""
DIR="${EVA_INSTALL_DIR:-$HOME/.local/bin}"

usage() {
	cat <<'EOF'
Install Eva.

USAGE:
  install.sh [--channel stable|next] [--version X.Y.Z] [--dir <path>]

OPTIONS:
  --channel <name>   stable (default) is the newest release; next is the newest
                     prerelease
  --version <X.Y.Z>  install exactly this version, whatever any channel says
  --dir <path>       where the binary goes; default ~/.local/bin, or
                     $EVA_INSTALL_DIR when that is set
  --help             show this

Eva reports what it is with `eva version`.
EOF
}

die() {
	echo "install: $*" >&2
	exit 1
}

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

# fetch writes a URL to stdout, using whichever of the two tools is here.
if command -v curl >/dev/null 2>&1; then
	fetch() { curl -fsSL "$1"; }
	fetch_to() { curl -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
	fetch() { wget -qO- "$1"; }
	fetch_to() { wget -qO "$2" "$1"; }
else
	die "neither curl nor wget is installed"
fi

# The platform, in the names the archives are built under.
os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
darwin | linux) ;;
*) die "no release is built for $os; use \`go install github.com/$REPO/cmd/eva@latest\`" ;;
esac

case $(uname -m) in
x86_64 | amd64) arch="amd64" ;;
arm64 | aarch64) arch="arm64" ;;
*) die "no release is built for $(uname -m)" ;;
esac

# The version, from the channel, unless one was named.
#
# The parsing is deliberately dependency-free: jq is not on every machine that
# will run this. Each pattern reads one field out of one object, and a release
# that does not parse is an error rather than an empty string used as a version.
if [ -z "$VERSION" ]; then
	if [ "$CHANNEL" = "stable" ]; then
		tag=$(fetch "$API/releases/latest" |
			sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
		[ -n "$tag" ] || die "no stable release found for $REPO
A prerelease may exist: try --channel next."
	else
		# The releases endpoint is newest first, so the first prerelease in it is
		# the newest one. tr puts one release per line so that head means what it
		# looks like it means.
		tag=$(fetch "$API/releases?per_page=30" |
			tr '{' '\n' |
			grep '"prerelease": *true' |
			sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
		[ -n "$tag" ] || die "no prerelease found for $REPO
Try --channel stable."
	fi
	VERSION="${tag#v}"
fi

# darwin and linux ship tar.gz, and they are the only two this script reaches.
# The Windows archive is a zip, and it is installed by hand.
archive="eva_${VERSION}_${os}_${arch}.tar.gz"
base="https://github.com/$REPO/releases/download/v${VERSION}"

tmp=$(mktemp -d)
# shellcheck disable=SC2064 # tmp is expanded now on purpose: it cannot change.
trap "rm -rf '$tmp'" EXIT INT TERM

echo "installing eva $VERSION ($os/$arch) from the $CHANNEL channel"

fetch_to "$base/$archive" "$tmp/$archive" ||
	die "no archive at $base/$archive
Check the version, or the release page: https://github.com/$REPO/releases"
fetch_to "$base/checksums.txt" "$tmp/checksums.txt" ||
	die "the release has no checksums.txt, so nothing can be verified"

# Nothing is installed before its checksum matches. A download that cannot be
# checked is a download that is thrown away.
if command -v sha256sum >/dev/null 2>&1; then
	sum=$(sha256sum "$tmp/$archive" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then
	sum=$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)
else
	die "neither sha256sum nor shasum is installed, so the archive cannot be verified"
fi

want=$(sed -n "s/^\\([0-9a-f]\\{64\\}\\)[[:space:]]*\\*\\{0,1\\}$archive\$/\\1/p" \
	"$tmp/checksums.txt" | head -n 1)
[ -n "$want" ] || die "checksums.txt names no entry for $archive"

if [ "$sum" != "$want" ]; then
	die "the checksum does not match
  archive:  $sum
  published: $want
Nothing was installed."
fi
echo "checksum ok"

tar -xzf "$tmp/$archive" -C "$tmp"
[ -f "$tmp/eva" ] || die "the archive holds no eva binary"

mkdir -p "$DIR"
# A move across filesystems is a copy, and mv handles that. install(1) is not on
# every machine.
mv "$tmp/eva" "$DIR/eva"
chmod 0755 "$DIR/eva"

echo "installed $DIR/eva"

case ":$PATH:" in
*":$DIR:"*) ;;
*) echo "
$DIR is not on your PATH. Add it:
  export PATH=\"$DIR:\$PATH\"" ;;
esac

if [ "$os" = "darwin" ]; then
	echo "
macOS may refuse an unsigned binary that was downloaded. If it does:
  xattr -d com.apple.quarantine \"$DIR/eva\"
Notarized builds are not published yet."
fi

echo "
Check it:
  $DIR/eva version"

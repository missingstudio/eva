#!/bin/sh
#
# The release guard's cases. The first one is the defect that stopped
# v0.1.0-rc.1: a prerelease is a candidate for its release, and a guard that
# strips only build metadata rejects the one tag shape worth pushing first.
set -eu

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
EVA_GUARD_LIB=1 . ./scripts/release-guard.sh

failures=0

check() { # <name> <expected: accept|reject> <tag> <reported>
	if guard_version "$3" "$4" >/dev/null 2>&1; then
		got=accept
	else
		got=reject
	fi
	if [ "$got" = "$2" ]; then
		printf '  ok    %s\n' "$1"
	else
		printf '  FAIL  %s: got %s, want %s\n' "$1" "$got" "$2" >&2
		failures=$((failures + 1))
	fi
}

check "a prerelease is a candidate for its release" accept "v0.1.0-rc.1" "0.1.0+abc1234"
check "a tag that disagrees with the constant" reject "v0.2.0" "0.1.0+abc1234"
check "nothing reported" reject "v0.1.0" ""
check "no tag" reject "" "0.1.0"

if [ "$failures" -ne 0 ]; then
	echo "$failures guard case(s) failed" >&2
	exit 1
fi
echo "guard    ok"

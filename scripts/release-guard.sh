#!/bin/sh
#
# The gates only a release can fail, in a file a test can run.
#
#   release-guard.sh version <tag> <reported>   the tag agrees with the binary
#   release-guard.sh range   <tag>              the tag has commits behind it
#
# These two checks lived as shell inside release.yml, where the only way to run
# them was to push a tag. Both shipped broken that way: the version check
# rejected every prerelease, which is the one tag shape worth pushing first.
# Here they are functions with a test beside them, and the workflow is one of
# two callers rather than the only one.
#
# Sourcing this file with EVA_GUARD_LIB=1 defines the functions and runs
# nothing, which is how release-guard_test.sh reaches them.
set -eu

# The comparable part of a version: build metadata (+abc1234) and any
# prerelease suffix (-rc.1) removed.
#
# v0.1.0-rc.1 is a candidate for 0.1.0, so it agrees with the constant on 0.1.0
# and may differ after it. Stripping only the metadata is the defect that
# rejected every prerelease.
guard_base() {
	v="${1%%+*}"
	printf '%s' "${v%%-*}"
}

# guard_version <tag> <reported>
#
# <reported> is what `eva version` printed, e.g. 0.1.0+abc1234. It is asked of
# the program rather than read from the source, because what ships is the
# binary's answer: a grep over a const line would agree with a file while the
# built program said something else.
guard_version() {
	tag_raw="${1:-}"
	reported="${2:-}"

	if [ -z "$tag_raw" ]; then
		echo "guard: no tag given" >&2
		return 1
	fi

	# An empty or unparsable reading is a failure of its own. Without this, a
	# change to `eva version`'s output shape makes the comparison compare
	# nothing to nothing and pass.
	case "$reported" in
	[0-9]*) ;;
	*)
		echo "guard: the binary reported '${reported}', which is not a version" >&2
		echo "guard: \`eva version\` prints 'eva: <version>' and this reads the second field" >&2
		return 1
		;;
	esac

	built=$(guard_base "$reported")
	tag=$(guard_base "${tag_raw#v}")
	echo "guard: tag=$tag_raw -> $tag   binary=$reported -> $built"

	if [ "$tag" != "$built" ]; then
		echo "guard: the tag's version is $tag and the binary's is $built" >&2
		echo "guard: internal/cli.Version is the source of truth; the tag agrees with it" >&2
		return 1
	fi
	echo "guard: the tag agrees with the binary"
}

# guard_range <tag>
#
# A tag pointing where the last one did has nothing to release, and an empty
# changelog is how that mistake reaches a user.
#
# A tag this repository does not have is not an error: that is the rehearsal,
# which runs every gate before the tag exists.
guard_range() {
	tag="${1:-}"
	if [ -z "$tag" ]; then
		echo "guard: no tag given" >&2
		return 1
	fi

	if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
		echo "guard: $tag is not a tag here, so there is no range to measure yet"
		return 0
	fi

	previous=$(git describe --tags --abbrev=0 "${tag}^" 2>/dev/null || true)
	if [ -z "$previous" ]; then
		echo "guard: no earlier tag, so this is the first release and the range is the history"
		return 0
	fi

	n=$(git rev-list --count "$previous..$tag")
	echo "guard: $n commit(s) since $previous"
	if [ "$n" -eq 0 ]; then
		echo "guard: $tag points where $previous does, so there is nothing to release" >&2
		return 1
	fi
}

guard_usage() {
	cat <<'EOF'
usage:
  release-guard.sh version <tag> <reported>   the tag agrees with the binary
  release-guard.sh range   <tag>              the tag has commits behind it
EOF
}

guard_main() {
	case "${1:-}" in
	version)
		shift
		guard_version "${1:-}" "${2:-}"
		;;
	range)
		shift
		guard_range "${1:-}"
		;;
	-h | --help | help)
		guard_usage
		;;
	*)
		guard_usage >&2
		return 2
		;;
	esac
}

[ "${EVA_GUARD_LIB:-}" = "1" ] || guard_main "$@"

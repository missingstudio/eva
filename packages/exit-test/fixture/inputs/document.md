# Platform sync — meeting notes

Date: 2026-08-11
Location: video call, recorded
Present: Dana Okafor (platform), Priya Natarajan (infra), Sam Whitlock
(support), Jo Ellis (product, first half only)

## Context

The August release slipped a week because the export pipeline held the
release branch. Support volume is flat, but the two oldest tickets in the
queue are both about the same digest bug. Infra finished the region
failover drill on the 8th; the writeup is in the runbook repository.

Jo walked through the Q3 plan before leaving: the headline is the shared
workspace beta, which sales has already promised to two accounts. Dana
raised that the beta flag is still wired to the old permissions table, and
flipping it for real customers without the migration is not safe.

## Discussion

Priya reported the failover drill found one gap: the digest scheduler does
not re-register its timers after a region move, which is likely the same
root cause as the two support tickets Sam flagged. Sam confirmed both
tickets reproduce only after the June region migration. The room agreed
this is one bug, not three.

Dana proposed shipping the permissions migration behind its own flag first,
and only then opening the workspace beta. Nobody objected. Priya wants the
migration rehearsed on the staging copy before it touches production data.

There was a short detour about renaming the internal "tenant" tables; it
was parked, again.

## Decisions

- The permissions migration ships before the workspace beta opens. Dana
  Okafor owns it, rehearsal on staging included, due 2026-09-05.
- The digest scheduler re-registration bug is one fix for the failover gap
  and both support tickets. Priya Natarajan owns it, due 2026-08-22.
- Sam Whitlock replies to both open tickets today naming the fix and the
  date, and links them to the same tracking issue.

## Parked

- Renaming the internal tenant tables. No owner, no date.
- A public status page for digest delivery, until the scheduler fix lands.

## Next

Same call, two weeks out: 2026-08-25. Jo to confirm whether the beta
accounts accept a staged rollout.

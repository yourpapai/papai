<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0416: AdminUsersSection UX Open-Findings — Closed (Shipped)

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-07-admin-users-open-findings.md` (paired spec `docs/archive/2026-08-07-admin-users-open-findings-design.md`)
defined the fix for the open UX findings from a review of the AdminUsersSection
client surface. The findings were addressed in the section's client component
and the review record was updated.

## Decision Drivers

- **Findings are review-driven UI fixes**, each tied to an observable defect
  in the section component.
- **The review record is the source of truth** for resolution status
  (`docs/ux-reviews/AdminUsersSection.md`).
- **Closes on master**, not in this migration branch — these arrived via the
  master merge already resolved.

## Decision

Archive the plan and spec as shipped. The AdminUsersSection findings were closed on
master (commit 95ef1ef66 (close the admin-users truncation finding) + fe0cf7a89 / 2b14b7782); the review record `docs/ux-reviews/AdminUsersSection.md` carries
the resolutions and the regenerated backlog.

## Consequences

### Positive

- The AdminUsersSection surface no longer carries the documented open findings.
- The review record and regenerated backlog (`docs/ux-reviews/_BACKLOG.md`)
  reflect the closed state.

### Negative

- Some findings are closed by decision (accepted as-is) rather than by code;
  the review record is the place to distinguish the two.

## Implementation Status

Implemented. Findings closed on master; review record present at
`docs/ux-reviews/AdminUsersSection.md`.

## References

- Plan: `docs/archive/2026-08-07-admin-users-open-findings.md`
- Spec: `docs/archive/2026-08-07-admin-users-open-findings-design.md`
- Review record: `docs/ux-reviews/AdminUsersSection.md`
- Close evidence: commit 95ef1ef66 (close the admin-users truncation finding) + fe0cf7a89 / 2b14b7782

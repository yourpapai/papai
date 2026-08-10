<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0415: AdminInstancesSection UX Open-Findings — Closed (Shipped)

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-07-admin-instances-open-findings.md` (paired spec `docs/archive/2026-08-07-admin-instances-open-findings-design.md`)
defined the fix for the open UX findings from a review of the AdminInstancesSection
client surface. The findings were addressed in the section's client component
and the review record was updated.

## Decision Drivers

- **Findings are review-driven UI fixes**, each tied to an observable defect
  in the section component.
- **The review record is the source of truth** for resolution status
  (`docs/ux-reviews/AdminInstancesSection.md`).
- **Closes on master**, not in this migration branch — these arrived via the
  master merge already resolved.

## Decision

Archive the plan and spec as shipped. The AdminInstancesSection findings were closed on
master (commit 53f5fc426 (implementation plan) + the section review); the review record `docs/ux-reviews/AdminInstancesSection.md` carries
the resolutions and the regenerated backlog.

## Consequences

### Positive

- The AdminInstancesSection surface no longer carries the documented open findings.
- The review record and regenerated backlog (`docs/ux-reviews/_BACKLOG.md`)
  reflect the closed state.

### Negative

- Some findings are closed by decision (accepted as-is) rather than by code;
  the review record is the place to distinguish the two.

## Implementation Status

Implemented. Findings closed on master; review record present at
`docs/ux-reviews/AdminInstancesSection.md`.

## References

- Plan: `docs/archive/2026-08-07-admin-instances-open-findings.md`
- Spec: `docs/archive/2026-08-07-admin-instances-open-findings-design.md`
- Review record: `docs/ux-reviews/AdminInstancesSection.md`
- Close evidence: commit 53f5fc426 (implementation plan) + the section review

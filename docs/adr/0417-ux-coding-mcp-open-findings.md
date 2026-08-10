<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0417: CodingMcpSection UX Open-Findings — Closed (Shipped)

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-08-coding-mcp-open-findings.md` (paired spec `docs/archive/2026-08-08-coding-mcp-open-findings-design.md`)
defined the fix for the open UX findings from a review of the CodingMcpSection
client surface. The findings were addressed in the section's client component
and the review record was updated.

## Decision Drivers

- **Findings are review-driven UI fixes**, each tied to an observable defect
  in the section component.
- **The review record is the source of truth** for resolution status
  (`docs/ux-reviews/CodingMcpSection.md`).
- **Closes on master**, not in this migration branch — these arrived via the
  master merge already resolved.

## Decision

Archive the plan and spec as shipped. The CodingMcpSection findings were closed on
master (commit 97fc838d5 (implement the CodingMcpSection open findings)); the review record `docs/ux-reviews/CodingMcpSection.md` carries
the resolutions and the regenerated backlog.

## Consequences

### Positive

- The CodingMcpSection surface no longer carries the documented open findings.
- The review record and regenerated backlog (`docs/ux-reviews/_BACKLOG.md`)
  reflect the closed state.

### Negative

- Some findings are closed by decision (accepted as-is) rather than by code;
  the review record is the place to distinguish the two.

## Implementation Status

Implemented. Findings closed on master; review record present at
`docs/ux-reviews/CodingMcpSection.md`.

## References

- Plan: `docs/archive/2026-08-08-coding-mcp-open-findings.md`
- Spec: `docs/archive/2026-08-08-coding-mcp-open-findings-design.md`
- Review record: `docs/ux-reviews/CodingMcpSection.md`
- Close evidence: commit 97fc838d5 (implement the CodingMcpSection open findings)

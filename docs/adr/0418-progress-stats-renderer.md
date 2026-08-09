<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0418: Review-Loop Progress & Stats Renderer — Shipped

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-07-progress-stats-renderer.md` (paired spec
`docs/archive/2026-08-07-progress-stats-renderer-design.md`) upgraded the
review-loop / mutation-improve live renderer to show per-file scores/outcomes
and aggregate run progress. The design and plan landed on master alongside the
renderer implementation in `review-loop/src/`.

## Decision Drivers

- The renderer is the operator's live window into autonomous mutation runs;
  progress + stats readability is load-bearing for trusting the runner.
- Design/plan/implementation landed together on master.

## Decision

Archive the plan and spec as shipped. The progress & stats renderer landed on
master (design `b32715772`, plan `2ffb920fc`, spec refinements
`3f31fda69` / `30f75ba9c`) and is exercised by the review-loop suites.

## Consequences

### Positive

- Autonomous-run output is scannable: per-file scores/outcomes/±lines plus
  aggregate totals in the live footer and end-of-run summary.

### Negative

- The renderer is review-loop/mutation-improve-local; a papai-wide progress
  surface would be a separate effort.

## Implementation Status

Implemented. Renderer present in `review-loop/src/`; covered by the
review-loop tests.

## References

- Plan: `docs/archive/2026-08-07-progress-stats-renderer.md`
- Spec: `docs/archive/2026-08-07-progress-stats-renderer-design.md`
- Design/plan/spec commits: `b32715772`, `2ffb920fc`, `3f31fda69`, `30f75ba9c`

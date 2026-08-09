<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0419: opencode-agent Check-Loop — Shipped

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-09-agent-check-loop.md` (paired spec
`docs/archive/2026-08-09-agent-check-loop-design.md`) is the implementation
plan for the opencode-agent's check-loop phase — the periodic CI/status
verification loop inside the GitHub Actions issue-agent spike. The spike
(`feat(opencode-agent): add GitHub Actions issue agent spike`, `b59c223fa`)
grew into a substantial in-repo `opencode-agent/` workspace whose check-loop
(`opencode-agent/src/check-loop.ts`) and tests are present.

## Decision Drivers

- Originally flagged (in an earlier batch draft) as a possible live spike;
  confirmed by the owner as done.
- The check-loop module and its tests exist in the merged tree.

## Decision

Archive the plan and spec as shipped. The opencode-agent check-loop landed as
part of the spike-to-workspace growth on master; `opencode-agent/src/check-loop.ts`
and `tests/opencode-agent/check-loop.test.ts` are present.

## Consequences

### Positive

- The check-loop's status is recorded as shipped rather than left ambiguous.

### Negative

- The opencode-agent workspace is a spike-derived surface; its long-term home
  (in-repo vs extracted) is a separate decision.

## Implementation Status

Implemented. Check-loop module + tests present in `opencode-agent/`; spike
origin commit `b59c223fa`.

## References

- Plan: `docs/archive/2026-08-09-agent-check-loop.md`
- Spec: `docs/archive/2026-08-09-agent-check-loop-design.md`
- Source: `opencode-agent/src/check-loop.ts`; tests: `tests/opencode-agent/check-loop.test.ts`
- Spike origin: commit `b59c223fa`

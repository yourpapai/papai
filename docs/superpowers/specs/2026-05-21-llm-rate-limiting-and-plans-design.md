<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# LLM Rate Limiting and Plans Design

**Date:** 2026-05-21  
**Status:** Draft  
**Source notes:**

- [Detailed design note](../notes/llm-rate-limiting-and-plans.md)
- [Phase decomposition note](../notes/llm-rate-limiting-and-plans-phases.md)

## Context

papai already records LLM and tool usage in SQLite for the debug Billing and
Stats surfaces. The next step is to turn that telemetry into enforceable,
admin-managed plans without disrupting the existing usage event stream.

The detailed design note is the source of truth for domain rules, data model,
quota algorithms, enforcement semantics, admin/user surfaces, and open
questions. The phase decomposition note is the source of truth for sequencing
work into reviewable coding sessions.

## Goals

1. Let the admin define named plans with quota limits across LLM calls, token
   dimensions, tool executions, web fetches, and attachment storage.
2. Let the admin assign plans to users or groups while keeping group-thread
   storage contexts mapped to the parent group quota subject.
3. Enforce quota before chargeable work and reconcile counters with actual
   usage after the operation completes.
4. Preserve deferred prompt delivery by degrading from main model to small
   model and finally to a non-LLM template rather than slipping fire times.
5. Expose self-service `/plan`, `/quota`, `get_my_plan`, and `get_my_quota`
   surfaces, plus dashboard/admin APIs for plan management.
6. Keep `/stats/*` anonymous and separate from plan/quota details.

## Non-goals

- No USD-cost enforcement in the first release, though the schema remains
  forward-compatible with a future `cost_usd_micro` dimension.
- No per-chat-user fairness inside a group plan.
- No horizontal-scale quota coordination beyond the current single-process
  SQLite deployment model.
- No sliding-window log implementation; v1 uses fixed-window and
  rolling-refill/token-bucket algorithms.

## Design summary

Plans are stored as `plans` plus `plan_limits`. A subject override in
`subject_plan` selects a plan for a user or group; absence falls back to the
single default plan. Runtime counters live in `quota_counter`, keyed by
`subject_id`, `resource`, `dimension`, and `window`.

The enforcement layer exposes two primitives:

- `reserveQuota(subjectId, resource, estimate, now)` reserves capacity before
  an LLM call, tool execution, web fetch, or attachment upload.
- `commitQuota(subjectId, resource, actual, now)` reconciles estimates with
  actual usage and supports refunds/clamping for over-estimates and stock
  resources.

Each plan limit chooses one algorithm:

- `fixed_window` for calendar-aligned caps such as daily or monthly quotas.
- `rolling_refill` for token-bucket pacing where capacity refills gradually
  over the configured window.

Thread-scoped group storage contexts are normalized to their parent group
subject before plan resolution, so all threads in a group spend the same group
quota.

## User and admin surfaces

User-facing surfaces:

- `/plan` and `/quota` short-circuit the LLM orchestrator and cost no quota.
- `get_my_plan` and `get_my_quota` expose structured plan/quota details to the
  model when needed.
- 80% threshold notices are templated, non-LLM messages sent once per bucket.

Admin-facing surfaces:

- Debug dashboard Plans panel for CRUD on plans and limits.
- Billing subject table/detail extensions for assignment and live quota state.
- `DEBUG_TOKEN`-gated admin HTTP routes for plans, subject assignments, and
  audit history.
- DM admin commands for deployments without the debug dashboard.

## Implementation plan reference

Implementation should follow the phase decomposition note rather than this
summary. The phases are intentionally bottom-up: pure helpers and schema first,
then quota engine primitives, then enforcement wiring, user-facing surfaces,
admin APIs, dashboard UI, DM commands, and final cleanup.

See [the phase decomposition note](../notes/llm-rate-limiting-and-plans-phases.md)
for phase dependencies, per-phase test expectations, verification commands, and
exit criteria.

## Testing approach

Use the tests listed in the phase decomposition note as the authoritative test
plan. At a high level, coverage must include:

- subject-id normalization and plan resolution;
- validity checks for resource/dimension/window/algorithm combinations;
- fixed-window and rolling-refill counter math, atomicity, refunds, and GC;
- reserve/commit behavior and denial rollback;
- orchestrator, tool, web-fetch, embedding, deferred-prompt, and attachment
  gates;
- threshold notices;
- admin HTTP route authorization and validation;
- dashboard component behavior.

## References

- Detailed rules and rationale: [../notes/llm-rate-limiting-and-plans.md](../notes/llm-rate-limiting-and-plans.md)
- Work breakdown and sequencing: [../notes/llm-rate-limiting-and-plans-phases.md](../notes/llm-rate-limiting-and-plans-phases.md)

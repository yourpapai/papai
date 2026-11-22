<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-up proposal shortlist

These are the three feature candidates deferred by `design.md`. Each needs its own OpenSpec change; none belongs in this dependency refresh.

## 1. Native AI SDK steering

- **Source version:** `ai` 7.0.154–7.0.177 (`experimental_createSteering`, `steer`, `queue`, `interrupt`), present in the pinned 7.0.179.
- **Papai fit:** replace the custom queue drain in `src/run-control/steering-prepare-step.ts:16` and its composition at `src/llm-orchestrator-invoke.ts:95`. Use `interrupt: true` to cancel before output and `queue()` for after-task delivery. Today the prepare step drains `run.steerQueue` at `src/run-control/steering-prepare-step.ts:18` and re-injects the texts as user turns.
- **Required spec delta:** mid-run-steering requirements for delivery outcomes (before the next step, after the task, interrupted), queue ordering, and provider-capability fallback. Keep the existing "drain exactly once" contract pinned by `tests/run-control/steering-prepare-step.test.ts`.
- **Starting points:** `src/run-control/steering-prepare-step.ts:16`, `src/llm-orchestrator-invoke.ts:95`, `src/run-control/types.ts` (`steerQueue`).

## 2. SDK tool approvals

- **Source version:** `ai` 7.0.x tool approvals (approval replay present in 7.0.179).
- **Papai fit:** could replace the `_permission_reason` ask wrapper at `src/tools/permission-gate.ts:40` and the decision call at `src/tools/permission-gate.ts:139`. `tool_prefs` (`allow`/`ask`/`deny`) stays the source of truth; approvals would replay through the SDK instead of the current structured denial.
- **Required spec delta:** tool-permission requirements for the approval request/response shape, replay across steps, and the interaction with `tool_prefs` resolution and confirmations. The current denial result for `ask` without a user decision must remain.
- **Starting points:** `src/tools/permission-gate.ts:40` (`PERMISSION_REASON_FIELD`), `src/tools/permission-gate.ts:125` (`askPermission`).

## 3. Native tool search

- **Source version:** `ai` 7.0.104/7.0.127 (native tool search).
- **Papai fit:** could replace the heuristic/embedding disclosure at `src/tools/disclosure/search-tools.ts:40` and `src/tools/disclosure/load-tool.ts:13`. Papai's custom embedding retriever has a custom corpus and a fail-safe latch at `src/tools/disclosure/core.ts:28`.
- **Required spec delta:** tool-disclosure requirements for result-ranking parity with the embedding retriever, the open-all fallback after zero `load_tool` activity, and the disclosure `activeTools` intersection. Needs a feature flag and fallback path before it becomes the default.
- **Starting points:** `src/tools/disclosure/search-tools.ts:40`, `src/tools/disclosure/load-tool.ts:13`, `src/tools/disclosure/core.ts:28`.

Ordering: native steering first (clearest user-visible payoff and smallest surface), then tool approvals (touches `tool_prefs`), then native tool search (needs parity proof with the embedding retriever).

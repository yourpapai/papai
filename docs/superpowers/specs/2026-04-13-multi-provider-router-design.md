<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router Design (Overview)

**Date:** 2026-04-13
**Status:** Approved
**Approach:** Multi-Provider Router (Approach B)
**Split into phase specs:** 2026-05-23

## Summary

Refactor papai to support multiple chat provider and task provider instances simultaneously from a single process. Chat and task provider instances are DB-stored and dashboard-managed. A `ChatRouter` wraps multiple `ChatProvider` instances behind the existing interface. A `TaskProviderResolver` resolves the correct task provider per context from DB-stored assignments. The plugin system (already implemented under migration `039_plugins`) stays orthogonal: plugin tables are keyed by `contextId`, plugin tool execution flows through the resolver, and plugin compatibility becomes per-context.

This overview is intentionally short. **All implementation details live in the phase specs below.** Each phase is a self-contained design doc with its own requirements, error handling, and testing strategy. Phases ship independently in the order shown.

## Top-level Requirements

- Single process serves multiple chat platforms and multiple task trackers simultaneously
- Chat and task provider instances are DB-stored, managed via the debug dashboard
- Staged apply: changes saved to DB, applied to the running ChatRouter via an explicit "Apply" action
- Global super-admin + optional per-platform admins
- Per-context task provider selection: DMs pick per-user, groups pick per-group
- Explicit `/setup` required for task provider assignment (no auto-assignment)
- Separate user identities per platform (cross-platform linking deferred)
- Bootstrap from existing env vars on first run; from then on, the DB is the source of truth
- Plugin system stays drop-in compatible — no plugin schema or contract changes

## Phases

| Phase                                                                                       | Scope                                                                          | Depends on |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| [Phase 1 — Instance Data Model & Bootstrap](./2026-04-13-multi-provider-phase-1-instance-data-model.md) | Migration 040, encryption helper, env→DB bootstrap, idempotency                | —          |
| [Phase 2 — TaskProviderResolver & Per-Context Config](./2026-04-13-multi-provider-phase-2-task-provider-resolver.md) | `TaskProviderResolver`, dynamic `getConfigKeysForContext`, `/setup` step       | Phase 1    |
| [Phase 3 — ChatRouter](./2026-04-13-multi-provider-phase-3-chat-router.md)                  | `ChatRouter` wrapping multiple adapters, `platformInstanceId` plumbing         | Phase 1    |
| [Phase 4 — Admin Model & Dashboard](./2026-04-13-multi-provider-phase-4-admin-and-dashboard.md) | `admins` table, super- / platform-admin gating, `/admin#instances`, apply endpoint | Phase 1, 3 |
| [Phase 5 — Plugin System Alignment](./2026-04-13-multi-provider-phase-5-plugin-alignment.md) | Capability eval across instance union, `capability_missing` eligibility, resolver-driven plugin jobs | Phase 1, 2, 3 |

Each phase produces working, testable software on its own. Phases 1–3 are the minimum to actually serve multiple providers; phases 4–5 layer admin surfaces and plugin-aware capability gating on top.

## What stays unchanged

- `user_config` table — credentials remain keyed by storage `contextId`
- Plugin tables — keyed by `contextId`, no schema change
- Conversation history, memos, facts, recurring tasks, deferred prompts
- The `ChatProvider` and `TaskProvider` interfaces themselves — only their wiring changes

## Plan

Implementation tasks for all five phases are in [`docs/superpowers/plans/2026-05-23-multi-provider-router-implementation.md`](../plans/2026-05-23-multi-provider-router-implementation.md), organized into the same phase boundaries listed above.

## Provider-as-plugin

Out of scope for this refactor. The plugin system's optional "Phase 3 — provider migration" is a separate future spec that can layer onto Phase 5 without revisiting any contract here.

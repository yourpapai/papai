<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0129: Multi-Provider Router (Unified Design)

## Status

Implemented

## Date

2026-04-13 – 2026-05-24

## Context

papai was designed around a single chat provider and a single task provider
initialized from environment variables at startup. Adding a second Telegram bot,
a Mattermost instance, or a second task tracker required a separate process and
separate deployment. There was no DB-backed model for provider instances, no
per-instance encrypted config, no way to route inbound messages to the correct
task tracker, and no admin surface for managing instances at runtime.

The original design spec
(`docs/archive/2026-04-13-multi-provider-router-design.md`) defined a
five-phase roadmap to refactor the bot so a single process serves multiple chat
platforms and multiple task trackers simultaneously, with DB-stored instances,
per-context routing, and an admin dashboard. The implementation plan
(`docs/archive/2026-05-23-multi-provider-router-implementation.md`) broke the
work into seven deployable phases. Each phase shipped independently; this ADR
records the unified decision and cross-cutting rationale.

The five phase ADRs (0124–0128) capture per-phase decisions in detail. This
umbrella ADR records the top-level architectural choice and its cross-phase
consequences.

## Decision Drivers

- **Single-process multi-tenancy**: One bot process must serve multiple chat
  platforms and multiple task trackers simultaneously.
- **DB as source of truth**: After first-run bootstrap from env vars, the
  database must be the sole authority for instance configuration; env vars are
  never re-read.
- **Encrypted config at rest**: Provider credentials stored in the DB must not
  be readable without a key; production deployments must set `INSTANCE_CONFIG_KEY`
  explicitly.
- **Per-context routing**: Each user or group context must be independently
  assignable to a task instance; no global provider singleton.
- **No plugin contract change**: The existing plugin system (ADR-0123) must
  remain drop-in compatible; alignment happens through new eligibility reasons,
  not API surface changes.
- **Admin control**: The bot operator must manage instances and admin
  assignments from the dashboard, not by editing the database directly.

## Considered Options

### Option A: One-process-per-provider (status quo)

Run a separate papai process for each chat/task provider combination.

- **Pros**: Zero code changes; complete isolation.
- **Cons**: No shared user DB; no cross-platform identity; multiplied
  operational cost; no path toward per-context task-tracker selection.

### Option B: Multi-provider router with DB-stored instances (chosen)

Store provider instances as encrypted DB rows; route inbound messages via
`ChatRouter`; resolve task providers per context via `TaskProviderResolver`.

- **Pros**: Single process; shared DB; per-context task assignment; admin
  dashboard control; plugin system stays compatible.
- **Cons**: Single process failure affects all instances; encrypted config key
  management adds operational burden; `ChatRouter` adds indirection layer.

### Option C: Microservice mesh with shared DB

Each provider adapter runs as a separate service; a gateway routes messages.

- **Pros**: Independent scaling; isolated failures.
- **Cons**: Significantly higher operational complexity; shared-DB coupling
  negates isolation benefit; far exceeds MVP scope for a single-operator bot.

## Decision

**Option B**, decomposed into five phases:

| Phase | ADR      | Scope                                                                                    |
| ----- | -------- | ---------------------------------------------------------------------------------------- |
| 1     | ADR-0124 | Instance data model (migration 040), AES-256-GCM encryption, env→DB bootstrap            |
| 2     | ADR-0125 | `TaskProviderResolver`, dynamic `getConfigKeysForContext`, `/setup` task-instance step   |
| 3     | ADR-0126 | `ChatRouter` with `platformInstanceId` plumbing, command replay, instance lifecycle      |
| 4     | ADR-0127 | `admins` table, per-platform authorization, `/admin#instances` dashboard, apply endpoint |
| 5     | ADR-0128 | Plugin capability eval across active-instance union, `capability_missing` eligibility    |

Cross-cutting subsidiary decisions:

| Topic                | Decision                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Encryption           | AES-256-GCM with `INSTANCE_CONFIG_KEY` (64 hex chars or scrypt-derived passphrase). Unset → host-local fallback key + startup WARN.                          |
| Bootstrap            | `bootstrapInstancesFromEnv()` seeds from env vars exactly once when instance tables are empty; idempotent; DB is source of truth after.                      |
| Routing contract     | `ChatRouter` wraps multiple `ChatProvider` instances behind the same interface; every `IncomingMessage` is tagged with `platformInstanceId`.                 |
| Task resolution      | `TaskProviderResolver.resolve(contextId)` merges instance config with per-context credentials; returns `null` for unassigned or missing-cred contexts.       |
| Config keys          | `getConfigKeysForContext(contextId)` replaces the static `CONFIG_KEYS` constant; keys vary by assigned task instance type.                                   |
| Authorization        | `admins` table with super-admin (`__super__`) and per-platform-admin scopes; `isAdmin(userId, platformInstanceId)` replaces global `ADMIN_USER_ID`.          |
| Plugin compatibility | `evaluateCompatibilityAcrossInstances()` unions capabilities across all active task instances; per-context `capability_missing` is a new eligibility reason. |
| Dashboard apply      | Staged apply: DB writes are immediate; `POST /api/platform-instances/apply` re-syncs the running `ChatRouter` without restart.                               |

## Consequences

### Positive

- Single process serves any number of chat platforms and task trackers.
- Per-context task-provider assignment means different users or groups can use
  different trackers in the same deployment.
- Encrypted config at rest prevents credential exposure from DB file access
  alone.
- Admin dashboard provides runtime instance CRUD without restarts (via apply).
- Plugin system required no contract changes; alignment is purely additive.
- Bootstrap preserves the zero-config first-run experience for existing
  deployments.

### Negative

- Single-process failure affects all platform instances simultaneously.
- `INSTANCE_CONFIG_KEY` must be managed by the operator; loss of the key renders
  encrypted configs unrecoverable.
- `ChatRouter` indirection adds a thin but real complexity layer for debugging
  message flow.
- Unreadable encrypted rows (wrong key) are skipped at startup with warnings
  rather than aborts, which can silently degrade if the key changes.

### Risks

- The fallback host-local key provides no protection if the DB file is copied
  to another host. Mitigation: production must set `INSTANCE_CONFIG_KEY`
  explicitly; a startup WARN fires when it is unset.
- A misconfigured `ChatRouter` instance that fails to start does not block other
  instances, but repeated apply attempts without fixing the root cause create
  operational noise.
- Plugin compatibility is evaluated across the union of active instances; a
  plugin that requires a capability present on only one task instance is marked
  compatible globally, even though some contexts lack that capability.
  Mitigation: per-context `capability_missing` eligibility gates tool/prompt
  assembly per context.

## Implementation Notes

Key modules introduced across phases:

| File                              | Role                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `src/instances/encryption.ts`     | AES-256-GCM encrypt/decrypt, `maskConfig`, derived-key fallback              |
| `src/instances/platform-store.ts` | CRUD for `platform_instances` with transparent encrypt/decrypt               |
| `src/instances/task-store.ts`     | CRUD for `task_instances`                                                    |
| `src/instances/context-store.ts`  | CRUD for `context_settings` (assign/unassign/list)                           |
| `src/instances/admin-store.ts`    | CRUD for `admins`, `isSuperAdmin`, `isPlatformAdmin`, `isAdmin`              |
| `src/instances/bootstrap.ts`      | First-run env→DB seeding, idempotency                                        |
| `src/providers/resolver.ts`       | `TaskProviderResolver.resolve()` and `resolveStrict()`                       |
| `src/chat/router.ts`              | `ChatRouter` implementing `ChatProvider`, instance lifecycle, command replay |
| `src/types/config-dynamic.ts`     | `getConfigKeysForContext(contextId)`                                         |
| `src/debug/instance-routes.ts`    | HTTP endpoints for instance and admin CRUD                                   |

Database: migration `040_platform_instances` creates `platform_instances`,
`task_instances`, `context_settings`, `admins`; adds `platform_instance_id` to
`users`.

Removed: `src/providers/factory.ts` (`buildProviderForUser`) replaced by
`TaskProviderResolver`.

Integration points: `src/index.ts` (bootstrap + router wiring),
`src/llm-orchestrator.ts` (resolver injection), `src/scheduler.ts` (resolver),
`src/deferred-prompts/poller.ts` (resolver), `src/commands/setup.ts`
(task-instance pick step), `src/commands/set.ts` (per-context key validation),
`src/plugins/compatibility.ts` (instance-union capability eval).

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — original single-provider
  abstraction that this refactor generalizes.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider interface preserved
  by `ChatRouter`.
- ADR-0123: Trusted-Local Plugin System — plugin contract unchanged; Phase 5
  adds only `capability_missing` eligibility.
- ADR-0124: Phase 1 — Instance Data Model & Bootstrap
- ADR-0125: Phase 2 — Task Provider Resolver
- ADR-0126: Phase 3 — Chat Router
- ADR-0127: Phase 4 — Admin Authorization & Dashboard
- ADR-0128: Phase 5 — Plugin Alignment

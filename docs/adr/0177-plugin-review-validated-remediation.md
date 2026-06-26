<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0177: Plugin Review Validated Remediation

## Status

Implemented

## Date

2026-05-30

## Context

The trusted-local plugin system (ADR-0123) shipped with several invariants that the runtime did not actually honor. A validated review against the 2026-05-30 branch confirmed eight required-fix findings and a bounded set of opportunistic cleanup, all within the existing plugin-system shape: lifecycle state was recorded twice and iterated twice on deactivation; the identity facade let a plugin write mappings for an arbitrary chat user rather than the current runtime actor; scheduled jobs resolved a task provider and then discarded it because the job API exposed only `contextId`; core modules imported Kaneo plugin provisioning internals directly, inverting the core-to-plugin dependency direction; the `commands`, `scheduler`, and `chat.send` permissions were declared without matching enforcement; plugin registry runtime transitions (`active`, `error`, deactivation-to-`approved`) were not persisted; discovery path verification failed open on non-sentinel `realpathSync()` errors; and approval hashing ignored behavior-changing local plugin-owned source files outside the entry file.

The 2026-05-30 design (`docs/superpowers/specs/2026-05-30-plugin-review-validated-remediation-design.md`) is the source of truth for the architecture described here. The core trust rule is unchanged: plugins remain trusted, repository-local, in-process code. This pass does not introduce sandboxing; it makes the framework-owned lifecycle, permission, and operator surfaces internally consistent with that trust model.

## Decision Drivers

- **Lifecycle correctness**: activation order must be a single-writer record; deactivation must visit each plugin once.
- **Actor-bound writes**: a plugin tool must not be able to record identity claims for a chat user other than the one whose turn is running.
- **Honest runtime context**: scheduled jobs must receive a real request-like runtime context, or the framework must stop resolving a provider it never exposes.
- **No core-to-plugin coupling**: provisioning must flow through a provider-descriptor hook, not direct imports of `plugins/task-provider-kaneo/` from core.
- **Enforced permissions**: declared manifest permissions must map to real framework enforcement or be removed from the contract.
- **Fail-closed verification**: when path containment or approval coverage cannot be proven, discovery must reject the plugin rather than fall back.

## Considered Options

### Option A: Tighten existing invariants in place (chosen)

Keep the loader, registry, discovery, runtime facades, and provider registry as the framework-owned boundaries; remove inconsistent edge cases rather than redesigning the plugin host.

- **Pros:** Minimal blast radius; preserves the proven activation/eligibility model; no migration risk for existing plugin manifests beyond the strict import policy; the work is testable per invariant.
- **Cons:** Strict bare-module import rejection in plugin entry graphs requires migrating built-in plugin source graphs to relative-only imports, which is a mechanical but wide change.

### Option B: Introduce a broader plugin API redesign

Revisit the plugin runtime facade, contribution lifecycle, and provider registration as a single redesigned surface.

- **Pros:** Could address latent friction beyond the validated findings in one pass.
- **Cons:** Out of scope for a remediation pass; high regression risk; widens the review surface past what the validated findings require; delays the correctness and security fixes that are independently urgent.

### Option C: Add sandboxing / stronger isolation

Use VM isolation or a separate process boundary so the fail-closed path and permission enforcement become defense-in-depth rather than the primary contract.

- **Pros:** Stronger guarantees for untrusted code.
- **Cons:** Plugins are explicitly trusted, repository-local, in-process code today; sandboxing is a separate, larger decision (tracked as a follow-up) that must not gate the validated correctness fixes.

## Decision

Ten coordinated tasks implement the remediation, sequenced lifecycle-first to minimize drift between runtime behavior and the operator/developer surfaces that describe it.

### 1. Loader lifecycle correctness (`src/plugins/loader.ts`)

`activationOrder` becomes a single-writer lifecycle record. The duplicate bulk append at the end of `activatePlugins(...)` is removed; the per-plugin push inside `finalizeSuccessfulActivation(...)` is kept. The redundant `pLimit(1)` wrapper around already-sequential activation is deleted and replaced with a straight `for...of` loop, so `getActivatedPluginIds()` returns each ID once and `deactivateAllPlugins()` visits each plugin once in reverse order.

### 2. Actor-bound identity claims (`src/plugins/identity-facade.ts`, `src/plugins/tool-runtime.ts`, `src/plugins/runtime-types.ts`)

The public `PluginIdentityFacade.recordClaim(...)` signature drops the caller-supplied `chatUserId` parameter and becomes `recordClaim(providerUserId, providerLogin, displayName?)`. `buildIdentityFacade(providerName, chatUserId, deps)` captures `chatUserId` in the closure and writes it as `contextId` on `setIdentityMapping(...)`, so a plugin tool cannot write identity mappings for another chat user through the facade. The broader read-only `lookupForChatUser(...)` API is retained.

### 3. Scheduled-job runtime context (`src/plugins/runtime-types.ts`, `src/plugins/contributions.ts`, `src/plugins/tool-runtime.ts`)

A new `PluginScheduledJobRuntimeContext` type (`{ pluginId, contextId } & Partial<{ taskProvider: PluginTaskProviderFacade }>`) replaces the bare `contextId` argument. `PluginScheduledJob.execute` now receives this runtime context. The dispatch in `contributions.ts` resolves the provider **only** when the manifest declares `tasks.read` or `tasks.write`; otherwise no provider is resolved and `taskProvider` is absent from the context. The shared provider-facade builder is extracted in `tool-runtime.ts` so both tool and job runtime reuse it.

### 4. Enforced `commands`/`scheduler` permissions; `chat.send` removed (`src/plugins/types.ts`, `src/plugins/registration-support.ts`, `src/plugins/manifest-validation.ts`)

`pluginManifestSchema` gains refinements rejecting `contributes.commands` without the `commands` permission and `contributes.jobs` without the `scheduler` permission. `registration-support.ts` throws explicit errors at registration time (`"Plugin <id> cannot register commands without 'commands'"`). `'chat.send'` is removed from `PLUGIN_PERMISSIONS` because no safe chat-send facade exists yet; adding one would widen scope beyond this remediation. Dead `'config_missing'` is removed from `PluginState`.

### 5. Persisted runtime registry state (`src/plugins/registry.ts`, `src/plugins/types.ts`)

`markActive(...)` persists `state: 'active'` (with `compatibilityReason: null`) to `plugin_admin_state`; `markError(...)` persists `state: 'error'` with the failure reason; `markDeactivated(...)` persists `state: 'approved'` when transitioning from `active`. `'config_missing'` is removed from `VALID_PLUGIN_STATES`. Startup still derives the activation candidate set from persisted admin approval state, but operator surfaces no longer hide runtime failures during the active process.

### 6. Fail-closed discovery and approval coverage (`src/plugins/discovery.ts`, `src/plugins/discovery-imports.ts`)

`realpathSync()` failures (e.g. `ELOOP`, `EACCES`) now reject the plugin instead of falling back to unresolved paths; the `resolveEntryImport`/`resolveEntryPoint` paths re-throw explicit verification errors. `readPluginSourceGraph` rejects any import specifier not starting with `./` or `../` with `"Bare-module imports are not allowed in plugin entry graphs"`. Plugin-local relative `import.meta.require('./...')` targets are included in the walked source graph so they participate in `manifestHash`. Built-in plugin entry graphs (`task-provider-kaneo`, `task-provider-youtrack`, `synthetic-web-search`) were migrated to strict relative-only imports.

### 7. Generic provider auto-provision hook (`src/providers/registry.ts`, `src/providers/auto-provision.ts`, `src/plugins/context.ts`, `src/commands/start.ts`, `src/commands/setup.ts`, `src/llm-orchestrator.ts`, `src/llm-orchestrator-types.ts`, `plugins/task-provider-kaneo/index.ts`, `plugins/task-provider-kaneo/provision.ts`)

`TaskProviderTypeDescriptor` gains an optional `autoProvision?: (context: TaskProviderAutoProvisionContext) => Promise<void>` hook, carried through `registerContributedTaskProviderType(...)` and `registerTaskProviderType(...)`. A new framework-owned helper `maybeAutoProvisionProvider(reply, contextId, chatUserId, username)` in `src/providers/auto-provision.ts` resolves the active task instance's descriptor and invokes its hook. Core `/start`, `/setup`, and orchestrator flows call this generic entrypoint instead of importing Kaneo provisioning directly. Kaneo registers its `maybeProvisionKaneo` as the hook implementation through the object form of `registerTaskProviderType`.

### 8. Honest operator surfaces and cleanup (`src/commands/config.ts`, `src/debug/admin-system.ts`, `src/plugins/registry-context-eligibility.ts`, `src/plugins/store.ts`, `src/mcp/plugin-pool-adapter.ts`, `src/tools/index.ts`, `src/chat/tool-toggle-live-tools.ts`, `src/plugins/contributions.ts`)

`/config` distinguishes `disabled`, `inactive`, and `error` instead of collapsing them. Admin system reporting derives the task provider from active instances/descriptors via `singleKnownProvider(...)`, removing the hardcoded `['kaneo', 'youtrack']` allowlist. Context eligibility uses the already-fetched `contextState.enabled` instead of a duplicate query. `kvList(...)` escapes `%` and `_` so prefix filtering is literal. The duplicated MCP pool adapter is extracted to `src/mcp/plugin-pool-adapter.ts`. Collision-event suppression state is scoped/resettable so it does not leak across reactivation and tests.

### 9. Doc and contract corrections (`docs/plugins/developer-guide.md`, `CLAUDE.md`)

The developer guide and repo-level guidance now describe plugins as trusted in-process code with framework-owned API restrictions (not sandbox guarantees), document `recordClaim(...)` without a caller-supplied chat-user target, describe jobs as `execute(runtime)`, list `commands`/`scheduler` as enforced permissions, remove `chat.send`, and document approval coverage including bare-module import rejection.

## Consequences

### Positive

- Activation order and deactivation iteration are each single-pass; no plugin is activated or deactivated twice.
- A plugin tool cannot record identity claims for a chat user other than the current runtime actor.
- Scheduled jobs with task permissions receive a real provider facade; jobs without those permissions no longer resolve a provider they cannot use.
- Core no longer imports Kaneo plugin provisioning internals; provisioning is polymorphic through the provider descriptor, so a new provider type needs no core change to support auto-provision.
- `commands` and `scheduler` are enforced at both manifest validation and registration time; `chat.send` is gone from the contract.
- Operator surfaces (`/config`, admin system) report `active`, `error`, `inactive`, and `disabled` distinctly, and admin provider reporting is descriptor-driven rather than hardcoded.
- Discovery fails closed when path containment or approval coverage cannot be proven, making the containment check meaningful instead of advisory.
- Approval hashing covers local plugin-owned source reachable through static imports and relative `import.meta.require`, so changing a local helper changes `manifestHash`.
- KV prefix listing treats `%` and `_` literally; collision suppression no longer leaks across reactivation.

### Negative

- **Strict bare-module import rejection required migrating built-in plugin entry graphs.** `task-provider-kaneo`, `task-provider-youtrack`, and `synthetic-web-search` source reachable from discovered entry points was rewritten to relative-only imports, including replacing `papai/plugin-types` and direct bare `zod` imports behind relative-only plugin-owned modules. This is a mechanical but wide change that touched every built-in plugin.
- **Manifest/entry-source changes clear plugin approval by design.** Any plugin whose entry graph changed in the strict migration requires re-approval after deploy, since the approval hash covers manifest + entry source.
- **Persisted runtime state is process-local operational truth, not durable multi-process truth.** This pass does not invent leader-election or lease semantics; in a multi-process deployment the persisted `active`/`error` rows reflect one process's view. Documented as such.
- **`autoProvision` return type divergence.** The design's pseudocode showed `Promise<void>`, but the shipped `maybeAutoProvisionProvider` returns `Promise<boolean>` (and the descriptor hook is awaited for its boolean result). Callers that treated the return as void are unaffected; the boolean lets the orchestrator distinguish "provisioned" from "no-op" without re-querying.

### Risks

- **Approval-coverage hardening could break external plugin packages** that rely on bare-module imports in their entry graph. Mitigation: the rejection is limited to plugin entry-graph imports, documented clearly, and the built-in plugins serve as the reference layout.
- **Provisioning abstraction could widen scope** if future providers expect richer lifecycle hooks. Mitigation: the contract is narrowly scoped to the existing auto-provision use case; no generic plugin lifecycle hook framework was introduced.
- **Job runtime context could invite plugins to assume more capabilities than the partial type exposes.** Mitigation: `taskProvider` is `Partial` and present only when the manifest has task permissions; the type enforces absence rather than a null placeholder.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin activation model and contribution lifecycle this pass tightens.
- ADR-0156: Plugin Review Remediation — the prior remediation pass whose findings this work validates and completes.
- ADR-0158: Plugin System Remediation — adjacent plugin-system remediation context.
- ADR-0151: Multi-Provider Catalog Refactor — the provider registry into which `autoProvision` is threaded.

## Implementation Notes

Key files confirmed present on the branch:

- `src/plugins/loader.ts` — sequential `activatePlugins`, no `pLimit(1)`, single `activationOrder.push`.
- `src/plugins/registry.ts:181` `markActive`, `:190` `markError`, `:200` `markDeactivated` — persist to `plugin_admin_state`.
- `src/plugins/identity-facade.ts:15` — `recordClaim(providerUserId, providerLogin, displayName?)`; `:30-32` `buildIdentityFacade(providerName, chatUserId, deps)` captures `chatUserId` in closure (`:51` `contextId: chatUserId`).
- `src/plugins/discovery.ts:17-18,65-66` — `discoveryPathOps.realpathSync` used for containment; `src/plugins/discovery-imports.ts:192,207` — bare-module import rejection messages.
- `src/providers/auto-provision.ts:11-31` — `maybeAutoProvisionProvider` resolves descriptor and invokes `autoProvision` (returns `Promise<boolean>`).
- `src/plugins/runtime-types.ts` — `PluginScheduledJobRuntimeContext`; `src/plugins/contributions.ts` — provider resolved only when manifest has task permissions.
- `src/plugins/types.ts` — `chat.send` removed, `config_missing` removed from `PluginState`, manifest refinements for `commands`/`scheduler`.
- `src/plugins/store.ts` — `kvList` escapes `%`/`_`.
- `src/mcp/plugin-pool-adapter.ts` — shared adapter; used by `src/tools/index.ts` and `src/chat/tool-toggle-live-tools.ts`.
- `src/debug/admin-system.ts` — descriptor-driven `singleKnownProvider(...)`.
- `src/commands/config.ts` — distinct `disabled`/`inactive`/`error` rendering.

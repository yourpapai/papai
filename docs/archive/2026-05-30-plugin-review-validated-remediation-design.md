<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Review Validated Remediation Design

**Date:** 2026-05-30
**Status:** Proposed
**Related:** [`2026-05-23-task-provider-as-plugin-design.md`](./2026-05-23-task-provider-as-plugin-design.md), [`2026-05-29-task-provider-plugin-followups.md`](./2026-05-29-task-provider-plugin-followups.md), [`2026-05-29-plugin-review-remediation-design.md`](./2026-05-29-plugin-review-remediation-design.md)

## Summary

This design is a focused remediation pass for the plugin-system findings validated against the current branch on 2026-05-30. It covers the confirmed correctness, security-hardening, operator-surface, and narrow architectural-leak issues from the validated review, plus a bounded set of low-risk cleanup in the same touched areas.

The implementation remains a single batch, but the design is organized into three priority tiers:

1. required fixes
2. opportunistic cleanup
3. doc and contract corrections

The core rule is unchanged: plugins remain trusted, repository-local, in-process code. This pass does not introduce sandboxing. Instead, it makes the framework-owned lifecycle, permission, and operator surfaces internally consistent with that trust model.

## Goals

- Fix the confirmed plugin lifecycle bug that duplicates activation order and deactivation iteration.
- Bind plugin identity writes to the current runtime actor rather than an arbitrary target user ID.
- Give scheduled jobs a real request-like runtime context or stop pretending they have provider access.
- Remove direct core imports of a specific provider plugin's provisioning internals.
- Make declared plugin permissions either enforce real framework behavior or disappear from the manifest contract.
- Persist operator-relevant runtime plugin state transitions honestly enough for admin and config surfaces.
- Make plugin discovery fail closed when filesystem path verification cannot prove safety.
- Make plugin approval cover behavior-changing plugin-owned source files.
- Correct user-facing and developer-facing docs that overstate plugin isolation or no longer match runtime behavior.
- Land a small set of related low-risk cleanup in the same touched areas.

## Non-Goals

- Changing the trusted local plugin model.
- Adding VM isolation, sandboxing, code signing, or external plugin distribution.
- A broad plugin API redesign unrelated to the validated findings.
- Reworking plugin prompt fragments, MCP semantics, or provider capabilities beyond what the validated findings require.
- Broad opportunistic refactoring outside plugin lifecycle, permissions, provisioning, operator surfaces, and directly adjacent helpers.

## Validated Scope

### Required fixes

- `activationOrder` is pushed twice, causing duplicate activated IDs and duplicate deactivation iteration.
- `identity.recordClaim(...)` allows an arbitrary `chatUserId` target instead of binding writes to the current runtime actor.
- scheduled jobs resolve a task provider and then discard it because the job API exposes only `contextId`.
- core modules import Kaneo plugin provisioning internals directly.
- `commands`, `scheduler`, and `chat.send` are declared plugin permissions without matching enforcement.
- plugin registry runtime transitions (`active`, `error`, deactivated back to `approved`) are not persisted.
- discovery path verification fails open when `realpathSync()` throws non-sentinel errors.
- approval hashing ignores behavior-changing local plugin source files outside the entry file.

### Opportunistic cleanup

- dead registry state value `config_missing` is removed.
- `/config` distinguishes `disabled`, `inactive`, and `error` instead of collapsing them to `disabled`.
- admin system provider reporting stops using a hardcoded task-provider allowlist.
- plugin context eligibility avoids the duplicate context-state query.
- duplicated MCP pool adapter helper code is extracted to one shared helper.
- tool-collision suppression state is resettable or scoped so it does not leak across reactivation and tests.
- redundant `pLimit(1)` wrapping over already-sequential lifecycle work is removed.
- plugin KV prefix listing escapes `%` and `_` so prefix filtering behaves literally.

### Doc and contract corrections

- plugin docs explicitly describe plugin restrictions as framework API-surface restrictions, not sandbox guarantees.
- plugin docs describe plugins as trusted in-process code that can access ambient Node/Bun capabilities unless the project introduces sandboxing later.
- manifest and developer-guide language are updated to match the enforced permission model after this remediation.

## Design Overview

The plugin system keeps its current shape:

- discovery scans `plugins/<plugin-id>/`
- approval is manifest-hash gated
- activation is isolated per plugin
- tools, commands, jobs, and providers are registered through framework-owned registries
- per-context eligibility decides whether an active plugin is usable in a given context

This pass tightens the invariants around those existing boundaries instead of replacing them.

### Design principles

- one framework-owned source of truth for plugin lifecycle state
- one explicit runtime context per executable plugin surface
- one manifest contract per declared capability
- one honest operator story for admin and `/config` surfaces
- fail closed when path validation or approval coverage cannot be proven

## Tier 1: Required Fixes

### 1. Loader lifecycle correctness

`activationOrder` becomes a single-writer lifecycle record.

Requirements:

- successful activation appends a plugin ID exactly once
- `getActivatedPluginIds()` returns each active plugin ID once in activation order
- `deactivateAllPlugins()` visits each activated plugin once in reverse activation order
- no bulk post-processing step may append the same activated IDs again

This is a direct correctness fix. It does not otherwise redesign activation or deactivation.

### 2. Actor-bound identity claims

Plugin identity writes must be scoped to the current runtime actor.

Requirements:

- the tool runtime identity facade exposes `recordClaim(providerUserId, providerLogin, displayName?)`
- the framework supplies the current `chatUserId` internally
- plugins cannot write identity mappings for another chat user through the facade
- read-only lookup APIs may remain broader if they are still needed for plugin behavior

This keeps the trusted-plugin model intact while removing an unnecessary cross-user write capability from the framework facade.

### 3. Scheduled job runtime context

Scheduled jobs receive a real runtime context instead of only `contextId`.

Requirements:

- `PluginScheduledJob.execute(...)` receives a job runtime context
- the job runtime context includes `pluginId` and `contextId`
- when the plugin has `tasks.read` or `tasks.write`, the job runtime receives the same permission-gated task-provider facade style used by tools
- when the plugin lacks those permissions, no provider is exposed and no provider resolution happens
- job execution remains per eligible context and continues to isolate failures per context

This removes the current contradictory behavior where a provider is resolved but cannot be used.

### 4. Provider provisioning abstraction

Core code must stop importing provider-plugin internals directly.

Requirements:

- provider provisioning becomes an optional capability on the task-provider descriptor
- core startup, setup, and orchestrator flows call one generic provisioning entrypoint
- Kaneo provisioning is supplied through the provider/plugin registration path, not direct imports from `plugins/task-provider-kaneo/...`
- non-provisioning providers remain no-op through the same generic path

This preserves polymorphism and removes the core-to-plugin dependency direction introduced by the migration.

### 5. Permission model enforcement

Manifest-declared plugin permissions must map to real framework enforcement.

Requirements:

- command registration requires the `commands` permission
- scheduled-job registration requires the `scheduler` permission
- manifest validation fails when commands are declared without `commands`
- manifest validation fails when jobs are declared without `scheduler`
- `chat.send` is removed from the manifest permission vocabulary in this pass because no safe chat-send facade exists yet

`chat.send` is removed rather than implemented because adding a new outbound chat facade would widen scope beyond this remediation.

### 6. Honest persisted runtime state

Operator-visible plugin runtime transitions are persisted.

Requirements:

- activation success persists `active`
- activation failure persists `error` with the failure reason
- deactivation returns persisted state to `approved` when appropriate
- startup normalization still derives an activation candidate set from persisted admin approval state, but operator surfaces must not hide runtime failures during the active process

This design does not attempt to create a complex multi-process lease model. It only makes the current single-process operator story honest.

### 7. Fail-closed discovery path verification

Filesystem verification must fail closed.

Requirements:

- if `realpathSync()` cannot prove that an entry point or imported file stays inside the plugin directory, discovery rejects that plugin
- discovery no longer falls back to unresolved paths on non-sentinel filesystem errors such as `ELOOP`, `EACCES`, or transient disappearance
- discovery errors remain isolated per plugin and produce explicit reasons

This keeps the path-containment check meaningful instead of advisory.

### 8. Approval hash coverage

Approval must cover behavior-changing plugin-owned source.

Requirements:

- approval hashing includes `plugin.json`
- for non-MCP-only plugins, approval hashing includes the entry file and all deterministically discoverable plugin-owned local source files reachable through static local imports
- if the discovery walk cannot build a deterministic local plugin-owned source graph, discovery fails for that plugin rather than hashing an incomplete subset
- bare-module imports from plugin entry graphs are rejected in this pass

The explicit bare-module import rejection is the chosen contract decision for this remediation. It preserves a simple rule: approval covers the effective plugin-owned behavior surface.

## Tier 2: Opportunistic Cleanup

These items land only as direct follow-through in the same touched areas.

### 1. Remove dead registry state

- remove `config_missing` from persisted/runtime registry state vocabulary
- keep `config_missing` only as a per-context eligibility reason where it is actually used

### 2. Improve `/config` truthfulness

- render `disabled`, `inactive`, and `error` distinctly
- preserve `config_missing` and `capability_missing` as context-specific unavailability reasons

### 3. Descriptor-driven admin provider reporting

- replace the hardcoded `['kaneo', 'youtrack']` task-provider list in admin system reporting
- derive known provider types from descriptors or active instances so new providers do not report as `unknown` solely because they were not hardcoded

### 4. Remove duplicate eligibility query

- compute plugin context enabled state from the already-fetched row instead of querying the same row twice

### 5. Extract shared MCP helper

- move the duplicated MCP pool adapter helper into one shared module used by both tool assembly and live tool-toggle code
- preserve behavior exactly

### 6. Scope collision-event suppression

- move collision-event suppression state behind a resettable contribution-registry-owned store
- ensure tests and reactivation do not inherit stale suppression state from a prior runtime phase

### 7. Remove redundant lifecycle concurrency wrapper

- delete `pLimit(1)` around already-sequential lifecycle execution, or move to a real concurrency setting if concurrent lifecycle execution is later needed

### 8. Escape KV prefix wildcards

- treat `%` and `_` literally when applying prefix filtering in plugin KV list operations

## Tier 3: Doc And Contract Corrections

### 1. Trust-model wording

The docs must stop implying sandbox properties that do not exist.

Requirements:

- docs describe plugins as trusted in-process code
- docs distinguish between framework-owned API restrictions and process-level capabilities
- docs do not claim plugins can never access environment or process facilities unless the project introduces sandboxing later

### 2. Permission contract wording

The docs must match the post-remediation manifest contract.

Requirements:

- `commands` and `scheduler` are documented as enforced permissions
- `chat.send` is removed from permission lists and examples for now
- command and job registration examples show the required permission declarations

### 3. Approval coverage wording

The docs must match the approved import policy.

Requirements:

- local plugin-owned imports are described as part of approval coverage
- bare-module imports from plugin entry graphs are described as unsupported in this pass
- discovery failure behavior is described as fail closed when approval coverage cannot be proven

## Architecture And Data Flow

### Loader and discovery

The existing loader remains the lifecycle owner.

- discovery returns only validated plugins whose path containment and approval coverage can be proven
- activation publishes success once and records it once
- deactivation consumes the same activation-order record once

### Runtime capability boundaries

The plugin system continues to use frozen framework-owned facades.

- tool runtime gets actor-bound identity writes
- job runtime gets a request-like execution context instead of raw `contextId` only
- permission gating remains framework-owned, not plugin-owned

### Provider provisioning

Provisioning becomes a provider-registry concern.

- core asks the active provider whether provisioning exists
- the provider implementation decides what provisioning does
- provider-specific provisioning code stays behind the provider/plugin boundary

### Operator truthfulness

Admin and config surfaces derive from persisted runtime state plus per-context eligibility.

- global runtime state answers whether the plugin is approved, active, or errored
- per-context eligibility answers whether an active plugin is usable here
- `/config` and admin surfaces stop collapsing those distinct states together

## Error Handling

- discovery failures remain isolated per plugin and return explicit reasons
- activation failures remain isolated per plugin and persist the actual failure reason
- provisioning failures behave as provider-local failures and do not break generic control flow
- job runtime construction fails closed per context and logs `pluginId`, `jobName`, and `contextId`
- permission violations fail early and explicitly at registration time or facade-use time as appropriate

This design does not change the current best-effort deactivation semantics beyond the single-iteration correctness fix.

## Testing Strategy

### Loader tests

- activation success records exactly one activation-order entry
- `getActivatedPluginIds()` returns unique activated IDs in order
- deactivation invokes each plugin once in reverse activation order

### Identity tests

- plugin tools cannot record identity claims for another user
- current-user identity claim writes still work

### Job runtime tests

- jobs with task permissions receive a permission-gated provider facade
- jobs without task permissions do not resolve a provider
- eligibility and per-context execution behavior remain intact

### Provisioning tests

- core modules no longer import Kaneo plugin provisioning internals directly
- generic provisioning dispatch works for Kaneo
- providers without provisioning remain harmless no-op cases

### Permission tests

- manifest validation rejects commands without `commands`
- manifest validation rejects jobs without `scheduler`
- command and job registration paths enforce those permissions
- `chat.send` is removed from schema and documentation expectations

### Registry and operator-surface tests

- runtime state persistence updates DB-backed operator views
- `/config` distinguishes `disabled`, `inactive`, and `error`
- admin system provider reporting is descriptor-driven rather than hardcoded

### Discovery and hashing tests

- `realpathSync()` failures reject the plugin
- bare-module import policy is enforced
- approval hash changes when local imported source files change

### Cleanup tests

- KV prefix matching escapes wildcard characters correctly
- collision-event suppression state resets or scopes correctly
- shared MCP helper extraction is covered by existing tool and live-tool tests unless a direct unit test is needed

## Sequencing

Although implementation is one batch, execution order should be:

1. lifecycle and discovery correctness
2. runtime boundary fixes for identity and jobs
3. provisioning abstraction
4. permission enforcement and manifest updates
5. persisted operator state and UI truthfulness
6. opportunistic cleanup in touched files
7. doc and contract corrections

This order minimizes drift between runtime behavior and the operator/developer surfaces that describe it.

## Risks And Mitigations

### Risk: provisioning abstraction widens scope

Mitigation:

- keep the new contract narrowly scoped to the already-existing provisioning use case
- avoid introducing a generic plugin lifecycle hook framework in this pass

### Risk: approval-coverage hardening breaks existing plugin packages

Mitigation:

- document the bare-module import rejection clearly
- keep the rejection limited to plugin entry-graph imports, not the whole repo
- add focused tests for approved plugin layouts in this repository

### Risk: persisted runtime state is misread as durable multi-process truth

Mitigation:

- document the persisted runtime state as process-local operational truth for the current runtime model
- avoid inventing leader-election or lease semantics in this pass

## Out Of Scope Follow-Ups

- deactivation timeout enforcement
- broader plugin command/job API redesign unrelated to the confirmed findings
- sandboxing or stronger plugin execution isolation
- more ambitious lifecycle concurrency changes
- deeper operator UX redesign beyond truthful status reporting

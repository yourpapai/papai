<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin — Follow-Up Design

**Status:** Proposed (not scheduled)
**Origin:** Discovered during execution of `docs/superpowers/plans/2026-05-28-task-provider-plugin-phases-3-to-5.md` (see that plan's Drift Log). None of these are blocking; the migration is correct and green without them. This document captures the design for the deferred work so it is not lost.

## Summary

Migrating Kaneo (and YouTrack) from `src/providers/` into `plugins/` exposed three pieces of **pre-existing or newly-surfaced coupling** that the migration plan deliberately left out of scope, plus one process item. Each is recorded below with a proposed approach, scope, and non-goals so it can be picked up as an independent change.

## Goals

- Remove the **core→plugin** dependency direction introduced/relocated by the provider migration.
- Make per-context "is the provider configured?" checks work for **plugin-contributed** providers, not just built-ins.
- Harden credential masking so it does not depend on a hardcoded key list.
- Ensure the plugin-approval path is covered by CI E2E.

## Non-Goals

- Re-litigating the namespaced-keys vs. storageKey-aliasing decision (settled; see the plan's decision 6).
- A general plugin "lifecycle hooks" framework beyond what these items need.
- Dropping the `users.kaneo_workspace_id` column (already tracked as a separate follow-on migration by the main plan).

---

## Follow-up 1 — Extract provider provisioning out of core (core→plugin coupling)

### Problem

`maybeProvisionKaneo` / `provisionAndConfigure` live in `plugins/task-provider-kaneo/provision.ts` (moved there in Phase 3, Task 3.3). Core modules still call them directly:

- `src/commands/start.ts` → `maybeProvisionKaneo(reply, userId, username)`
- `src/llm-orchestrator.ts` → `maybeProvisionKaneo(...)` (via its deps object)
- `src/commands/setup.ts` → `provisionAndConfigure(...)` + Kaneo-specific helpers (`isKaneoAutoProvisionEnabled`, `getKaneoProvisionConfig`, `maybeProvisionKaneoGroup`, `replyForProvisionOutcome`)

This makes **core import plugin code** — backwards for the plugin model. It is functional today (`maybeProvisionKaneo` is internally gated: no-op unless the context's task instance is active and `type === 'kaneo'`) and the coupling pre-existed the migration (core previously imported `src/providers/kaneo/provision.ts`). But it means Kaneo-specific provisioning logic is wired into generic core flows and a provider plugin's internals are reachable from core.

### Proposed approach

Introduce a **provisioning capability on the contributed task-provider descriptor** so core invokes it polymorphically:

1. Extend `ContributedTaskProviderEntry` (and the `registerTaskProviderType` descriptor) with an optional
   `autoProvision?(ctx: ProviderProvisionContext): Promise<ProvisionOutcome>` where `ProviderProvisionContext`
   carries `{ storageContextId, chatUserId, username, taskInstanceConfig, reply? }` and a permission-gated
   config writer (the plugin writes its own namespaced keys via the provided facade — not core `setConfig`).
2. Core's `start`/`orchestrator`/`setup` flows call a single generic
   `maybeAutoProvision(contextId, ...)` in core that resolves the context's descriptor and delegates to
   `descriptor.autoProvision` if present (no-op otherwise). Core no longer imports any plugin module.
3. Move the Kaneo-specific `isKaneoAutoProvisionEnabled` / outcome-to-reply formatting into the plugin
   (the plugin returns a structured `ProvisionOutcome`; core renders a generic success/failure reply, or the
   plugin supplies the message text).

### Scope

- `src/providers/registry.ts` (descriptor type), `src/plugins/context.ts` (`registerTaskProviderType` accepts `autoProvision`), a new core `maybeAutoProvision` helper, edits to `start.ts`/`llm-orchestrator.ts`/`setup.ts` to drop plugin imports, and `plugins/task-provider-kaneo/index.ts` to register `autoProvision`. Mirror for YouTrack only if it gains provisioning (it currently has none).
- Tests: provisioning still triggers for kaneo contexts; core has no static import of `plugins/**`.

### Risk

Medium — touches the setup/start hot paths. Guard with the existing provisioning tests; assert via a grep gate that `src/**` does not import `plugins/**`.

---

## Follow-up 2 — Generalize `checkRequiredProviderConfig` for contributed providers

### Problem

`src/llm-orchestrator-config.ts:checkRequiredProviderConfig` filters `getConfigKeysForContext(contextId)` for the **literal flat keys** `'kaneo_apikey' | 'youtrack_token'`. After Phase 3, kaneo's context keys are namespaced (`plugin:task-provider-kaneo:provider:credential`), so the filter no longer matches and the pre-check is a **no-op for kaneo** (it still works for the still-built-in youtrack until Phase 4 migrates it too — after which it is a no-op for both).

This is **not a functional hole**: the resolver (`buildConfigFromDescriptor`) already returns `null` when a required context field is missing, yielding the "needs /setup" path. It is a degraded _pre-check_ (and a pre-existing limitation that never applied to contributed providers).

### Proposed approach

Replace the hardcoded key filter with a descriptor-driven check:

```text
const descriptor = getTaskProviderDescriptorForContext(contextId)  // via task instance type
const required = descriptor.contextConfigSchema.filter((f) => f.required)
const missing = required.filter((f) => getConfigValue(contextId, storageKeyForField(descriptor, f)) === null)
```

Reuse the resolver's `storageKeyForField` (extract it to a shared module so resolver + this check + the wizard all derive storage keys identically). Returns the human-facing field labels (or keys) that are missing.

### Scope

- Extract `storageKeyForField` to a shared helper (currently duplicated in `resolver.ts` and `wizard/steps.ts`).
- Rewrite `checkRequiredProviderConfig` to be descriptor-driven; drop the `'kaneo_apikey' | 'youtrack_token'` literals.
- Tests for missing/present context config across built-in and contributed providers.

### Risk

Low. Behavior converges with the resolver's own gating.

---

## Follow-up 3 — Descriptor-driven sensitive-value masking (minor)

### Problem

`src/config.ts:SENSITIVE_KEYS` is a hardcoded set (`{ kaneo_apikey, youtrack_token }`) used by `maskValue(key, value)` / `isSensitiveKey(key)` as a **raw-key masking fallback**. It does not include the namespaced credential keys. Verified **no leak today**: every credential-display path (`config-editor`, `wizard`, `commands/config`) masks via the descriptor field's `sensitive` flag (`field.sensitive ? maskSensitiveValue : maskValue`), and the kaneo credential field has `sensitive: true`. `SENSITIVE_KEYS` is only the fallback for contexts without a field, and no credential path uses it standalone.

### Proposed approach

Make raw-key masking descriptor-aware: when masking a `user_config` key with no field in hand, consult the contributed/built-in descriptors' context fields and mask if the matching field is `sensitive`. Keep `SENSITIVE_KEYS` for non-provider sensitive keys (e.g. future additions) but stop relying on it for provider credentials.

### Scope

- `src/config.ts` masking helpers; small. Defense-in-depth only.

### Risk

Very low.

---

## Follow-up 4 — CI coverage for the plugin-approval E2E path (process)

### Problem

Phase 3 Task 3.12 wired `tests/e2e/bun-test-setup.ts` to discover → approve → activate `task-provider-kaneo` before the bot starts (mirroring production startup). The Docker-backed `bun test:e2e` could not run in the implementation sandbox (`KANEO_CLIENT_URL` unset), so the approval path is **not yet verified end-to-end**.

### Proposed approach

Ensure CI sets the Kaneo Docker env (`KANEO_CLIENT_URL`, internal URL) and runs `bun test:e2e` on the migration branch (and on `master` after merge). Add a CI assertion that an un-approved provider yields the "needs /setup" / unresolved behavior, and an approved one resolves.

### Scope

- CI workflow / E2E harness config; no production code.

---

## Sequencing

These are independent and can land in any order after the main migration (Phases 3–5) merges. Suggested priority: Follow-up 4 (verify what shipped) → Follow-up 1 (the real architectural debt) → Follow-up 2 → Follow-up 3.

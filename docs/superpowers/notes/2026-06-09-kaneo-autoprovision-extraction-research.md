<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kaneo Auto-Provision Extraction Research

**Date:** 2026-06-09
**Status:** Research note for a future design spec

## Summary

The current Kaneo implementation combines three concerns that should be separated before extracting auto-provisioning into its own first-party plugin:

- `plugins/task-provider-kaneo/` registers the Kaneo task provider and also registers provisioning hooks.
- `plugins/task-provider-kaneo/provision.ts` performs account/workspace/API-key provisioning and directly imports core stores and caches.
- Core startup still contains Kaneo-specific legacy repair logic in `src/instances/kaneo-legacy-repair.ts`.

The requested future design direction is to optimize for a separate plugin owning the provisioning flow while the existing `task-provider-kaneo` plugin becomes only the task-provider integration.

## Current Implementation Findings

### Task-provider plugin registration

`plugins/task-provider-kaneo/plugin.json` declares one task-provider type, `kaneo`, with `provider.task` and `identity` permissions. It also declares provider instance config (`baseUrl`, `internalUrl`) and context config (`credential`, `workspaceId`).

`plugins/task-provider-kaneo/index.ts` registers the provider through `ctx.registration.registerTaskProviderType('kaneo', { ... })` and currently supplies:

- `factory`: creates the Kaneo provider.
- `autoProvision`: chat/LLM auto-provision hook.
- `provision`: settings-web provisioning hook.

The entry point loads provisioning via `import.meta.require('./auto-provision.js')`. That module exports thin wrappers around `maybeProvisionKaneo()` and `provisionAndConfigure()`.

### Provisioning implementation

`plugins/task-provider-kaneo/provision.ts` owns the actual provisioning flow:

1. Generate a unique email, password, display name, and workspace slug.
2. Call Kaneo Better Auth sign-up endpoint.
3. Create a Kaneo organization/workspace.
4. Create an API key, falling back to the session cookie if the API-key endpoint is unavailable.
5. Store `plugin:task-provider-kaneo:provider:credential` and `plugin:task-provider-kaneo:provider:workspaceId` in `user_config`.
6. Clear cached tools for the provisioned context.
7. Return a typed success, registration-disabled, or failed outcome.

Important direct core imports from this file:

- `../../src/cache.js`
- `../../src/chat/types.js`
- `../../src/config.js`
- `../../src/instances/context-store.js`
- `../../src/instances/task-store.js`
- `../../src/logger.js`
- `../../src/types/config.js`

These imports make provisioning plugin-local in directory layout but not isolated by the plugin facade.

### Chat and LLM auto-provision path

`src/providers/auto-provision.ts` is the generic dispatcher. It resolves context settings, loads the active task instance, finds the provider descriptor, and calls `descriptor.autoProvision` when present.

`src/llm-orchestrator.ts` calls the auto-provision dependency only for DM turns. It passes the resolved config context ID, chat user ID, username, and reply object. Exceptions are suppressed so broken provisioning falls through to normal providerless/setup guidance.

`src/commands/start.ts` also calls the same hook in demo mode after auto-authorizing a DM user.

Behavioral detail: `maybeProvisionKaneo()` returns `false` when it did not handle the turn and `true` after sending a success, registration-disabled, or failure message. The generic dispatcher does not itself send messages.

### Settings web provisioning path

`src/debug/settings/provision-routes.ts` is currently Kaneo-specific at the route and function name level:

- route: `/settings/api/provision/kaneo`
- handler: `handleProvisionKaneo()`
- client fetcher: `provisionKaneo()`
- UI label: `Kaneo auto-provision`

The route authenticates the settings session, checks CSRF, resolves the writable context scope, resolves the assigned active task instance, then calls `getTaskProviderProvision(taskInstance.type)`.

Important discrepancy: the route resolves the assigned task instance but passes `process.env['KANEO_CLIENT_URL']` and `process.env['KANEO_INTERNAL_URL']` into the hook instead of the task instance's `baseUrl` and `internalUrl`. The chat auto-provision path uses the assigned task instance config directly.

### Startup legacy repair

`src/index.ts` calls `runKaneoLegacyRepair()` only when `task-provider-kaneo` is active.

`src/instances/kaneo-legacy-repair.ts` is core code but Kaneo-specific. It:

- scans `user_config` for existing Kaneo credential and workspace keys,
- enables `task-provider-kaneo` for already-configured contexts,
- backfills missing `context_settings` rows,
- creates or promotes a default active Kaneo task instance when unambiguous,
- reads `KANEO_CLIENT_URL` and `KANEO_INTERNAL_URL` when creating a default instance.

This repair is related to provisioning state but is not the same as auto-provisioning. A future extraction design must decide whether this remains a one-time core migration/repair or moves into the new provisioning plugin.

### Settings UI coupling

`client/settings/sections/TaskProviderSection.svelte` always renders a Kaneo auto-provision block, regardless of the selected task instance type or whether a provisioning hook/plugin is active.

`client/settings/fetchers.ts` exposes a hardcoded `provisionKaneo(contextId)` helper that posts to `/settings/api/provision/kaneo`.

If provisioning becomes a separate plugin, the UI should either:

- keep a compatibility shim for Kaneo only, or
- move to a generic provisioning capability surface driven by active plugins/provider descriptors.

## Existing Tests To Preserve Or Move

Relevant current coverage:

- `tests/plugins/task-provider-kaneo/activation.test.ts` asserts the Kaneo plugin registers a factory and currently expects `autoProvision` to be present.
- `tests/plugins/task-provider-kaneo/provision.test.ts` covers account creation, registration-disabled handling, config writes, cache clearing, assigned task instance URL handling, and the exported `kaneoProvision` wrapper.
- `tests/debug/settings/provision-routes.test.ts` covers settings route auth/CSRF and dispatch through the provider registry provision hook.
- `tests/providers/registry.test.ts` covers descriptor exposure of `autoProvision`.
- `tests/plugins/runtime-types.test.ts` covers plugin contribution types that allow `autoProvision` and `provision` alongside provider registration.
- `tests/llm-orchestrator.test.ts` covers DM auto-provision dispatch and failure suppression.
- `tests/commands/start.test.ts` covers demo-mode `/start` auto-provision dispatch.
- `tests/instances/kaneo-legacy-repair.test.ts` covers startup repair behavior.

A future extraction will need to split tests so provider-only activation no longer asserts provisioning hooks on `task-provider-kaneo`, while new provisioning-plugin tests assert those hooks or replacement registration surfaces.

## Relevant Existing Design History

`docs/superpowers/specs/2026-05-30-plugin-review-validated-remediation-design.md` already established a provider provisioning abstraction goal:

- core asks the active provider whether provisioning exists,
- provider implementation decides what provisioning does,
- provider-specific provisioning code stays behind provider/plugin boundaries,
- provisioning failures do not break generic control flow.

`docs/superpowers/plans/2026-06-01-plugins-deployment-safety.md` implemented or planned the current `provision` hook dispatch through the provider registry. The current code reflects that shape.

`docs/plugins/developer-guide.md` documents provider plugins as allowed to supply `autoProvision` and `provision` through `registerTaskProviderType(...)`. Extracting provisioning into a separate plugin will require updating that contract or introducing a new contribution model.

## Design Implications For Extraction

### Recommended boundary to explore

Create a new first-party plugin, likely `plugins/kaneo-autoprovision/` or `plugins/task-provider-kaneo-autoprovision/`, that owns the provisioning flow. The existing `task-provider-kaneo` plugin should register only the Kaneo task provider factory, config schema, provider capabilities, traits, validator, and identity behavior.

### Interface pressure points

The current plugin API only lets provisioning hooks attach to a task provider registration. A separate provisioning plugin cannot register `autoProvision` or `provision` for the already-owned `kaneo` provider without one of these changes:

- Add a new contribution type for provider provisioning hooks that targets an existing provider type.
- Allow exactly one external plugin to augment a provider descriptor with provisioning hooks.
- Keep the hooks in the provider descriptor but let the provisioning plugin register a companion descriptor keyed by provider type.

The future design should prefer one explicit augmentation/contribution path over letting a second plugin re-register the `kaneo` provider type.

### Config write decision

The minimal-risk path is for the provisioning plugin to write the existing provider context keys:

- `plugin:task-provider-kaneo:provider:credential`
- `plugin:task-provider-kaneo:provider:workspaceId`

That preserves the current provider resolver and avoids a new credential bridge. The trade-off is that one plugin writes another plugin's provider config namespace, so the design should make this an explicit, declared permission or provider-targeted capability rather than an accidental direct core import.

### Core facade needs

To remove direct core imports from provisioning code, the new provisioning plugin likely needs framework-owned facades for:

- reading the assigned task instance config for the target context,
- checking whether target provider context config is already complete,
- writing target provider context config keys,
- clearing provider/tool caches after successful configuration,
- logging through `ctx.log`,
- sending reply text only through the existing auto-provision call context.

Raw DB, raw config store, and direct cache imports should not remain in the extracted plugin if the goal is real boundary cleanup.

### Settings API/UI choices

The future design needs to choose between:

- a compatibility route `/settings/api/provision/kaneo` that dispatches to the new provisioning plugin, or
- a generic route such as `/settings/api/provision` that provisions the currently assigned provider when a provisioning contribution exists.

The generic route better matches the plugin model, but it requires UI/schema changes. The compatibility route is smaller but preserves Kaneo-specific naming in core and client code.

### Legacy repair scope

`runKaneoLegacyRepair()` should be treated separately from live auto-provisioning. Options for a future design:

- Keep it in core as a bounded legacy repair, but remove it once the migration window ends.
- Move it into the new provisioning plugin as a startup repair contribution.
- Convert it into a generic migration/repair framework for provider plugins.

The smallest safe design is likely to keep legacy repair unchanged initially and explicitly defer moving it unless the extraction goal includes all Kaneo-specific startup behavior.

## Open Questions For Future Design

1. Should the new provisioning plugin write the existing `task-provider-kaneo` provider config keys directly, or should the framework expose a target-provider config writer facade?
2. Should the settings UI keep a Kaneo-specific provision button or become provider-provisioning-capability-driven?
3. Should provisioning plugin activation depend on `task-provider-kaneo` being active and compatible, and how should that dependency be represented in the manifest?
4. Should `runKaneoLegacyRepair()` remain core for now, move to the provisioning plugin, or be scheduled for removal after a migration window?
5. Should manual settings provisioning use task instance config (`baseUrl`, `internalUrl`) instead of `KANEO_CLIENT_URL` and `KANEO_INTERNAL_URL`?
6. Should provisioning hooks remain provider-descriptor fields, or should a separate registry own provider provisioning contributions?

## External References Consulted

- Bun documentation via Context7 (`/oven-sh/bun`): confirms project verification commands should use `bun test` and `bun <script>`/`bun run <script>` forms.
- Web search result: 1Password shell plugin `Provisioner` interface, used only as a general external example that provisioning can be modeled as a separate plugin responsibility with explicit provision/deprovision hooks. This repository's trust model and plugin API should remain the authoritative source for the actual design.

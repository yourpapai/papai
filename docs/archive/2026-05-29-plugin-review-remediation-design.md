<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Review Remediation Design

**Date:** 2026-05-29
**Status:** Draft
**Related:** [`2026-05-23-task-provider-as-plugin-design.md`](./2026-05-23-task-provider-as-plugin-design.md), [`2026-05-27-synthetic-web-search-plugin-design.md`](./2026-05-27-synthetic-web-search-plugin-design.md), [`2026-05-28-task-provider-plugin-phases-3-to-5-design.md`](./2026-05-28-task-provider-plugin-phases-3-to-5-design.md), [`2026-05-28-plugin-system-remediation.md`](../plans/2026-05-28-plugin-system-remediation.md), [`2026-05-29-plugin-review-followup-fixes.md`](../plans/2026-05-29-plugin-review-followup-fixes.md)

## Summary

This design is a focused remediation pass for the current trusted local plugin MVP. It covers only the confirmed high- and medium-severity defects validated against the current branch on 2026-05-29. It does not change the trust model, add sandboxing, or widen plugin capabilities.

The remediation is organized into three workstreams:

1. approval and lifecycle safety
2. config semantics and operator/user surfaces
3. manifest and runtime contract cleanup

The core design rule is: plugin approval, activation, eligibility, config UX, and runtime behavior must derive from the same declared plugin contract. Today those paths drift in several places. This design closes the drift without changing the overall plugin-system shape.

## Goals

- Prevent behavior-changing plugin source edits from bypassing reapproval.
- Ensure timed-out or failed activations cannot publish partial live side effects.
- Make plugin state honest: a plugin marked active must have all of its declared critical contributions live.
- Make admin-scoped and context-scoped plugin config behave consistently across eligibility checks, editing surfaces, and runtime reads.
- Complete the missing `/config` path for context-scoped plugin config.
- Remove manifest fields and runtime branches that currently accept values the system does not actually honor.
- Bring plugin tools into the normal tool-governance path.

## Non-Goals

- Changing the trusted first-party local plugin trust model.
- Adding sandboxing, signature verification, or external plugin installation.
- Broad documentation-only cleanup for low-severity review comments.
- Reworking plugin commands and jobs beyond what is required for the confirmed defects below.
- General plugin API redesign unrelated to the validated findings.

## Validated Scope

This design covers these confirmed defects:

- approval hash coverage ignores imported plugin files
- activation timeout does not cancel side effects
- duplicate contributed provider types can leave a plugin active without its declared provider type live
- admin-scoped config can become eligible before runtime reads see the new value
- `/config` plugin-enable interactions check admin-scoped required keys in the wrong store
- context-scoped plugin config is rendered but not editable through normal `/config` flow
- MCP-only plugin discovery path is broken or unreachable
- plugin manifest validation is too permissive
- `providerConfigValidator` is accepted but not wired from the manifest contract
- `contributes.configKeys` is accepted and documented but not wired into config-field generation
- plugin runtime `httpFetch` allows cleartext `http:`
- plugin tools are outside the normal tool preference taxonomy

The following validated findings are deliberately out of scope for this design because they are lower severity or documentation/trust-model issues rather than confirmed high/medium remediation items:

- prompt fragment budgeting being approximate
- permission-boundary language vs actual trusted-code model
- reserved permissions (`commands`, `scheduler`, `chat.send`) being only partially enforced
- legacy provider compatibility cleanup that is likely dead but not required for the confirmed defects

## Current State

The current branch has a solid MVP skeleton: discovery, approval, activation isolation, namespaced tools/commands/jobs, per-context eligibility, and permission-gated facades. The validated gaps are coherence problems between adjacent subsystems:

- Discovery computes `manifestHash` from `plugin.json` plus only the entrypoint file contents.
- Loader timeout handling uses `Promise.race(...)` without real cancellation and allows registration side effects during activation.
- Eligibility reads admin config live, while the example synthetic plugin reads admin config once during activation and closes over it.
- `/config` toggle interactions treat all required plugin config as context-scoped.
- `/config` displays plugin config requirements but does not build editable rows for plugin-owned context config.
- Manifest schema accepts unknown keys and a prefix-only version string.
- The `mcp`-only path assumes `main` may be absent, but manifest defaults and discovery still try to read `index.ts`.
- `providerConfigValidator` and `contributes.configKeys` exist in the manifest contract but do not drive runtime behavior.
- Plugin outbound runtime fetches allow `http:` despite carrying plugin-owned credentials.
- Plugin tools default to uncategorized tool-preference behavior.

## Workstream 1: Approval And Lifecycle Safety

### 1.1 Approval hash coverage

Approval must cover effective plugin behavior, not just `plugin.json` and the top-level entrypoint.

Discovery will replace the current hash input with a deterministic content hash over the plugin's effective local source set:

- always include `plugin.json`
- when `main` is present, include the entry module and every statically-resolved relative import that stays inside the plugin directory
- include files reached through those imports regardless of whether they are the file named in `manifest.main`
- do not include core imports, package imports, or files outside the plugin directory

Local dynamic imports are out of bounds for the approval boundary in this pass. If discovery encounters a plugin-owned dynamic import that it cannot resolve deterministically, discovery fails closed for that plugin with an explicit error rather than hashing an incomplete subset.

This keeps the approval boundary aligned with actual plugin-owned behavior while avoiding unrelated repository churn. A change in `./helper.ts` or any other imported local file will invalidate approval and return the plugin to `discovered`.

If discovery cannot build a deterministic local source set for a non-MCP-only plugin, discovery fails closed for that plugin with an explicit error instead of silently hashing an incomplete subset.

### 1.2 Activation commit boundary

Activation timeouts remain best-effort time limits, not JavaScript cancellation. The fix is not to pretend cancellation exists, but to stop publishing live side effects before activation succeeds.

The loader will stage framework-owned activation side effects locally and publish them only at a final commit point after `activate(ctx)` resolves before timeout. The staged side effects are:

- tool contributions
- prompt fragment contributions
- command contributions
- scheduled jobs
- contributed task provider type registrations

The staging context will collect these contributions in memory. If activation fails or times out:

- the staged bundle is discarded
- the plugin is marked `error`
- no provider type is registered
- no contributions are visible in registries or schedulers

If plugin code continues running after timeout, any late registration attempt must be rejected because the staging token is already invalidated. The runtime event stream should record the timeout reason, but the live system must remain unchanged.

### 1.3 Honest active state for provider plugins

The current duplicate-provider behavior logs and keeps the first provider type, but still allows the second plugin to activate. That leaves the later plugin in an internally inconsistent `active` state.

The remediation rule is:

- if a plugin declares a single contributed task provider type and that type cannot be registered, activation fails
- duplicate contributed provider type claims are activation errors for the later plugin
- built-in type shadowing remains an activation error as it is today

This preserves a simple invariant: a provider plugin marked active has its declared provider type live.

## Workstream 2: Config Semantics And Operator/User Surfaces

### 2.1 Admin config is live runtime state

Admin-scoped plugin config is mutable operational state, not activation-time bootstrap data. Eligibility already behaves that way; runtime behavior must match.

The design makes that explicit by adding a read-only admin-config accessor to plugin tool runtime context. Plugins that need admin config during execution will read it at execution time, not activation time.

Concretely:

- `PluginContext.adminConfig` remains available during activation for declaration-time branching only
- `PluginToolRuntimeContext` gains `adminConfig.get(key)` for live reads during tool execution
- example and first-party plugins must stop copying admin config values into activation closures when those values affect request-time behavior

This fixes the validated synthetic plugin bug: once admin config is updated, eligibility and runtime reads see the same state without restart.

This design does not attempt to add equivalent runtime accessors to every plugin surface in this pass. The confirmed defect is in tool execution, so the remediation is intentionally scoped there.

### 2.2 One required-config resolution path

Required-config checks must not disagree depending on which UI or runtime path asks the question.

The remediation introduces one shared required-config resolution helper that accepts a plugin manifest plus a target context and returns:

- missing required admin-scoped keys
- missing required context-scoped keys
- human-facing labels for the same keys

The following code paths must all consume that one helper:

- per-context eligibility resolution
- `/config` plugin status rendering
- `/config` plugin enable/disable interaction checks

Admin-scoped requirements are read only from admin plugin config storage. Context-scoped requirements are read only from per-context plugin config storage. A missing required key must produce the same answer everywhere.

### 2.3 Context-scoped plugin config becomes editable in `/config`

The current UI displays plugin requirements but does not generate editable fields for plugin-owned context config. This design completes that surface.

`/config` will render plugin-owned context config rows alongside existing provider-context and preference fields. Those rows will:

- use the same edit-button path as other config fields
- preserve masking for sensitive values
- write to namespaced plugin config storage
- appear only for active plugins that declare context-editable config

Admin-scoped plugin config remains in the admin UI and is not duplicated into `/config`.

### 2.4 `contributes.configKeys` becomes real contract

`contributes.configKeys` is currently accepted and documented but does not drive any runtime behavior. This design wires it into field generation while keeping the manifest contract explicit.

The new rule is:

- `contributes.configKeys` declares which plugin-owned keys are user-editable in `/config`
- each such key must have a matching `configRequirements` entry with `scope: 'context'`
- admin-scoped requirements must not appear in `contributes.configKeys`

This yields a single consistent model:

- `contributes.configKeys`: editable context-config surface
- `configRequirements`: labels, sensitivity, requiredness, and gating semantics

Manifest validation must fail if these declarations disagree.

### 2.5 Shared descriptor generation

Plugin config rendering, masking, and editing will be generated from a shared plugin-config field descriptor, not handwritten logic in each surface. That descriptor is the source of truth for:

- storage scope
- storage key
- user-facing label
- sensitivity
- requiredness
- plugin ownership

This prevents another split where eligibility, `/config` rendering, and write paths each interpret the manifest differently.

## Workstream 3: Manifest And Runtime Contract Cleanup

### 3.1 Strict manifest validation

Plugin manifests will become strict objects throughout the validation tree.

Requirements:

- unknown manifest keys are rejected rather than silently stripped
- nested contribution/config objects also reject unknown keys
- `version` must match a full semver string, not a semver-looking prefix

This turns typoed or stale manifest fields into explicit discovery errors instead of quiet no-ops.

### 3.2 Explicit MCP-only plugin contract

The codebase already hints at MCP-only plugins, but the current discovery path does not support them correctly. This design makes MCP-only plugins an explicit valid shape.

An MCP-only plugin is defined as:

- `mcp` is present
- `main` is absent
- no non-MCP runtime contributions are declared (`tools`, `promptFragments`, `commands`, `jobs`, `taskProviderTypes` all empty)
- no `providerConfigValidator` is declared

For MCP-only plugins:

- discovery does not try to resolve or read `index.ts`
- the approval hash is derived from `plugin.json` only
- loader skips module import and activation entirely
- per-context enablement and eligibility continue to apply to the MCP contribution supplied by the manifest

Any plugin that declares runtime contributions beyond `mcp` must provide a `main` entrypoint and use the normal activation path.

### 3.3 `providerConfigValidator` becomes loader-owned contract

`providerConfigValidator` is currently a documented manifest field with no authoritative runtime path. This design makes the manifest declaration real and removes duplicate sources of truth.

The rule becomes:

- when `manifest.providerConfigValidator` is present, the loader resolves that named export from the plugin module
- the export must match the provider-config validator shape
- the resolved validator is attached to the contributed provider type registration automatically
- plugin code no longer declares provider config validators ad hoc through a separate registration argument

If the named export is missing or has the wrong shape, plugin activation fails. This keeps the manifest contract and runtime behavior aligned.

This applies only to plugins that declare task provider types. MCP-only plugins and normal tool-only plugins cannot declare `providerConfigValidator`.

### 3.4 HTTPS-only plugin runtime fetch

Plugin runtime `httpFetch` is allowed to carry plugin-scoped credentials. It must therefore be stricter than generic public web fetch.

The new rule is simple:

- plugin runtime `httpFetch` accepts only `https:` URLs
- host allowlisting remains in force
- public-host validation remains in force
- redirect hops must also remain `https:` and allowlisted

This change is isolated to plugin runtime fetch and does not change the broader `web_fetch` tool's public-URL policy.

### 3.5 Plugin tools join tool preferences

Plugin tools should not default to uncategorized always-on behavior.

This remediation adds a coarse built-in classification for namespaced plugin tools:

- new tool domain: `plugin`
- all `plugin_<id>__<tool>` names classify into that domain

This is intentionally narrow. It brings plugin tools into the same tool-preference pipeline as built-ins and MCP tools without attempting rich per-tool semantic classification in this pass. Domain toggles and per-tool overrides will then govern plugin tools through the existing UI and storage model.

## Error Handling

The remediation follows the current plugin-system principle: fail closed, isolate damage, and record why.

- Discovery errors remain process-local and do not crash startup, but now produce explicit errors for invalid manifest keys, broken MCP-only declarations, or invalid provider-config-validator exports.
- Activation timeout or failure leaves no partial live state because staged contributions are never published.
- Provider-type collisions fail the later plugin's activation instead of leaving it falsely active.
- Missing required config produces the same answer across eligibility and UI surfaces because the same resolver determines missing keys.
- Invalid plugin config writes are blocked before persistence when validator or descriptor rules fail.
- HTTPS violations in plugin runtime fetch fail the request before any network hop is attempted.

## Testing Strategy

Testing is organized by workstream.

### Discovery and manifest tests

- imported plugin helper changes invalidate approval hash
- unknown manifest keys fail discovery
- partial semver strings fail validation
- MCP-only manifests without `main` are accepted only for the explicit MCP-only shape
- non-MCP plugins without `main` fail discovery

### Loader and lifecycle tests

- timed-out activation publishes no tools, prompts, commands, jobs, or provider types
- late registration attempts after timeout are rejected
- duplicate contributed provider type claims fail later-plugin activation
- valid provider plugins still register their type on successful activation

### Config and eligibility tests

- admin-scoped required keys are read from admin config in all paths
- context-scoped required keys are read from context config in all paths
- `/config` plugin-toggle checks and main eligibility return the same missing-key result
- synthetic-web-search-style tool execution sees admin config updates without restart

### Config surface tests

- plugin-owned context config fields appear in `/config`
- sensitive plugin config values are masked in rendered output
- editing a plugin-owned context key writes to the plugin config store
- manifest mismatch between `contributes.configKeys` and `configRequirements` fails validation

### Provider validator tests

- named validator export resolves and is invoked before instance persist
- missing named export fails activation
- wrong validator shape fails activation

### Tool governance and network tests

- plugin tools classify into the `plugin` domain
- domain toggles and per-tool overrides can disable plugin tools
- plugin runtime fetch rejects `http:` URLs and `http:` redirects

## Rollout Notes

This remediation should land as one focused implementation plan, but the implementation itself may use separate commits per workstream. The rollout should preserve the current trusted-plugin model and avoid simultaneous unrelated refactors.

Docs and plugin examples touched directly by these fixes should be updated in the same implementation work so the manifest contract matches runtime behavior immediately after merge. Broader trust-model or low-severity documentation cleanup remains a separate follow-up.

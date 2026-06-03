<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0156: Plugin Review Remediation

## Status

Implemented

## Date

2026-05-29

## Context

The trusted-local plugin MVP (ADR-0123) shipped with a solid skeleton but
several coherence gaps between adjacent subsystems. A focused review on
2026-05-29 confirmed high- and medium-severity defects across approval hashing,
activation lifecycle, config semantics, manifest validation, and runtime
behavior. These defects do not change the trust model or widen plugin
capabilities; they close drift so that approval, activation, eligibility, config
UX, and runtime all derive from the same declared plugin contract.

Confirmed defects:

- Approval hash covers only `plugin.json` and the entrypoint file, ignoring
  imported local helpers. A behavior-changing edit to a helper file bypasses
  reapproval.
- Activation timeout publishes side effects (tools, provider registrations)
  before `activate()` resolves; a timed-out plugin can leave partial live state.
- Duplicate contributed provider type claims let a later plugin stay `active`
  without its declared provider type actually registered.
- Admin-scoped config is read once during activation and closed over, so runtime
  reads see stale values after admin updates.
- `/config` plugin-toggle interactions and eligibility checks read admin-scoped
  required keys from the wrong store.
- Context-scoped plugin config is displayed but not editable in `/config`.
- MCP-only plugin discovery path is unreachable: `main` defaults to `index.ts`,
  so discovery always tries to read an entrypoint.
- Manifest validation strips unknown keys silently and accepts prefix-only
  semver strings.
- `providerConfigValidator` is accepted in the manifest but never wired to
  runtime behavior.
- `contributes.configKeys` is accepted and documented but does not drive
  config-field generation.
- Plugin runtime `httpFetch` allows cleartext `http:` despite carrying
  plugin-scoped credentials.
- Plugin tools are outside the tool-preference taxonomy, defaulting to
  uncategorized always-on behavior.

## Decision Drivers

- **Approval must track behavior**: A manifest hash that ignores imported
  helpers is a bypassable security boundary.
- **No partial live state**: A timed-out or failed activation must leave zero
  visible side effects in tool, prompt, command, job, or provider registries.
- **Honest plugin state**: A plugin marked `active` must have all declared
  critical contributions live; otherwise it is an error.
- **Config consistency**: The same required-config resolution logic must be
  consumed by eligibility, `/config` rendering, and toggle interactions.
- **Manifest is the contract**: Fields accepted in the manifest must drive
  runtime behavior; fields that do not must be rejected at validation time.
- **Minimal scope**: Fix only confirmed defects without redesigning the plugin
  system or changing the trust model.

## Considered Options

### Option A: Full plugin-system redesign

Rebuild discovery, activation, and config from scratch around a unified
plugin-lifecycle state machine.

- **Pros**: Eliminates all drift by construction; extensible for future
  third-party model.
- **Cons**: Far exceeds the scope of confirmed defects; high regression risk;
  delays shipping fixes for real security gaps (hash bypass, partial state).

### Option B: Targeted remediation around existing boundaries (chosen)

Make the smallest coherent fixes at the existing module boundaries: discovery
owns approval hashing and MCP-only shape validation, loader owns activation
commit semantics and manifest-owned validator exports, `/config` and eligibility
share one config-resolution model, and tool preferences gain a coarse
plugin-tool domain.

- **Pros**: Each fix is independently testable and reviewable; preserves the
  MVP shape; no migration or schema changes beyond the existing plugin tables.
- **Cons**: Leaves lower-severity items (approximate prompt budgeting, partial
  permission enforcement) for a follow-up pass.

### Option C: Reject MCP-only plugins entirely

Remove the MCP manifest field and require all plugins to provide a `main`
entrypoint.

- **Pros**: Simplifies discovery and activation code; no special-casing.
- **Cons**: MCP-only plugins are a legitimate and simpler use case; rejecting
  them forces unnecessary boilerplate and runtime overhead for plugins that
  never execute in-process.

## Decision

**Option B**, organized into three workstreams:

| Workstream           | Decisions                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval & lifecycle | Discovery hashes the full local import graph (static only; unresolvable dynamic imports fail closed). Activation stages all side effects locally and publishes them only after `activate()` resolves before timeout. Duplicate provider type claims fail the later plugin's activation.                                                                                                                                |
| Config semantics     | Admin-scoped config is read live via `PluginToolRuntimeContext.adminConfig.get(key)` at tool execution time, not closed over at activation. One shared `getMissingRequiredPluginRequirements()` resolver is consumed by eligibility, `/config` rendering, and toggle interactions. `contributes.configKeys` is wired into `/config` field generation; each key must match a context-scoped `configRequirements` entry. |
| Manifest & runtime   | Manifests use `strictObject` throughout; unknown keys are rejected. Semver regex requires full `major.minor.patch`. MCP-only is an explicit valid shape (`mcp` present, `main` absent, no runtime contributions). `providerConfigValidator` resolves from the named module export. Plugin `httpFetch` requires `https:` for URLs and redirect hops. Plugin tools classify into a new `plugin` tool-preference domain.  |

## Consequences

### Positive

- Approval hash now tracks effective plugin behavior; any change to an imported
  local helper invalidates approval and forces re-review.
- Timed-out or failed activations leave zero live side effects; late
  registration attempts after timeout are discarded.
- A provider plugin marked `active` always has its declared provider type live;
  duplicate claims surface as activation errors.
- Admin config updates are visible at tool execution time without restart.
- Eligibility, `/config` status rendering, and toggle interactions return the
  same missing-config answer because they share one resolver.
- Context-scoped plugin config is editable in `/config`, completing the user
  surface.
- Strict manifest validation turns typos and stale fields into explicit
  discovery errors instead of silent no-ops.
- MCP-only plugins work as a first-class shape without requiring an entrypoint.
- Plugin runtime fetch is restricted to `https:`, preventing credential
  exposure over cleartext.
- Plugin tools are governable through the existing tool-preference UI and
  storage model.

### Negative

- Discovery reads the full local import graph at startup, adding filesystem I/O
  for plugins with many local helpers.
- Unresolvable dynamic imports (variable specifiers) are hard-rejected; plugins
  that need dynamic imports must refactor to static ones.
- Plugin tool-preference classification is coarse (all `plugin_*` tools share
  one domain) rather than per-plugin or per-capability.
- Lower-severity items (prompt budget approximation, partial permission
  enforcement, reserved-command gaps) remain unfixed.

### Risks

- The import-graph walker uses regex-based static analysis, not a full AST.
  Unusual import syntax (e.g. template literals with constant segments) would
  be missed. Mitigation: the regex covers the standard `import`/`export from`
  patterns; any uncovered case surfaces as a missing hash dependency, which
  under-hashes rather than over-hashes.
- Activation staging does not provide hard cancellation; JS code that continues
  after timeout can still mutate local plugin state. Mitigation: staged
  contributions are published from the main activation flow; late mutations
  are discarded because the staging context is invalidated.
- The `plugin` tool-preference domain groups all plugin tools together, so an
  admin disabling the domain disables all plugin tools. Mitigation: per-tool
  overrides still work; the coarse domain is a starting point that can be
  refined later.

## Implementation Notes

Modules changed (`src/plugins/`):

| File                              | Changes                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `discovery.ts`                    | Local source graph walk for hashing; unresolvable dynamic import rejection; MCP-only entrypoint bypass                         |
| `types.ts`                        | `strictObject` for manifest and contributions; tightened semver regex; MCP-only/main refinement; `configKeys` cross-validation |
| `loader.ts`                       | Staged activation commit; manifest-owned validator export resolution; duplicate provider type detection                        |
| `context.ts`                      | Staged provider-type registration (no immediate global registry mutation); simplified registration signature                   |
| `runtime-types.ts`                | `taskProviderRegistration` staging shape with optional `validateConfig`; `adminConfig` accessor on tool context                |
| `tool-runtime.ts`                 | `buildRuntimeAdminConfig()` for live admin-config reads at execution time                                                      |
| `registry-context-eligibility.ts` | `getMissingRequiredPluginRequirements()` shared resolver with scope-aware store reads                                          |
| `provider-runtime.ts`             | `assertHttps()` guard on initial URL and redirect hops                                                                         |

Other modules:

| File                                      | Changes                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `src/chat/plugin-interaction-handler.ts`  | Reuse shared missing-config resolver; remove ad hoc `getPluginConfig` path |
| `src/commands/config.ts`                  | Reuse shared resolver for status rendering; render plugin-owned fields     |
| `src/config-keys.ts`                      | `getPluginConfigFieldsForContext()` merges plugin context fields           |
| `src/types/config.ts`                     | `ConfigField.kind` gains `'plugin-context'`                                |
| `src/config-editor/handlers.ts`           | Route `plugin-context` writes through `setPluginConfig()`                  |
| `src/debug/instance-config-validation.ts` | Invoke contributed provider validator before task-instance persist         |
| `src/tools/tool-metadata.ts`              | `ToolDomain` gains `'plugin'`; `plugin_*` names classify into it           |

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the MVP this remediation closes gaps
  in.
- ADR-0009: Multi-Provider Task Tracker Support — provider capability model
  that contributed provider-type registration builds on.
- ADR-0036: Centralized Scheduler Utility — scheduler integration point
  for plugin job contributions.

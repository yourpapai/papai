<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0141: User-Configurable Tool Access (Tool Toggles)

## Status

Implemented

## Date

2026-05-25 – 2026-06-02

## Context

The set of tools exposed to the LLM was fixed by provider capabilities and
context (DM/group, mode, S3 availability). Users had no way to narrow that set
— for safety (e.g. forbidding `delete_task`), noise reduction, or because they
did not use a feature.

A naive "just drop the tool" approach had a second-order problem: the system
prompt (`src/system-prompt.ts`) was largely static and hard-referenced specific
tools by name (`web_fetch`, `save_memo`, recurring/deferred tools,
destructive-action rules, relation-type mapping). Removing a tool while leaving
its positive guidance in the prompt instructed the agent to call something that
no longer existed — confusing the model and wasting turns.

The design spec (`docs/archive/2026-05-25-user-configurable-tool-access-design.md`)
and implementation plan
(`docs/archive/2026-05-25-user-configurable-tool-access.md`) established a
denylist approach with domain-group granularity, per-tool overrides, and
system-prompt fragment composition.

## Decision Drivers

- **Safety opt-out**: Users must be able to disable destructive or
  unwanted tools without admin intervention.
- **Prompt coherence**: Removing a tool must never leave dangling
  positive guidance that instructs the agent to call it.
- **Zero regression**: Default all-enabled; empty preferences produce
  identical behavior to the pre-feature state.
- **Structural enforcement**: Disabled tools must be physically absent
  from the `ToolSet`, not just runtime-gated.
- **Domain granularity with per-tool escape valve**: Whole-domain toggles
  cover most use cases; per-tool overrides handle exceptions within a
  domain.
- **Reuse existing patterns**: Config KV storage, `/config` UI flow, and
  interaction-handler routing must follow the plugin-toggle precedent.

## Considered Options

### Option A: Per-tool flat denylist

Store a flat set of disabled tool names. Toggle each tool independently.

- **Pros**: Simplest data model; one toggle per tool.
- **Cons**: Toggling a domain with many tools requires N individual
  actions; no batch toggle; no conceptual grouping.

### Option B: Domain-grouped denylist with per-tool overrides (chosen)

Store a denylist of disabled domains plus a map of per-tool overrides that
win over the domain default. Effective state:
`enabled(tool) = toolOverrides[tool] ?? !disabledDomains.includes(domain(tool))`

- **Pros**: Domain toggle is a single action; per-tool overrides handle
  the "disable delete_task but keep create_task" case; compact JSON;
  redundant overrides are auto-pruned.
- **Cons**: Slightly more complex evaluation logic; two levels of
  state to reason about.

### Option C: Three-state per-tool permission (allow/deny/ask)

Each tool has a three-state permission: `allow` (default), `deny` (removed),
`ask` (gated on per-call user confirmation).

- **Pros**: `ask` state adds a confirmation gate for dangerous tools
  without fully removing them.
- **Cons**: `ask` is a separate feature with its own UX complexity
  (schema mutation, confirmation flow); conflation with denylist
  overcomplicates the initial ship.

## Decision

**Option B** for the data model and filter placement, with the following
subsidiary decisions:

| Topic              | Decision                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage            | JSON value under reserved `tool_prefs` config key (not in `CONFIG_KEYS` union, non-user-visible in raw config dump). Personal and group scope via `contextId`.                                         |
| Filter placement   | Inside `makeTools()`, after capability + context gating and plugin merge, before cache. Disabled tools are removed from the `ToolSet`.                                                                 |
| Cache invalidation | `setToolPrefs` calls `clearCachedToolsByPrefix(contextId)` — clears DM key and all group-prefixed keys. System prompt is rebuilt every turn (no prompt cache).                                         |
| Prompt coherence   | System prompt composed from domain-keyed fragments; a fragment is included only if ≥1 of its required tools is enabled. A safety-net line lists partially-disabled tools within still-enabled domains. |
| Safety-net scope   | Only lists tools disabled by override within an enabled domain (e.g. `delete_task` off while task domain on). Whole-domain disables are handled by fragment exclusion.                                 |
| UI                 | "🧰 Tools" section in `/config`; two-level navigation (domain list → tool drill-in) via `tgl:` callbacks routed in `interaction-router.ts`. Risk labels from `TOOL_METADATA.risk`.                     |
| Default            | All enabled / opt-out. Empty or corrupt JSON treated as empty prefs with a `warn` log.                                                                                                                 |
| Unclassified tools | Tools without `tool-metadata` domain (e.g. plugin tools with no metadata) are always treated as enabled and pass through the filter untouched.                                                         |
| Three-state `ask`  | Deferred; not part of this ADR. The `tool_prefs` schema uses `domainDefaults`/`toolOverrides` keys in the settings UI to express `allow`/`deny`/`ask`.                                                 |

## Consequences

### Positive

- Users can disable any tool or domain without admin intervention; safety
  opt-out is self-serve.
- System prompt never references a disabled tool, eliminating the
  "instructed to call something absent" failure mode.
- Structural enforcement (tool physically absent from `ToolSet`) means
  no runtime guard or execution-time rejection is needed.
- Domain toggle is a single action; per-tool overrides handle exceptions
  without requiring N individual toggles.
- Redundant overrides are auto-pruned, keeping the persisted JSON minimal.
- Backward-compatible: empty preferences produce identical behavior to
  the pre-feature state.

### Negative

- Two-level state (domain default + per-tool override) requires slightly
  more reasoning than a flat denylist.
- Per-context activation adds one preference evaluation per `makeTools()`
  call.
- The safety-net line occupies prompt tokens even when only a few tools
  are partially disabled.
- Non-interactive platforms see a read-only status dump and must use a
  button-capable client to toggle.

### Risks

- A user disabling a core read domain (e.g. all task tools) may leave the
  bot unable to act. Mitigation: the domain view can show a gentle hint
  but does not block the action, consistent with the no-admin-floor
  decision.
- Corrupt `tool_prefs` JSON falls back to empty (all enabled) with a
  `warn` log. This is safe but may surprise a user who intended
  restrictions.

## Implementation Notes

Key modules:

| File                                          | Role                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/tool-preferences.ts`               | `ToolPrefs` type, parse/serialize, `getToolPrefs`/`setToolPrefs`, `isToolEnabled`, `partitionToolNames`, `getDomainStatus`, `toggleDomain`, `toggleTool`, cache invalidation on write                               |
| `src/tools/index.ts`                          | `applyToolPreferences()` filter applied inside `makeTools()` before return                                                                                                                                          |
| `src/system-prompt.ts`                        | Fragment-composed prompt; `buildSystemPrompt(provider, contextId, enabledToolNames?)`; domain-keyed fragments included only when ≥1 required tool is enabled; `buildUnavailableLine()` for partially-disabled tools |
| `src/commands/tool-config-view.ts`            | `buildDomainListView`/`buildDomainDrillView` rendering with risk labels and status markers                                                                                                                          |
| `src/chat/tool-toggle-interaction-handler.ts` | Routes `tgl:` callbacks (`menu`, `open`, `dom`, `tool`, `back`); applies toggles and re-renders                                                                                                                     |
| `src/commands/config.ts`                      | "🧰 Tools" status line and menu-entry button                                                                                                                                                                        |
| `src/chat/interaction-router.ts`              | Routes `tgl:` prefix to `handleToolToggleInteraction`                                                                                                                                                               |
| `src/cache.ts`                                | `clearCachedToolsByPrefix(contextId)` for DM + group-prefixed cache keys                                                                                                                                            |

Orchestrator threading: `prepareLlmInvocation` returns `enabledToolNames`
(`ReadonlySet<string>`); passed through `InvokeModelArgs` to
`invokeModel` → `buildSystemPrompt`. Proactive LLM path
(`src/deferred-prompts/proactive-llm.ts`) captures the full pre-routing
tool-name set similarly.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin tools are subject to
  the same toggle filter; the `tgl:` callback pattern mirrors the `plg:`
  plugin-toggle flow.
- ADR-0009: Multi-Provider Task Tracker Support — provider capability
  gating is the upstream filter that runs before tool preferences.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model
  underpins the interaction-handler routing used by `tgl:` callbacks.

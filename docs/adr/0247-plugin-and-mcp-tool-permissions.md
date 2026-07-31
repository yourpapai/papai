<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0247: Plugin and MCP Tool Permissions in the Settings UI

## Status

Implemented (with divergence)

## Date

2026-07-02

## Context

The tool-permission **engine** already understood plugin-registered tools (`plugin_<id>__<tool>`) and MCP-sourced tools (`mcp_<server>__<tool>`): `getToolMetadata()` maps both to the `plugin`/`mcp` domains at risk `open-world`, so `resolveToolPermission`, deny-filtering, ask-wrapping, and preset risk tiers all applied to them at runtime. The gap was purely in the settings surface:

- `availableToolNames()` in `src/debug/settings/tools-routes.ts` built names with the **sync** builtin-only `buildTools()`, so `GET /settings/api/tools` never returned plugin/MCP tools and `POST .../toggle` (`kind: 'tool'`) rejected them with 422 `unknown tool`.
- Contexts with no task instance got an empty Tools section — `availableToolNames()` returned `[]` when the provider was `null`, even though the runtime exposes providerless builtins and providerless plugin tools there (`buildProviderlessToolDescriptors`).
- The admin "Default tool permissions" route built its view from the static `TOOL_METADATA` catalog, so plugin tools were invisible there too.

The design (`docs/superpowers/specs/2026-07-02-plugin-tool-permissions-design.md`) and plan (`docs/superpowers/plans/2026-07-02-plugin-mcp-tool-permissions.md`) wanted the settings Tools section to mirror the **exact runtime tool surface** (spec "approach C — full fidelity"), enumerate plugin/MCP tools individually, group them per plugin id / per MCP server, and add a per-group bulk toggle (`kind: 'group'`) on top of the existing per-tool and per-domain toggles.

## Decision Drivers

- **Displayed surface == runtime surface.** The settings route must enumerate exactly the tools the LLM would see — builtins + user MCP tools + plugin tools + plugin-declared MCP tools — with no duplicated eligibility/capability/collision logic. Reusing the async runtime assemblers (`buildToolDescriptors`/`buildProviderlessToolDescriptors`) is the only option that also covers MCP (which needs live pooled connections).
- **Provider-`null` contexts must show their surface.** DM/group contexts without a task instance get the providerless tool surface instead of an empty section.
- **Per-group bulk action.** Plugin/MCP tools are grouped by their derived id segment; a `kind: 'group'` toggle writes per-tool overrides for every tool in the group (no new `group` layer is added to `tool_prefs`).
- **Grouping is display metadata only.** The `ToolDomain` enum and the `tool_prefs` shape stay untouched; a tool entry just gains an optional `group` field derived from the namespaced name.
- **Admin defaults cover native plugin tools.** The admin catalog becomes per-request and includes native tool names of all active plugins (context-agnostic). MCP-sourced names are inherently not enumerable there.
- **TDD per repo policy, DI-first where supported.** The MCP listing suite keeps its `mock.module` boundary isolated to one worker (the established `tests/tools/mcp-integration.test.ts` pattern).

## Considered Options

### Option 1 — Full-fidelity enumeration; derived `group` field; `kind: 'group'` per-tool overrides (chosen)

`availableToolNames()` calls the same async assemblers the runtime uses; `buildDomainView` derives a `group` from the namespaced name (registry-lookup for `plugin_*`, server id for `mcp_*`); `ToggleBodySchema` gains `kind: 'group'` resolving to per-tool overrides.

- **Pros:** zero duplicated eligibility/MCP/collision logic — the displayed surface is provably the runtime surface; MCP tools become visible and editable with no bespoke enumeration; grouping is pure display metadata so prefs stay flat; presets keep working (plugin/MCP tools are blanket `open-world`, so `read-only`/`non-destructive` place them in `ask`).
- **Cons:** the settings GET performs pooled MCP connections; a downed MCP server temporarily drops its tools from the list (overrides persist harmlessly), and a cold request pays connect latency.

### Option 2 — Inline patch / shared name-only enumerator

Append plugin names by calling registry functions directly from the route (A), or a shared sync `listPluginToolNames()` helper reused by the routes (B).

- **Pros:** cheaper; no MCP connection at settings time; smaller diff.
- **Cons:** duplicates the runtime's capability/context-eligibility/collision rules; **cannot cover MCP tools at all** — MCP tool names are not enumerable without connecting to the servers, so MCP would stay invisible and uneditable. Rejected in the design.

### Option 3 — Add a real `group` layer to `tool_prefs`

Store group-level permissions in `tool_prefs` alongside `domainDefaults`/`riskDefaults`/`toolOverrides`.

- **Pros:** group state is queryable rather than derived.
- **Cons:** rejected — it complicates the prefs resolution precedence (already three layers) and the precedence between a group default and a per-tool override, for no functional gain; group membership is already derivable from tool metadata + the namespaced name.

## Decision

The chosen Option 1 shipped in full across server grouping, both route modules, the client schema/fetchers/grouping lib, the UI, and the docs. What shipped:

1. **Server grouping module (`src/debug/settings/tool-grouping.ts`).** `activePluginSegmentMap()` maps every sanitized form of each active plugin id to its real id (native `sanitizePluginId` '-'→'_' plus `sanitizeServerId` kebab-case); `deriveToolGroup()` extracts the id segment at the first `__`, mapping plugin segments back via the registry and returning the raw MCP server id; `resolveGroupTools()` filters names by domain + derived group.
2. **Runtime-accurate enumeration (`src/debug/settings/tools-routes.ts`).** `availableToolNames()` is async and calls `buildProviderlessToolDescriptors` (provider `null`) or `buildToolDescriptors`, filtering to names with tool metadata — so provider-`null` contexts now show the providerless surface and plugin/MCP tools appear. `buildDomainView()` attaches the derived `group` to each entry.
3. **`kind: 'group'` bulk toggle.** Both the per-context and admin toggle schemas gain a discriminated `group` member; the handler resolves the group's currently-exposed tools via `resolveGroupTools()` and writes a per-tool override for each, 422-ing on unknown domain/group.
4. **Admin defaults dynamic catalog (`src/debug/settings/admin/tool-defaults-routes.ts`).** The module-level `CATALOG_NAMES` constant became a per-request `catalogNames()` = static metadata keys + namespaced native tool names of all active plugins (via `contributionRegistry`).
5. **Client schema + fetchers + grouping lib.** `ToolEntrySchema` gains `group: z.string().optional()`; `setToolPermission`/`setToolDefault` input unions gain the `kind: 'group'` variant; `client/settings/lib/group-tools.ts` exposes `groupToolEntries()` (ungrouped bucket first, then per-group buckets sorted by label) and `groupSummary()` (uniform permission or `partial`).
6. **ToolsSection UI + story.** An expanded domain renders sub-group headers (label + summary pill + bulk cycle button wired to `kind: 'group'`) with the grouped tools indented; builtins stay flat. A `Grouped` story covers plugin + MCP + flat-time domains.
7. **Docs.** `docs/architecture/tools.md` documents the runtime-accurate enumeration, grouping, and `kind: 'group'` toggle (plus the live-turn-only display discrepancies); `docs/architecture/plugins.md` notes plugin tools appear individually per context.

## Consequences

### Positive

- A user can now see and edit `allow`/`ask`/`deny` for every tool the LLM actually has — plugin tools, user MCP tools, and plugin-declared MCP tools — per context and per admin default, grouped sensibly by plugin id / server id.
- Provider-`null` contexts (no task instance) get a useful Tools section instead of an empty one.
- The displayed surface is provably the runtime surface: the single async-assembly path means there is no second implementation of capability/eligibility/collision/MCP-merge rules to drift.
- Grouping is pure display metadata, so `tool_prefs`, the `ToolDomain` enum, presets, and the existing per-tool/per-domain toggles are all unchanged and keep composing correctly.
- Group bulk actions work for any future namespaced tool source for free (anything matching `^(plugin|mcp)_` derives a group).

### Negative

- **The settings GET now performs pooled MCP connections.** First Tools open after idle may take up to the MCP connect+retry time; a downed MCP server temporarily drops its tools from the list (stored overrides persist and re-apply on return). The pool is the only cache — no caching layer was added.
- **Live-turn-only tools can't be per-tool-edited from the UI.** `resolve_chat_participant` (needs a ChatRouter-bound resolver unavailable outside a turn) and thread-gated builtins like `lookup_group_history` (need a thread-scoped storage context id, while settings operates on the config-context id) are absent from the displayed list; they still obey domain/risk-tier prefs at runtime.
- **Admin defaults can't enumerate MCP tool names.** They are context- and credential-dependent; admin defaults govern them only via the `mcp`/`plugin` domain rows and the `open-world` risk tier.

### Risks

- **`pluginRegistry` vs `contributionRegistry` "active" view coupling.** `activePluginSegmentMap()` reads `pluginRegistry` active state while the admin catalog reads `contributionRegistry.getActivePluginIds()`. The plugin loader toggles both in lockstep; if that invariant ever changes, the two views of "active plugins" must be reconciled (documented inline in `tool-grouping.ts`).
- **Group membership is point-in-time.** `kind: 'group'` writes overrides for the currently-exposed tools; a plugin/MCP tool that appears later (server returns, plugin enabled) is not retroactively covered by a prior group action — it falls back to the domain/risk/preset baseline. This is the same point-in-time semantics as per-tool toggles.

## Related Decisions

- **ADR-0141: User-Configurable Tool Access (Tool Toggles)** — established the per-context `tool_prefs` model, domains, the settings Tools section, and the per-tool/per-domain toggle kinds this feature extends with `kind: 'group'`.
- **ADR-0204: Admin Default Tool Permissions** — established the admin tool-defaults route and the reserved `__admin_tool_defaults__:<platformInstanceId>` seed context whose dynamic catalog now includes native plugin tools.
- **ADR-0203: Tool Permission Presets** — established the risk-tier presets that plugin/MCP tools (blanket `open-world`) slot into unchanged.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; all eight planned tasks shipped. Core commit messages match the plan.

| File | Role | Evidence |
| --- | --- | --- |
| `src/debug/settings/tool-grouping.ts:11,25-33,40-48,51-57` | Group module: `NAMESPACED_TOOL_RE`, `activePluginSegmentMap`, `deriveToolGroup`, `resolveGroupTools`. | `read` confirms. |
| `src/debug/settings/tools-routes.ts:34-56` | `availableToolNames` async, calls `buildProviderlessToolDescriptors`/`buildToolDescriptors`; provider-`null` returns providerless surface. | `read` confirms. |
| `src/debug/settings/tools-routes.ts:70-89` | `buildDomainView` attaches derived `group` via `deriveToolGroup(name, segmentMap)`. | `read` confirms. |
| `src/debug/settings/tools-routes.ts:142-154,190-223` | `applyGroupToggle` helper + `applyToggle`'s `kind:'group'` branch; 422 on unknown domain/group. | `read` confirms. |
| `src/debug/settings/tools-routes.ts:156-185` | `ToggleBodySchema` discriminated union includes `kind: 'group'`. | `read` confirms. |
| `src/debug/settings/admin/tool-defaults-routes.ts:36-44` | `catalogNames()` = static metadata keys + namespaced native tool names of active plugins (`contributionRegistry`). | `read` confirms. |
| `src/debug/settings/admin/tool-defaults-routes.ts:46-57,102-108` | Admin toggle schema + `kind:'group'` branch. | `read` confirms. |
| `client/settings/fetcher-schemas-tools.ts:22-27` | `ToolEntrySchema` gains `group: z.string().optional()`. | `read` confirms. |
| `client/settings/fetchers.ts:144` | `setToolPermission` input union includes `kind: 'group'`. | `grep` confirms. |
| `client/settings/admin-fetchers.ts:194` | `setToolDefault` input union includes `kind: 'group'`. | `grep` confirms. |
| `client/settings/lib/group-tools.ts:11-27,30-35` | `groupToolEntries` (ungrouped-first, groups sorted) + `groupSummary`. | `read` confirms. |
| `client/settings/sections/ToolsSection.svelte:128-139,277-309` | `onSetGroupPermission` handler + sub-group rendering (group-head pill + bulk button, indented grouped tools). | `read` confirms. |
| `client/settings/sections/ToolsSection.stories.svelte:55-68,77,99` | `Grouped` story: plugin (acp/audio-transcribe) + MCP (search-server) + flat time domains. | `grep` confirms. |
| `tests/debug/settings/tool-grouping.test.ts` | Group-derivation unit tests (builtins ungrouped, MCP server segment, first-`__` split, plugin un-sanitization). | `glob` confirms. |
| `tests/debug/settings/tools-routes-plugin.test.ts:190,207,222` | Plugin `kind:'group'` toggle + 422 on unknown group/domain; per-tool toggle no longer 422. | `grep` confirms. |
| `tests/debug/settings/tools-routes-mcp.test.ts:82,106,115` | MCP GET grouped by server id; `kind:'group'` toggle; MCP build failure degrades to no MCP tools. | `grep` confirms. |
| `tests/debug/settings/admin/tool-defaults-routes.test.ts:315,338,354` | Admin catalog includes active plugin native tools; `kind:'group'` persists; 422 on unknown group. | `grep` confirms. |
| `tests/client/settings/lib/group-tools.test.ts` | `groupToolEntries`/`groupSummary` client-side tests. | `glob` confirms. |
| `docs/architecture/tools.md:22,24` | Admin catalog + runtime-accurate enumeration, grouping, `kind:'group'`, live-turn-only display discrepancies. | `grep` confirms. |
| `docs/architecture/plugins.md:19` | Plugin tools appear individually in settings Tools section per context, grouped per plugin. | `grep` confirms. |

Plan-vs-implementation notes:

- **The client grouping-lib test moved under `lib/`.** The plan placed it at `tests/client/settings/group-tools.test.ts`; shipped at `tests/client/settings/lib/group-tools.test.ts` (mirroring the source path `client/settings/lib/`). Intent and coverage unchanged.
- **The per-context toggle handler was refactored into a pure function.** The plan added an inline `kind: 'group'` branch inside `handleToggle`; shipped extracted `applyToggle()` (`tools-routes.ts:190`) returning a `Response | null`, plus an `applyGroupToggle()` helper (`tools-routes.ts:142`) that returns `{prefs, tools} | null`. Functionally equivalent and cleaner (the validation side-effect is testable without a request); the admin route kept the plan's inline `if/else if` branch shape.
- **The `availableToolNames` display-discrepancy NOTE was broadened.** The plan's NOTE called out only `resolve_chat_participant` (no ChatRouter-bound resolver outside a turn). Shipped (`tools-routes.ts:40-46`) documents a second class: thread-gated builtins like `lookup_group_history` need a thread-scoped storage context id, while settings always operates on the config-context id. `docs/architecture/tools.md:24` documents both. These tools still obey domain/risk-tier prefs at runtime; only per-tool overrides can't be set from the UI.
- **The tools.md update added a latency caveat.** Beyond the plan's literal text, it notes a slow MCP server can delay the settings request (connections are pooled, so only cold requests pay connect latency) — a faithful consequence of the full-fidelity enumeration, not a behavior change.
- **The ToolsSection group-head uses `{@const}` locals (`groupName`/`summary`).** The plan's snippet referenced `toolGroup.group`/`summary` inline; shipped hoists them to `{@const}` block locals for the `data-testid` and handler call. Cosmetic.

The source plan `docs/superpowers/plans/2026-07-02-plugin-mcp-tool-permissions.md` and design `docs/superpowers/specs/2026-07-02-plugin-tool-permissions-design.md` are archived alongside this ADR to `docs/archive/`.

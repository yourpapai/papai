<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin and MCP tool permissions in the settings UI — design

## Problem

Users cannot view or edit `allow`/`ask`/`deny` permissions for plugin-registered tools (`plugin_<id>__<tool>`) or MCP-sourced tools (`mcp_<server>__<tool>`) in the settings-UI Tools section. The permission _engine_ already supports them: `getToolMetadata()` maps `plugin_*` names to domain `plugin` and `mcp_*` names to domain `mcp` (both risk `open-world`), so `resolveToolPermission`, deny-filtering, ask-wrapping, and preset risk tiers all apply at runtime. The gap is purely in the settings surface:

- `availableToolNames()` in `src/debug/settings/tools-routes.ts` builds names with the **sync** `buildTools()`, which contains only built-in tools. Plugin and MCP tools are merged only in the async `buildToolDescriptors()` path (`src/tools/index.ts`). So `GET /settings/api/tools` never returns them and the Tools section never renders them.
- `POST /settings/api/tools/toggle` (`kind: 'tool'`) validates `names.includes(toolName)` and therefore rejects plugin/MCP tools with 422 `unknown tool`.
- Contexts without a task instance get an empty Tools section: `availableToolNames()` returns `[]` when the provider is `null`, even though the runtime exposes providerless builtins and providerless plugin tools there (`buildProviderlessToolDescriptors`).
- The admin "Default tool permissions" route (`src/debug/settings/admin/tool-defaults-routes.ts`) builds its view from the static `TOOL_METADATA` catalog, so plugin tools are invisible there too — even though its per-tool toggle validation (metadata-only) already accepts them.

## Scope

- **In scope**: per-tool permissions in the per-context Tools section for plugin-registered tools, plugin-declared MCP server tools, and user MCP endpoint tools; per-plugin / per-server sub-grouping in the UI with group bulk actions; providerless contexts gaining a runtime-accurate Tools section; admin defaults gaining native plugin tool names.
- **Out of scope**: per-tool risk metadata declared in plugin manifests (today all plugin/MCP tools are blanket `open-world`; possible future work). Admin-default enumeration of MCP-sourced tool names (inherently impossible context-agnostically — see Design §4).

## Approach

Chosen: **full-fidelity enumeration** — the settings route calls the same async assemblers the runtime uses, so the displayed tool surface is exactly the runtime tool surface.

Alternatives considered:

- **A — inline patch in `tools-routes.ts`**: append plugin names by calling registry functions directly from the route. Duplicates eligibility/providerless/collision logic; cannot cover MCP tools at all.
- **B — shared name-only enumerator**: a sync `listPluginToolNames()` helper reused by the routes. Cheap, but MCP tool names cannot be enumerated without connecting to the servers, so MCP would stay invisible.
- **C (chosen) — full fidelity**: reuse `buildToolDescriptors` / `buildProviderlessToolDescriptors`. Covers plugins + MCP with zero duplicated logic; the cost is that the settings GET performs pooled MCP connections (accepted — see trade-offs).

## Design

### 1. Enumeration (`src/debug/settings/tools-routes.ts`)

`availableToolNames()` is rewritten:

```ts
const provider = await safeBuildProvider(contextId)
const options = { storageContextId: contextId, chatUserId: actorUserId, mode: 'normal', contextType }
const toolset =
  provider === null ? await buildProviderlessToolDescriptors(options) : await buildToolDescriptors(provider, options)
return Object.keys(toolset).filter((name) => getToolMetadata(name) !== undefined)
```

- Mirrors runtime exposure exactly: capability/context gating, plugin eligibility (group config-context id), providerless plugin filtering, MCP merge, and name-collision rules all come from the single runtime implementation.
- Provider-`null` contexts now show the providerless surface (builtins like memos/`web_fetch` plus providerless plugin tools) instead of an empty section.
- The existing `chatParticipantResolver` display discrepancy NOTE stays as-is (no resolver outside a chat turn).
- Trade-offs, accepted: the GET connects to MCP servers via the shared `mcpPool` (pooled, idle-evicted, eager connect with single retry; failures degrade to "tools absent", never an error — same as runtime). A downed MCP server means its tools temporarily disappear from the list; their stored overrides persist harmlessly and re-apply when the server returns.

### 2. View grouping (`buildDomainView`)

Naming is uniform across sources: native plugin tools are `plugin_<sanitized-plugin-id>__<tool>` (`namespacedToolName`, `-`→`_`), plugin-declared MCP tools are re-namespaced to the same `plugin_` prefix (`plugin-endpoints.ts`), and user MCP tools are `mcp_<sanitized-server-id>__<tool>` (`sanitizeServerId`).

- Each tool entry in the domain view gains an optional `group` field: for `plugin_*`/`mcp_*` names, the id segment between the prefix and the **first** `__`.
- For the `plugin` domain, the sanitized segment is mapped back to the real plugin id when it matches an active plugin's sanitized id (registry lookup); otherwise the raw segment is used. For the `mcp` domain, the sanitized server id is the label.
- Builtin tools have no `group` (field absent).
- The `ToolDomain` enum and prefs shape are untouched — grouping is display metadata only.

### 3. Toggle route — new `kind: 'group'`

`ToggleBodySchema` gains:

```ts
z.object({
  kind: z.literal('group'),
  permission: z.enum(['allow', 'ask', 'deny']),
  domain: z.string(),
  group: z.string(),
  contextId: z.string().optional(),
})
```

- Resolves all currently exposed tools in that domain whose derived group matches, and applies `setToolPermission` per tool (writing `toolOverrides`; there is no group layer in `tool_prefs`). 422 when the domain is unknown or the group resolves to zero tools.
- Group bulk actions therefore flip the active preset to "Custom" — same as any per-tool override; this is expected.
- Existing kinds are unchanged; per-tool toggles on plugin/MCP names now pass validation because `names` includes them, and `setToolPermission` computes the correct baseline (domain → risk `open-world`).

### 4. Admin defaults route (`admin/tool-defaults-routes.ts`)

- The module-level `CATALOG_NAMES` constant becomes a per-request computation: static `TOOL_METADATA` keys + namespaced **native** tool names of all active plugins (`contributionRegistry`), no per-context eligibility (admin defaults are provider- and context-agnostic).
- MCP-sourced names (user endpoints and plugin MCP servers) are **inherently not enumerable** here — they require per-context config and credentials. Admin defaults govern them via the `mcp`/`plugin` domain rows and the `open-world` risk tier. This is a documented limit, not a follow-up.
- Per-tool toggle validation is already metadata-based and needs no change. The admin view reuses `buildDomainView`, so native plugin tools get `group` fields for free.

### 5. Client (`client/settings/sections/ToolsSection.svelte`, `fetcher-schemas-tools.ts`)

- `ToolEntrySchema` gains `group: z.string().optional()`.
- Inside an expanded domain, tools are rendered in sub-groups by `group` (ungrouped tools render flat first). Each sub-group gets a header row with the group label and a bulk cycle button mirroring the domain-level button, wired to the new `kind: 'group'` toggle.
- Group summary (allow/ask/deny/partial) is computed client-side from the group's tool permissions — pure display, same logic as the server's domain summary.
- `ToolsSection.stories.svelte` gains a story with plugin/MCP grouped domains; screenshots regenerated per the storybook-screenshots workflow.
- The admin Default-tool-permissions section reuses `ToolsSection` and picks up grouping with no extra work.

## Behavior and edge cases

- **Presets** keep working unchanged: plugin/MCP tools remain `open-world`, so `read-only`/`non-destructive` put them in `ask`; per-tool and per-group overrides layer on top.
- **Plugin disabled / ineligible / unapproved, or MCP server removed/down**: its tools disappear from the list (enumeration is runtime-accurate). Stored `toolOverrides` persist harmlessly and re-apply if the source returns. No pruning (prefs already tolerate unknown names).
- **Name collisions**: a plugin/MCP tool whose namespaced name collides with an earlier-merged tool is absent, matching runtime merge order (builtins → MCP → plugin tools).
- **Guest mode**: unaffected — guests bypass `tool_prefs` and `applyGuestReadOnlyFilter` drops plugin/MCP tools (risk ≠ `read`).
- **Scope**: prefs remain stored/read on the config-context id (settings `resolveContextScope` already yields it; `getConfigContextIdFromStorageContextId` is a no-op on config-context ids).
- **Latency**: first Tools GET after idle may take up to the MCP connect+retry time; the section already has a loading state and refresh button. No caching layer is added (the pool is the cache).
- **`resolve_chat_participant` display discrepancy** (existing NOTE) is unchanged.

## Testing

TDD per repo policy; follow local suite patterns (DI-first where supported).

- **Route — per-context** (`tests/` alongside existing tools-routes suites): GET returns `plugin`/`mcp` domains with namespaced names, resolved permissions, and correct `group` fields; provider-`null` context returns the providerless surface; POST `kind: 'tool'` on a plugin/MCP tool persists an override (no 422); POST on a tool not exposed in the context still 422s; POST `kind: 'group'` sets overrides for exactly the group's tools and 422s on empty groups; MCP build failure degrades to "no MCP tools" without erroring the route.
- **View — grouping**: `buildDomainView` unit tests for group derivation (plugin id un-sanitization, mcp server ids, builtins ungrouped, first-`__` splitting).
- **Route — admin defaults**: GET includes active plugins' native tool names; per-tool toggle on a plugin name persists; catalog reflects registry changes per request.
- **Client**: `ToolsSection` story/tests for sub-group rendering and group bulk toggle wiring.

## Documentation updates

- `docs/architecture/tools.md`: plugin and MCP tools are now individually listed/editable per context; admin defaults cover native plugin tools by name and MCP only via domain/risk tiers.
- `docs/architecture/plugins.md`: one line noting plugin tools (native + MCP-declared) appear in the settings Tools section per context.
- `src/tools/CLAUDE.md` / `src/mcp/CLAUDE.md`: only if wiring described there changes (enumeration reuses existing builders, so likely no change).

## Future work

- Plugin-manifest-declared per-tool risk classification (`read`/`write`/`destructive`) instead of blanket `open-world`.
- Optional caching of last-seen MCP tool names to keep them listed (greyed) while a server is down.

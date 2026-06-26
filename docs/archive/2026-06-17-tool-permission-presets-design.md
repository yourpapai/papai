<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool Permission Presets — Design

**Date:** 2026-06-17
**Status:** Approved (pending implementation plan)

## Summary

Add one-click permission **presets** to the Tools section of the settings web UI:
**Read-only**, **Non-destructive**, and **Allow all**. Each preset sets a baseline
permission for every tool by its existing risk class, so an operator can configure a
sensible whole-context posture in one click instead of toggling tools individually.

Presets are **sticky**: the chosen baseline persists as a new risk-default tier in
`tool_prefs`, so tools added later (e.g. a newly-configured MCP server) automatically
follow the preset by their risk level without re-applying.

## Background — current system

- **Model** (`src/tools/tool-preferences.ts`): `tool_prefs` is a JSON blob
  `{ domainDefaults, toolOverrides }`. Permissions are three-state
  `allow | ask | deny`. Resolution: `toolOverrides[name]` → `domainDefaults[domain]`
  → implicit `allow`. `allow`-valued entries are pruned on write. Validation is
  hand-written guards, not Zod.
- **Risk metadata** (`src/tools/tool-metadata.ts`): every built-in tool carries a
  `ToolClassification { domain, operation, risk }` where
  `risk: 'read' | 'write' | 'destructive' | 'open-world'`. `web_fetch` is the only
  `open-world` built-in; all MCP (`mcp_*`) and plugin (`plugin_*`) tools default to
  `open-world`.
- **Application** (`src/tools/index.ts`): `applyToolPreferences` is the final step of
  `makeTools()` — `deny` drops the tool, `ask` wraps it in a runtime permission gate,
  `allow` passes through.
- **UI** (`client/settings/sections/ToolsSection.svelte`): collapsible domain cards;
  per-domain bulk cycle button (allow→ask→deny) and per-tool Allow/Ask/Deny segmented
  controls. Backed by `GET /settings/api/tools` and `POST /settings/api/tools/toggle`
  (`src/debug/settings/tools-routes.ts`); every write returns the full updated view.

## Goals

- Three preset buttons that set a whole-context baseline in one click.
- Sticky: new tools inherit the active preset by risk class.
- Show which preset (if any) is currently active; "Custom" when the config diverges.
- Reuse the existing risk metadata — no new per-tool tagging.

## Non-goals

- No new tool risk classification scheme; presets are derived from existing `ToolRisk`.
- No user-defined/custom presets.
- No change to how `applyToolPreferences` enforces `allow/ask/deny` at runtime.

## Design

### Data model

Extend `ToolPrefs` with a risk-default tier:

```ts
export interface ToolPrefs {
  riskDefaults: Partial<Record<ToolRisk, Permission>> // NEW — the preset layer
  domainDefaults: Partial<Record<ToolDomain, Permission>>
  toolOverrides: Record<string, Permission>
}
```

**Resolution priority** (most specific wins), in `resolvePermission`:

```
toolOverrides[name] → domainDefaults[meta.domain] → riskDefaults[meta.risk] → 'allow'
```

A newly-added tool with no explicit override inherits the preset via its risk class —
this is what makes the mode sticky.

**Backward compatibility:** parsing prefs without a `riskDefaults` field yields
`riskDefaults: {}` (equivalent to no risk layer). Existing legacy upconversion
(`disabledDomains` → `domainDefaults`) is unchanged. `allow`-valued `riskDefaults`
entries are pruned on write, consistent with `domainDefaults`.

### Applying a preset (reset-to-baseline)

Applying a preset **clears `toolOverrides` and `domainDefaults`, then writes
`riskDefaults`**. Rationale: a sticky risk layer fighting leftover per-domain/per-tool
overrides is unpredictable (e.g. "Allow all" would not actually allow all if a stale
`domainDefaults: { task: deny }` survived). After applying, the user may layer
per-domain/per-tool tweaks back on top; those sit above the risk layer per the
resolution order. Because applying discards customizations, the UI confirms first.

New helper in `tool-preferences.ts`:

```ts
applyPreset(prefs: ToolPrefs, preset: ToolPreset): ToolPrefs
// returns { riskDefaults: PRESET_RISK_DEFAULTS[preset], domainDefaults: {}, toolOverrides: {} }
```

### Preset definitions

A single static table (`PRESET_RISK_DEFAULTS` in `tool-preferences.ts`), computed from
`ToolRisk` only — no runtime tool inspection:

| Preset            | read  | write | destructive | open-world |
| ----------------- | ----- | ----- | ----------- | ---------- |
| `allow-all`       | allow | allow | allow       | allow      |
| `non-destructive` | allow | allow | ask         | ask        |
| `read-only`       | allow | ask   | ask         | ask        |

- Excluded tools become `ask` (gated on per-call approval), never `deny` — chosen so
  the bot can still use them with explicit confirmation.
- `allow-all` is equivalently an empty `tool_prefs` (`{}`) and doubles as a
  "reset everything" action.
- **Open-world nuance:** under `read-only`, `web_fetch` and all MCP/plugin tools are
  `open-world`, so they land in `ask`, not `allow` — gated, not freely readable. This
  is the safe reading of "open-world" (arbitrary external surface, unknown
  destructiveness for MCP/plugin) and is intentional.

### API

Extend `POST /settings/api/tools/toggle` (`src/debug/settings/tools-routes.ts`) with a
third `kind`, preserving the one-round-trip pattern (returns the full updated view):

```ts
const ToggleBodySchema = z.object({
  kind: z.enum(['domain', 'tool', 'preset']),
  permission: z.enum(['allow', 'ask', 'deny']).optional(), // unused for preset
  domain: z.string().optional(),
  tool: z.string().optional(),
  preset: z.enum(['allow-all', 'non-destructive', 'read-only']).optional(),
  contextId: z.string().optional(),
})
```

- `kind: 'preset'`: validate `preset` is known (400 otherwise), call `applyPreset`,
  persist via `setToolPrefs`, return the recomputed `{ contextId, domains, activePreset }`.
- CSRF enforcement (`X-Settings-CSRF`) and scope resolution unchanged.

**`GET /settings/api/tools`** response gains `activePreset`:

```ts
activePreset: 'allow-all' | 'non-destructive' | 'read-only' | null
```

`null` ("Custom") whenever `domainDefaults`/`toolOverrides` are non-empty, or
`riskDefaults` matches no preset. Computed by reverse-matching the persisted prefs
against `PRESET_RISK_DEFAULTS`.

### UI

In `ToolsSection.svelte`, add a preset bar above the domain cards:

- Three buttons — **Read-only**, **Non-destructive**, **Allow all** — using existing
  `Btn`/`SegmentedControl` primitives; the button matching `activePreset` shows
  selected, else a "Custom" indicator.
- Clicking opens a small confirm ("This replaces your current per-tool and per-domain
  settings. Continue?"). On confirm → POST `{ kind: 'preset', preset, contextId }`,
  then replace `domains` + `activePreset` from the response.
- A short helper line: "New tools follow the selected preset by their risk level."
- Existing per-domain and per-tool controls are unchanged. Manually editing any
  tool/domain after a preset flips the indicator to "Custom" on the next response
  (overrides become non-empty).

Client schema additions:

- `fetcher-schemas.ts`: `ToolPresetSchema = z.enum(['allow-all','non-destructive','read-only'])`;
  add `activePreset: ToolPresetSchema.nullable()` to `ToolsResponseSchema`.
- `fetchers.ts`: extend the toggle fetcher input to accept the `preset` kind.

## Testing

- **`tool-preferences.test.ts`**
  - `applyPreset` yields the correct `riskDefaults` per preset and clears
    `domainDefaults`/`toolOverrides`.
  - `resolvePermission` priority: `tool > domain > risk > allow`.
  - A synthetic new `open-world` tool inherits the sticky preset (`read-only` → `ask`).
  - Serialize/parse round-trip with the new tier; legacy prefs without `riskDefaults`
    parse to `riskDefaults: {}`.
  - `allow`-valued `riskDefaults` pruned on write.
- **`tools-routes.test.ts`**
  - `kind: 'preset'` for each preset returns the expected view and `activePreset`.
  - `activePreset` reverse-matching: exact match → preset; any override → `null`.
  - Invalid/unknown preset → 400; CSRF still enforced.
- **Client (`tests/client/...ToolsSection`)**
  - Renders the preset bar; highlights `activePreset`.
  - Confirm-gates apply; posts the correct body.
  - Shows "Custom" after a manual toggle.

## Files touched

- `src/tools/tool-preferences.ts` — `riskDefaults` tier, `resolvePermission` order,
  `PRESET_RISK_DEFAULTS`, `applyPreset`, active-preset reverse-match, parse/serialize.
- `src/debug/settings/tools-routes.ts` — `kind: 'preset'`, `activePreset` in GET.
- `client/settings/sections/ToolsSection.svelte` — preset bar + confirm + active state.
- `client/settings/fetcher-schemas.ts` — `ToolPresetSchema`, `activePreset`.
- `client/settings/fetchers.ts` — toggle fetcher input.
- Tests as above.

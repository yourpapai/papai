<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0203: Tool Permission Presets

## Status

Implemented

## Date

2026-06-17

## Context

The per-context tool permission model introduced by ADR-0141 stores a three-state
permission (`allow`/`ask`/`deny`) per tool under the reserved `tool_prefs` config key as
`{ domainDefaults, toolOverrides }`, resolved most-specific-wins
(`toolOverrides[name]` → `domainDefaults[domain]` → implicit `allow`) and applied as the
final step of `makeTools()` via `applyToolPreferences`. ADR-0142 added the `ask` runtime
gate. Configuring a sensible whole-context posture — "don't let the bot delete anything",
"gate every open-world call" — meant toggling tools one by one, and a newly-configured MCP
server or plugin tool landed at implicit `allow` regardless of the operator's intent, since
nothing below the domain tier existed to catch it.

Every built-in tool already carries a static `ToolRisk` class
(`read`/`write`/`destructive`/`open-world`) in `src/tools/tool-metadata.ts`, and all
MCP/plugin tools (`mcp_*`/`plugin_*`) resolve to `open-world`. The 2026-06-17 design
(`docs/superpowers/specs/2026-06-17-tool-permission-presets-design.md`) reused that
metadata — no new tagging — to add one-click permission **presets** (Read-only,
Non-destructive, Allow all) that set a sticky, risk-keyed baseline tier so a later-added
tool inherits the active preset by its risk class. That design is the source of truth for
the architecture described here.

## Decision Drivers

- **One-click posture**: an operator must set a whole-context baseline without per-tool
  toggling, in a single round-trip that returns the recomputed view.
- **Stickiness for new tools**: a preset must persist as a baseline so tools added later
  (a newly-configured MCP server, a future built-in) follow it by risk class without
  re-applying — not just a one-shot bulk edit.
- **Reuse existing metadata**: presets derive from `ToolRisk` only; no new per-tool
  classification scheme, no runtime tool inspection.
- **Honest "Custom" indicator**: the UI must show which preset (if any) matches the
  persisted state, and "Custom" when the config diverges, so a stale preset label never
  misleads.
- **Reset-to-baseline semantics**: applying a preset is a destructive reset of
  per-domain/per-tool tweaks; the UI must confirm before discarding them.
- **Backward compatibility**: existing `tool_prefs` blobs without the new tier, and ~20
  test literals, must keep compiling and parsing without migration.

## Considered Options

### Option 1: A sticky `riskDefaults` tier below `domainDefaults` (chosen)

Add `riskDefaults?: Partial<Record<ToolRisk, Permission>>` to `ToolPrefs`, resolved below
`domainDefaults` (`tool > domain > risk > allow`). Presets write `riskDefaults` and clear
the two upper tiers; `detectActivePreset` reverse-matches against a static
`PRESET_RISK_DEFAULTS` table.

- **Pros**: stickiness is automatic (new tools inherit by risk); one table encodes all
  three presets; resolution stays a single pure function; the field is optional so
  legacy literals and blobs parse unchanged.
- **Cons**: a third tier in the resolution/pruning path; `detectActivePreset` is exact
  reverse-match, so any per-domain/per-tool edit flips the indicator to "Custom" (by
  design, but a user who presets then tweaks one tool loses the preset label).

### Option 2: A one-shot bulk edit that writes `domainDefaults`

Apply a preset by expanding its risk map into per-domain `domainDefaults` entries at apply
time, with no new tier.

- **Pros**: no model change; the existing two-tier resolution is untouched.
- **Cons**: not sticky — a new tool added after the bulk edit inherits implicit `allow`,
  not the preset; `open-world` has no domain to key into (MCP/plugin tools share no single
  domain), so it cannot be represented at the domain tier at all. Rejects the primary goal.

### Option 3: A separate `active_preset` config key

Store the chosen preset name in its own config key and re-derive `riskDefaults` at read
time, instead of persisting `riskDefaults` directly.

- **Pros**: `activePreset` is trivially the stored value; no reverse-match needed.
- **Cons**: two sources of truth (the key and the derived risk map) that can drift if any
  other path mutates `tool_prefs`; `detectActivePreset` cannot report "Custom" without the
  reverse-match anyway; the key would need migration and dual-write during rollout. More
  machinery for no behavioral gain over persisting `riskDefaults` directly.

## Decision

Five coordinated changes implement the architecture.

### 1. `riskDefaults` tier in the preferences model (`src/tools/tool-preferences.ts`)

`ToolPrefs` gains an optional `riskDefaults?: Partial<Record<ToolRisk, Permission>>`. The
field is optional so existing test literals keep compiling; `emptyPrefs`,
`parseToolPrefs` (via a new `parseRiskDefaults` helper mirroring `parseDomainDefaults`),
and `serializeToolPrefs` always materialize it as `{}` when absent, so legacy blobs without
the field parse to `riskDefaults: {}`. `resolveToolPermission` becomes
`toolOverrides[name]` → `domainDefaults[meta.domain]` → `(riskDefaults ?? {})[meta.risk]`
→ `'allow'`. An `isToolRisk` guard (mirroring `isToolDomain`) validates keys on parse.
`pruneRedundantOverrides` and `pruneRedundantDomainDefaults` carry `riskDefaults` through
and compute the baseline risk-awarely, and `cycleTool`/`cycleDomain` thread it through
their constructed objects, so a preset layer survives per-tool/per-domain edits.

### 2. Preset definitions, `applyPreset`, and `detectActivePreset` (`src/tools/tool-preferences.ts`)

A static `PRESET_RISK_DEFAULTS` table (pruned form — `allow` entries omitted) encodes the
three presets from `ToolRisk` only:

- `allow-all`: `{}` (equivalently an empty `tool_prefs`, doubles as "reset everything")
- `non-destructive`: `{ destructive: 'ask', 'open-world': 'ask' }`
- `read-only`: `{ write: 'ask', destructive: 'ask', 'open-world': 'ask' }`

Excluded tools become `ask` (gated on per-call approval), never `deny`, so the bot can still
use them with explicit confirmation. Under `read-only`, `web_fetch` and every MCP/plugin
tool are `open-world`, so they land in `ask` — gated, not freely readable; this is the
intentional safe reading of "open-world" (arbitrary external surface, unknown
destructiveness for MCP/plugin).

`applyPreset(preset)` returns a fresh
`{ riskDefaults: { ...PRESET_RISK_DEFAULTS[preset] }, domainDefaults: {}, toolOverrides: {} }`
— a reset-to-baseline that clears the upper tiers. `detectActivePreset(prefs)` returns
`null` ("Custom") whenever `domainDefaults` or `toolOverrides` are non-empty, else
reverse-matches `riskDefaults` (pruned and compared via `riskDefaultsEqual`) against each
preset in `PRESET_KEYS`. An untouched context therefore reports `allow-all`; any manual edit
flips the indicator to "Custom" on the next response.

### 3. `kind: 'preset'` branch and `activePreset` in the tools route (`src/debug/settings/tools-routes.ts`)

`ToggleBodySchema` becomes a `z.discriminatedUnion('kind', [...])` with three arms
(`domain`, `tool`, `preset`); `permission` stays required on the `domain`/`tool` arms so
the existing "missing permission → 422" behavior is preserved, and the `preset` arm
requires `preset: z.enum(['allow-all','non-destructive','read-only'])` (an unknown value
422s). The `preset` branch calls `applyPreset(body.data.preset)`, persists via
`setToolPrefs`, and logs `Settings tool preset applied`. Both `handleGet` and `handleToggle`
responses gain `activePreset: detectActivePreset(prefs)`. The two local helpers
(`setDomainPermission`/`setToolPermission`) became risk-aware (baseline computed against the
risk tier; `riskDefaults` carried through the returned object). CSRF (`X-Settings-CSRF`) and
scope resolution are unchanged.

### 4. Client schema and fetcher

`ToolPresetSchema = z.enum(['allow-all','non-destructive','read-only'])` and
`activePreset: ToolPresetSchema.nullable().default(null)` on `ToolsResponseSchema` live in
`client/settings/fetcher-schemas-tools.ts` (the per-feature schema split, not the
monolithic `fetcher-schemas.ts` the plan referenced). The `.default(null)` lets existing
mock payloads that omit `activePreset` still parse. `applyToolPreset(input)` in
`client/settings/fetchers.ts` POSTs `{ kind: 'preset', ...input }` and parses the response
through `ToolsResponseSchema`.

### 5. Preset bar in `ToolsSection.svelte`

A preset bar (`data-testid="tools-presets"`) renders the three `PRESET_OPTIONS` as `Btn`s
(primary when matching `activePreset`, else ghost), plus a `Pill` showing the active preset
label or "Custom" (`data-testid="preset-active"`). Clicking a preset sets `pendingPreset`
and surfaces a confirm row (`data-testid="preset-confirm`") — not an immediate POST — with
Apply/Cancel buttons. Confirming calls `applyToolPresetFn` (injectable, defaulting to
`applyToolPreset`, so `AdminToolDefaultsSection` reuses the same UI path for admin
defaults) and replaces `domains` + `activePreset` from the response. A helper line
("New tools follow the selected preset by their risk level.") sits under the bar. Existing
per-domain and per-tool controls are unchanged; a manual edit after a preset flips the
indicator to "Custom" on the next response.

## Consequences

### Positive

- A whole-context posture is one confirmed click, in one round-trip returning the
  recomputed view.
- Presets are sticky: a tool added after a preset (new MCP server, future built-in)
  inherits the baseline by risk class without re-applying — the core goal over Option 2.
- `open-world` is first-class: under `read-only`, `web_fetch` and every MCP/plugin tool
  land in `ask`, closing the "new MCP server → implicit allow" gap that motivated the work.
- `allow-all` doubles as a reset-everything action (clears all three tiers).
- The "Custom" indicator is honest — any divergence from an exact preset match reports
  `null`, so a stale label never misleads.
- Backward compatible: legacy `tool_prefs` blobs parse to `riskDefaults: {}`; the field is
  optional so ~20 test literals kept compiling.

### Negative

- Applying a preset is a destructive reset of per-domain/per-tool tweaks; the confirm step
  is mandatory, and a user who presets then tweaks one tool loses the preset label (by
  design, but it can surprise).
- A third tier in resolution/pruning adds surface area; `cycleTool`/`cycleDomain` and both
  pruners had to be touched to thread `riskDefaults` through.
- `detectActivePreset` is exact reverse-match only — there is no "closest preset"
  suggestion, so a one-key drift from `read-only` reports "Custom" rather than "read-only
  (modified)".
- Excluded tools become `ask`, never `deny`; an operator who wants a hard block must still
  drop to per-tool `deny` overrides on top of the preset.

### Risks

- **Reverse-match drift**: `riskDefaultsEqual` prunes both sides before comparing, so an
  `allow`-valued `riskDefaults` entry (which pruning drops) cannot desync the indicator
  from the stored state. The risk is a future preset added to `PRESET_RISK_DEFAULTS`
  without a matching `ToolPresetSchema`/`PRESET_KEYS` entry, which would make
  `detectActivePreset` return it while the client cannot name it — mitigated by keeping the
  table, the type, the client enum, and `PRESET_KEYS` in one file.
- **Discriminated-union strictness**: the route schema rejects an ambiguous body (e.g. a
  `preset` field on a `kind: 'tool'` body) with 422 rather than ignoring extras — by
  design, but a client sending a legacy single-object body gets a harder error than the old
  loose `z.object` did.

## Related Decisions

- ADR-0141: User-Configurable Tool Access (Tool Toggles) — the `tool_prefs` model and
  per-context `allow`/`ask`/`deny` resolution this ADR extends with the risk tier.
- ADR-0142: Tool `ask` Permission Gate — the runtime confirmation gate that presets
  lean on (excluded tools become `ask`, not `deny`).
- ADR-0204: Admin Default Tool Permissions (planned) — the per-platform-instance admin
  default `tool_prefs` seeded into a context's own prefs; reuses `applyPreset`/`PRESET_RISK_DEFAULTS`
  and the same `applyToolPresetFn` UI path via `AdminToolDefaultsSection`.
- ADR-0220: Config-Unset (planned) — the unset/Clear action on settings config values,
  which the preset "reset-to-baseline" semantics complement.

## Implementation Notes

Key files and confirming symbols (current codebase):

- `src/tools/tool-preferences.ts:17` `ToolPreset`; `:20` `PRESET_RISK_DEFAULTS`; `:26`
  `PRESET_KEYS` (iteration order for `detectActivePreset`); `:30` optional `riskDefaults`
  field; `:38` `emptyPrefs` materializes `{}`; `:56` `isToolRisk`; `:65` risk-aware
  `resolveToolPermission`; `:107` `parseRiskDefaults`; `:124` `parseToolPrefs` return;
  `:276` `applyPreset(preset)` (returns fresh prefs — note the spec sketch's
  `applyPreset(prefs, preset)` was simplified to take only `preset`); `:281`
  `detectActivePreset`.
- `src/debug/settings/tools-routes.ts:81` `activePreset` in `handleGet`; `:119`
  `z.discriminatedUnion('kind', …)`; `:133` `kind: z.literal('preset')`; `:182` preset
  branch (`applyPreset(body.data.preset)`); `:190` `activePreset` in `handleToggle`.
- `client/settings/fetcher-schemas-tools.ts:16` `ToolPresetSchema`; `:17` `ToolPreset`;
  `:33` `activePreset: ToolPresetSchema.nullable().default(null)` on `ToolsResponseSchema`.
- `client/settings/fetchers.ts:13` imports `ToolPreset`/`ToolsResponseSchema` from
  `./fetcher-schemas-tools.js`; `:167` `applyToolPreset`.
- `client/settings/sections/ToolsSection.svelte:30` `PRESET_OPTIONS`; `:37` `presetLabel`;
  `:71` `pendingPreset` reactive state; `:138` `requestPreset`; `:144` `confirmPreset`;
  `:189` `tools-presets` bar; `:200` `preset-active` indicator; `:206` `preset-confirm`
  row; injectable `applyToolPresetFn` (`:48`/`:60`) reused by `AdminToolDefaultsSection`.

**Divergence from the plan:** (1) a `PRESET_KEYS` export (`tool-preferences.ts:26`) was
added beyond the plan's `PRESET_RISK_DEFAULTS` to drive `detectActivePreset` iteration;
(2) the client preset schema landed in `client/settings/fetcher-schemas-tools.ts` (the
per-feature schema split), not the monolithic `client/settings/fetcher-schemas.ts` the plan
referenced — `fetchers.ts` imports from the split file; (3) the spec's `applyPreset(prefs,
preset)` sketch was shipped as `applyPreset(preset)` returning fresh prefs, matching the
plan's implementation step.

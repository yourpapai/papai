# Figma UI kit components

## Why

The Figma mirror (`Editable UI` page, file `o8B8JfxhFeOHqIfpv0eSdZ`) currently maps only 6 base components, while `client/` ships 28 components the design-to-code loop cannot resolve. For every unmapped component, codegen falls back to generic restyled-div sketches and `figma:verify` has no editable Figma counterpart to compare against — so the edit-in-Figma → apply-to-code workflow the kit exists for stops at the base kit.

## What Changes

- Build 28 new Figma components on the `Editable UI` page, mirroring existing code (no `client/` source changes):
  - **Shared (4)**: `shared/Modal`, `shared/Confirm`, `shared/TreeView`, `shared/PropertiesTable` ← `client/shared/*.svelte`
  - **Recurring patterns (5)** promoted from ad-hoc screen frames: `ui/DataTable`, `ui/Select`, `ui/Segmented`, `ui/Pill`, `ui/MetricCard`
  - **Settings (12)**: `SettingsFieldShell`, `SettingsTable`, `SettingsGate`, `SettingsGroupToggle`, `SettingsJumpMenu`, `ConfigFieldRow`, `ProviderForm`, `ProviderModelsEditor`, `RoleBindingBlock`, `PluginCard`, `IdCell`, `VerificationPill` ← `client/settings/components/`
  - **Admin (7)**: `AdminTopBar`, `AdminSidebarPanel`, `StatsPanel`, `SubjectDetail`, `SubjectsTable`, `SubjectStatsPanel`, `AdminJumpMenu` ← `client/admin/components/`
- Register every new component in `scripts/figma/registry.json` (node id, props dictionary, value maps) and push canonical `CODE:` descriptions via `bun run figma:connect plan` + push script.
- Each component exposes Figma variants/properties matching its code `Props` interface (e.g. `ui/Pill` tone variants, `ui/Segmented` allow/ask/deny options), verified by the read-back script (`mismatches: 0`).

No platform/task instances are affected; nothing here touches runtime config, config-context scope, or chat behavior — this is design-tool + registry content only.

## Capabilities

### New Capabilities

- `figma-ui-kit`: Kit coverage contract — the authoritative list of Figma components that must mirror `client/` sources, with registry entries and pushed `CODE:` descriptions, so codegen resolves and verifies every kit component. The existing `figma-codegen-registry` spec already covers registry entry structure/validation/push mechanics; this capability covers *which* components must be mapped and stays separate because coverage grows independently of the mechanics.

### Modified Capabilities

- None. `figma-codegen-registry` requirements are structural and already hold for the new entries; no requirement text changes.

## Impact

- Figma file `o8B8JfxhFeOHqIfpv0eSdZ`, page `18:2` (new component sets/frames) — no edits to existing 6 components, screens, or story pages.
- `scripts/figma/registry.json` (28 new `components` entries).
- Enables `figma-codegen` skill and `bun run figma:verify` for all 28 components; no `client/` code changes, no spec changes for `figma-codegen-skill`/`-verification`.

## Non-goals

- Rebuilding the 5 existing screens or their 13 registered sections from the new components (follow-up change once the kit exists).
- Sections (`client/settings/sections/`, `client/admin/sections/`) and transcript components (`TimelineEvent`, `StatusBanner`, `TranscriptView`) — declined: they compose the kit; registering them before the base kit lands would force rework.
- Design-token/variable migration of the kit (colors and text stay literal, matching current kit style).
- Publishing the file as an org Figma library; the kit remains file-local via MCP.
- Cleaning up the empty `Settings UI — stories` page.
- Any `client/` source refactor, even where codegen reveals drift — drift is reported, not fixed, per the figma-codegen output contract.

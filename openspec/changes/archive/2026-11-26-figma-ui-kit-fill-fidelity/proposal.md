# Figma UI kit fill fidelity

## Why

Nested frames across the kit mirror carry Figma's default white fill where the mirrored app is dark: a programmatic fill scan of the `Editable UI` page (file `o8B8JfxhFeOHqIfpv0eSdZ`) found 69 white-filled containers — 3 in the `ui/PageHeader` component (itself + `Text` + `Action`), 1 in `ui/TopBar` (`Brand`), and 65 across all 5 registered screens (`screen/SettingsApp` 25, `screen/ToolsSection` 19, `screen/MembersSection` 11, `screen/OverviewSection (admin)` 6, `screen/TaskProviderSection` 4). Screenshots confirm the damage: the SettingsApp main area renders as a white block with near-invisible light text, and `ui/PageHeader` is an unreadable white bar. The screens no longer resemble the app they mirror, so visual review and the edit-in-Figma half of the codegen loop are broken for everything composed from them.

## What Changes

- Clear default white fills to transparent on all screen-local structural frames across the 5 registered screens (no geometry, hierarchy, or content edits).
- Fix the 2 affected base-kit components: `ui/PageHeader` (component fill + `Text`, `Action` child frames) and `ui/TopBar` (`Brand` frame) become transparent; the `ui/PageHeader`/`ui/TopBar` instances inside screens update automatically — no per-instance overrides.
- Where a white container actually represents a visible app surface (panel, form field), fill it with the literal surface tone its `client/` source renders (per-token literal from `client/shared/tokens.css`), following the same literal-colors convention the kit already uses.
- White is preserved only where the app itself renders white elements (text fills, icon strokes, badges) — verified per node against the source CSS, never bulk-cleared.
- Re-baseline the preservation audits afterwards: component fills change *deliberately* this time (the two base components), so the fill-unchanged expectations in `figma-ui-kit-backdrops`' audit trail are superseded for exactly those nodes; descriptions, ids, names, variants must still be byte-identical via `plan`/push read-back.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `figma-ui-kit`: adds a fill-fidelity requirement — registered screens and kit components on the `Editable UI` page SHALL NOT carry stray default fills; structural containers are transparent, surface containers carry the app surface literal, and element-colored white stays. The capability's main spec is still pending archive with `figma-ui-kit-components` (extended by `figma-ui-kit-backdrops`); this delta adds to it and must archive after both.

Without this the kit's fidelity contract is incomplete: coverage, registration, and legibility requirements hold while the mirrored screens still render a white-on-dark app that exists nowhere in `client/`.

## Impact

- Figma file `o8B8JfxhFeOHqIfpv0eSdZ`, page `18:2` only: fill edits on 69 existing containers inside 7 registered tops (2 components + 5 screens). No new nodes, no reparenting, no node id/name/variant/`CODE:` description changes; registry untouched; backdrop plates untouched.
- No `client/` source changes; no `scripts/figma/` changes; no docs changes.
- No platform/task instances affected; no config-context scope impact (design-tool presentation only).

## Non-goals

- Any `client/` source change — the code renders correctly; the Figma mirror drifted, not the app.
- Story pages (`Admin UI — stories`, `Settings UI — stories`) and any page other than `Editable UI`.
- The 28 new kit components and the 4 other base components — the scan found zero white fills in them.
- Backdrop plates — stay presentation-only siblings behind components.
- Design-token/variable migration — fills stay literal, matching current kit style.
- New components, section re-composition, or registry entries.

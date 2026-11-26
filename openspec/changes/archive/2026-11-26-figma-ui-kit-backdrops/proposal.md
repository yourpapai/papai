# Figma UI kit backdrops

## Why

Kit components mirror their `client/` sources faithfully, and several sources render with transparent backgrounds (`ui/Select`, `ui/Segmented`, `ui/Pill` neutral/mute tones, `settings/SettingsTable`, data rows). In the real app those components sit on `--bg: #0a0c0a` (near-black, `client/shared/tokens.css`); on the `Editable UI` page they sit on Figma's light default canvas, so dim text on transparent fills is unreadable. Without a fix the kit stays hard to review and edit in Figma — the edit-in-Figma half of the codegen loop is effectively blind for these components.

## What Changes

- Add a labeled backdrop plate behind each kit component set on the `Editable UI` page (file `o8B8JfxhFeOHqIfpv0eSdZ`), filled with the backdrop the component actually renders against in the app (dark `--bg`, or a surface tone where the source expects one).
- Backdrops are presentation-only: sibling frames placed behind components — never fills inside a component, never carrying a `CODE:` description, never translated into code.
- Document the convention (one note each in `docs/architecture/figma-codegen.md` and the `figma-codegen` skill) so agents treat plates as canvas furniture.
- Re-run the preservation audit afterwards: all 34 component descriptions byte-identical to `plan` output (`mismatches: 0`); node ids, variant definitions, and component fills unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `figma-ui-kit`: adds a requirement that kit components be legible in Figma via presentation-only backdrop plates, without altering the mirrored components. The capability's main spec lands with `figma-ui-kit-components` (complete on this branch, pending archive); this change's delta adds to it and must archive after that one.

## Impact

- Figma file `o8B8JfxhFeOHqIfpv0eSdZ`, page `18:2` only: new backdrop frames; zero edits to the 34 kit components (fills, variants, node ids, descriptions) or the 5 screens / 13 sections.
- Docs: `docs/architecture/figma-codegen.md`, `.claude/skills/figma-codegen/SKILL.md` — backdrop note only.
- No registry schema or `scripts/figma/` changes; no `client/` source changes; no platform/task instances affected; no config-context scope impact (design-tool presentation only).

## Non-goals

- Any `client/` source change — transparent backgrounds are correct in code; the components are composed onto page backgrounds there.
- Baking background fills into the components themselves — that would break the "component mirrors its source" premise and show up in codegen reads.
- Changing the Figma page canvas color globally — no single canvas color serves both light and dark components; rejected in favor of per-component plates.
- Design-token/variable migration of the kit (colors stay literal, matching current kit style).
- Backdrops behind the 5 registered screens, 13 sections, or story pages — screens render their own backgrounds like the app.
- Registering backdrops anywhere in `scripts/figma/registry.json` — the registry maps component↔code only.

# Design — Figma UI kit backdrops

## Context

The kit's 34 components mirror `client/` sources, so their Figma fills match the code: components whose CSS is transparent (`background: transparent` / `none` — `ui/Select`, `ui/Segmented`, `ui/Pill` mute/neutral tones, `settings/SettingsTable`, table rows, and others) have no fill. In the app they compose onto `--bg: #0a0c0a` (`client/shared/tokens.css`); on the `Editable UI` page they compose onto Figma's light default canvas. See proposal.md — Why.

Working constraints:

- The kit spec's preservation requirement (and the `figma-ui-kit-components` audit pattern) means component node ids, names, variant/property definitions, fills, and `CODE:` descriptions must not change.
- Kit style is literal colors — no Figma variables exist to reference.
- Registry/plan/push/read-back machinery maps component↔code only and should stay untouched.

## Goals / Non-Goals

**Goals:**

- Every kit component legible on the `Editable UI` page without opening the app or Storybook.
- Zero change to anything the codegen loop reads: components, descriptions, registry, screens/sections.
- A convention agents and humans can recognize at a glance (naming, uniform layout).

**Non-Goals:**

- Restyling components, adding design tokens, or touching `client/` sources.
- Backdrops for screens, sections, or story pages.
- Registry or script changes.

## Decisions

**D1 — Sibling plates behind components, never baked-in fills.** Each plate is a frame placed *behind* the component set as a sibling (component stays parented to the page). Baking a background fill into a component would corrupt the mirror: codegen reads component fills, `get_design_context` surfaces them, and the component would no longer match its source — precisely the drift the kit exists to avoid. A page-level canvas color was rejected because no single color serves both light and dark components. Alternative considered — reparent each component set inside a plate frame: rejected; keeping the page as the parent leaves component paths and selection behavior untouched and removes any reparenting risk.

**D2 — Uniform plating: all 34 kit components get a plate.** Selective plating (only illegible components) requires a per-component legibility judgment that goes stale as tones change, and leaves the page grid irregular. A uniform `--bg` plate behind a self-dark component (e.g. `admin/AdminTopBar`) is visually a no-op but keeps the rule simple and the wall regular. Plate fill per component comes from the audit (D3); default `#0a0c0a`.

**D3 — Plate fills are literal token values from `client/shared/tokens.css`, chosen by audit.** Each component's mapped source CSS determines its effective app backdrop: page `--bg` `#0a0c0a` by default; a surface tone (`--surface-1` `#111512`, `--surface-2` `#171c18`) where the source composes onto a panel. The audit records each choice in the change folder (baseline/post pattern from `figma-ui-kit-components`). Fills stay literal, matching kit style; no variable migration.

**D4 — Plate shape and naming.** One plate per component set: `backdrop/<registry name>` (e.g. `backdrop/ui/Pill`), sized to the set plus uniform padding, with a small text label repeating the component name in `--text-dim` `#828d84`. Frames can't store descriptions, so the name is the only carrier — the `backdrop/` prefix separates plates from kit components in the layers panel and in any name-based lookup. Plates get no registry entries and are excluded from `CODE:` pushing by construction (components only). Not locked: locking blocks canvas selection of the component behind/in front conventions and would friction up editing; the naming convention is the guard.

**D5 — No machinery changes; verification is the existing audit.** `scripts/figma/` and the registry are untouched, so repo-side verification is exactly the preservation audit: `bun run figma:connect validate` (expect `components=34 screens=5 sections=13`), `plan`, live read-back (`mismatches: 0`), plus a node-id resolution check. Doc notes (one each in `docs/architecture/figma-codegen.md` and the skill's procedure step 1) tell agents plates are canvas furniture: sibling frames named `backdrop/*`, never component content, never translated to code. No new tool surfaces, no gating impact; no scope-model impact (no persisted state; nothing keyed by storage/config context, platform instance, or user). No new TS files, so the Write/Edit TDD hook pipeline gates nothing; repo checks are the untouched `figma-connect` suite plus lint/format.

## Risks / Trade-offs

- [Agent mistakes a plate for part of the component] → plates are siblings, not parents; `get_design_context` on a component never includes them; `backdrop/` naming; doc notes in skill and architecture doc.
- [Plate fills drift from real app backgrounds] → fills copied from `client/shared/tokens.css` literals; audit doc records each choice and its source token.
- [Reparenting or z-order fiddling disturbs components] → tasks forbid reparenting; post-audit re-checks all 34 component node ids resolve and read-back is clean.
- [Page clutter / slower canvas from 34 plates] → plates are tight (set + padding), flat fills only; negligible.
- [Archiving before `figma-ui-kit-components`] → ordering note in proposal and tasks; both deltas touch `figma-ui-kit`, and this one's ADDED requirement presumes the capability spec that change creates.

## Migration Plan

Figma-only additive change; no repo state to migrate. Rollback = delete the `backdrop/*` frames; components are never modified, so nothing else to restore. Archive after `figma-ui-kit-components`.

## Open Questions

None material — per-component plate tone is resolved by the audit against `tokens.css`; where a component composes onto more than one backdrop in the app, the page default `--bg` is used and the choice noted in the audit.

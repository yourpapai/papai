# Post-run audit (tasks 2.2, 4.1) — 2026-08-29

Compared against `audit-baseline.md`.

## Headless

- `bun run figma:connect validate` → `status=ok components=34 screens=5 sections=13`
- `bun run figma:connect plan` output is **byte-identical** to the pre-plating plan output (registry untouched, as designed)

## Live read-back vs baseline (file `o8B8JfxhFeOHqIfpv0eSdZ`, page `18:2`)

- All **34/34** component descriptions byte-identical to plan output: **mismatches: 0**
- **0** bounds/type drift: every component's x/y/w/h and COMPONENT vs COMPONENT_SET type unchanged from the baseline table
- **0** reparented components: all 34 still direct children of page `18:2` (plates are siblings, per design D1)
- All **18/18** screen/section node ids resolve with unchanged names
- **34/34** `backdrop/*` plates present; page child count 78 (44 baseline + 34 plates)

## Visual pass (task 2.2)

Page overview plus overlap-true renders of 16 at-risk components (all fully transparent sources, tiny text, or dim `--text-dim` content): `ui/Field`, `ui/PageHeader`, `ui/TopBar`, `shared/TreeView`, `shared/Confirm`, `ui/Select`, `ui/Pill` (incl. transparent neutral/mute tones), `settings/SettingsTable`, `settings/SettingsGate`, `settings/SettingsJumpMenu`, `settings/ConfigFieldRow`, `settings/ProviderForm`, `settings/IdCell`, `settings/VerificationPill`, `admin/StatsPanel`, `admin/SubjectStatsPanel`, `admin/AdminJumpMenu`.

**No exceptions** — every transparent component is legible on its `#0a0c0a` plate; dim text passes.

## Deviations / notes

1. **Pre-existing drift repaired before plating (recorded in baseline)**: `settings/ProviderModelsEditor` (69:91) description was missing its `values:` clause; restored via the skill's canonical push script. Post-audit read-back includes the repair and is byte-identical to plan.
2. **`get_screenshot` overlap quirk (tooling note, not a file issue)**: the MCP `get_screenshot` tool renders a plate node in isolation even with `contentsOnly: false`; overlap-true verification requires the Plugin API's `node.screenshot({ contentsOnly: false })`. Future audits should use the latter for sibling-overlap checks.
3. Z-order spot-checked structurally: every plate sits exactly one index below its component in `page.children` (index 0 = back), i.e. directly behind it.

## Repo checks

- Pre-commit hooks on all three section commits (lint, typecheck, format:check, license-headers) — clean
- Full `bun test` + `bun run typecheck` + `bun run lint` recorded in task 4.2

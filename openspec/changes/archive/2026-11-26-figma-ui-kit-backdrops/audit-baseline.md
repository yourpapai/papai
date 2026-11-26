# Baseline audit (tasks 1.1–1.2) — 2026-08-29

Preserve-check input for the backdrop plating. Method: `bun run figma:connect validate`, `bun run figma:connect plan`, live read-back via `use_figma` (descriptions + bounds of all 34 kit components), resolution check of all 18 screen/section node ids, and a page scan for pre-existing `backdrop/*` nodes.

## Headless

- `bun run figma:connect validate` → `status=ok components=34 screens=5 sections=13`
- `bun run figma:connect plan` → 52 payloads (34 described components, 5 screens, 13 sections), `fileKey: o8B8JfxhFeOHqIfpv0eSdZ` on every payload

## Live read-back (file `o8B8JfxhFeOHqIfpv0eSdZ`, page `18:2` `Editable UI`)

- **Pre-existing drift found and repaired before plating**: `settings/ProviderModelsEditor` (69:91) live description was missing its `values: True→true, False→false` clause vs plan output (stale projection from before the `figma-ui-kit-components` read-back, or edited since). Repaired via the skill's canonical push script; read-back now byte-identical. Recorded here so the post audit's `mismatches: 0` has a documented baseline.
- All **34/34** component descriptions byte-identical to plan output: **mismatches: 0** (after the 69:91 repair)
- All **18/18** screen/section node ids resolve; names unchanged
- **No** pre-existing `backdrop/*` nodes on the page; page child count 44

## Plate fill decision (task 1.2)

Every source composes onto the page background in-app (`background: var(--bg)` — `client/settings/settings.css:173`, `client/admin/admin.css:62`, `client/shared/base.css:13`). Surface tones in the table below are the components' **own** fills, not their backdrops; no source builds itself onto a non-`--bg` panel. Per design D2/D3: **all 34 plates use `--bg` `#0a0c0a`**.

| Component | Own fill (from source `<style>`) | Plate fill |
| --------- | -------------------------------- | ---------- |
| ui/Btn | accent / surface-2 / transparent variants | `#0a0c0a` |
| ui/Input | surface-2 | `#0a0c0a` |
| ui/Field | none (transparent) | `#0a0c0a` |
| ui/PageHeader | none (transparent) | `#0a0c0a` |
| ui/SidebarLink | surface-1 / surface-hover | `#0a0c0a` |
| ui/TopBar | none (transparent) | `#0a0c0a` |
| shared/Modal | none in own style (panel via global css) | `#0a0c0a` |
| shared/Confirm | none in own style (panel via global css) | `#0a0c0a` |
| shared/TreeView | none (transparent) | `#0a0c0a` |
| shared/PropertiesTable | none (transparent) | `#0a0c0a` |
| ui/DataTable | rgba(255,255,255,0.02) rows | `#0a0c0a` |
| ui/Select | surface-2 | `#0a0c0a` |
| ui/Segmented | surface-2 | `#0a0c0a` |
| ui/Pill | *-soft tones; neutral/mute transparent | `#0a0c0a` |
| ui/MetricCard | surface-1 | `#0a0c0a` |
| settings/SettingsFieldShell | surface-1 | `#0a0c0a` |
| settings/SettingsTable | surface-2; rows transparent | `#0a0c0a` |
| settings/SettingsGate | none (transparent) | `#0a0c0a` |
| settings/SettingsGroupToggle | surface-1 / surface-hover | `#0a0c0a` |
| settings/SettingsJumpMenu | none (transparent) | `#0a0c0a` |
| settings/ConfigFieldRow | none (transparent) | `#0a0c0a` |
| settings/ProviderForm | none (transparent) | `#0a0c0a` |
| settings/ProviderModelsEditor | surface-2 | `#0a0c0a` |
| settings/RoleBindingBlock | none (transparent) | `#0a0c0a` |
| settings/PluginCard | surface-1 | `#0a0c0a` |
| settings/IdCell | none (transparent) | `#0a0c0a` |
| settings/VerificationPill | none (*-soft variants) | `#0a0c0a` |
| admin/AdminTopBar | border | `#0a0c0a` |
| admin/AdminSidebarPanel | surface-1 / surface-2 | `#0a0c0a` |
| admin/StatsPanel | none (transparent) | `#0a0c0a` |
| admin/SubjectDetail | surface-2 / surface-1 | `#0a0c0a` |
| admin/SubjectsTable | surface-2 | `#0a0c0a` |
| admin/SubjectStatsPanel | none (transparent) | `#0a0c0a` |
| admin/AdminJumpMenu | none (transparent) | `#0a0c0a` |

## Preservation baseline — component bounds (page `18:2`)

| Component | id | x | y | w | h |
| --------- | -- | - | - | - | - |
| ui/Btn | 19:35 | 200 | 60 | 576 | 26 |
| ui/Input | 22:45 | 200 | 260 | 220 | 28 |
| ui/Field | 22:47 | 520 | 260 | 71 | 139 |
| ui/PageHeader | 22:52 | 900 | 260 | 760 | 43 |
| ui/SidebarLink | 22:62 | 1400 | 260 | 67 | 64 |
| ui/TopBar | 22:65 | 200 | 420 | 1280 | 44 |
| shared/Modal | 50:68 | 4400 | 60 | 480 | 98 |
| shared/Confirm | 50:74 | 5040 | 60 | 420 | 148 |
| shared/TreeView | 51:70 | 5620 | 60 | 128 | 98 |
| shared/PropertiesTable | 50:91 | 5880 | 60 | 132 | 56 |
| ui/DataTable | 57:100 | 4400 | 260 | 680 | 180 |
| ui/Select | 57:87 | 5200 | 260 | 600 | 116 |
| ui/Segmented | 57:88 | 5600 | 260 | 140 | 143 |
| ui/Pill | 57:89 | 6000 | 260 | 58 | 217 |
| ui/MetricCard | 56:123 | 6320 | 260 | 92 | 90 |
| settings/SettingsFieldShell | 62:71 | 4400 | 720 | 480 | 143 |
| settings/SettingsTable | 62:80 | 5000 | 720 | 680 | 110 |
| settings/SettingsGate | 62:125 | 5760 | 720 | 380 | 478 |
| settings/SettingsGroupToggle | 62:126 | 6400 | 720 | 155 | 110 |
| settings/SettingsJumpMenu | 62:112 | 7000 | 720 | 280 | 28 |
| settings/ConfigFieldRow | 62:117 | 7360 | 720 | 480 | 106 |
| settings/ProviderForm | 69:77 | 4400 | 1300 | 480 | 164 |
| settings/ProviderModelsEditor | 69:91 | 5000 | 1300 | 480 | 104 |
| settings/RoleBindingBlock | 69:114 | 5560 | 1300 | 288 | 28 |
| settings/PluginCard | 69:120 | 6060 | 1300 | 420 | 98 |
| settings/IdCell | 69:107 | 6560 | 1300 | 83 | 16 |
| settings/VerificationPill | 69:143 | 6700 | 1300 | 76 | 97 |
| admin/AdminTopBar | 72:95 | 4400 | 1700 | 407 | 42 |
| admin/AdminSidebarPanel | 72:149 | 5240 | 1700 | 280 | 201 |
| admin/StatsPanel | 72:111 | 5600 | 1700 | 480 | 152 |
| admin/SubjectDetail | 72:131 | 6160 | 1700 | 480 | 156 |
| admin/SubjectsTable | 72:164 | 4400 | 2040 | 680 | 66 |
| admin/SubjectStatsPanel | 72:175 | 5200 | 2040 | 360 | 88 |
| admin/AdminJumpMenu | 72:183 | 5640 | 2040 | 280 | 28 |

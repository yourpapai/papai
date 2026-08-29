# Post-run audit (tasks 6.1–6.3) — 2026-08-29

Compared against `audit-baseline.md` (task 1.1).

## Headless

- `bun run figma:connect validate` → `status=ok components=34 screens=5 sections=13`
- `bun run figma:connect plan` → 45 payloads (34 components, 5 screens, 13 sections), `fileKey: o8B8JfxhFeOHqIfpv0eSdZ`

## Live read-back (use_figma, file o8B8JfxhFeOHqIfpv0eSdZ)

- All **34/34** component descriptions byte-identical to plan output: **mismatches: 0**
  (6 base-kit + 28 new kit components)
- All **18/18** screen/section node ids still resolve; names unchanged from baseline
- All **28/28** new components sit on page `18:2` (`Editable UI`)

## Kit components created (node ids)

| Batch | Entries |
| ----- | ------- |
| 1 shared | `shared/Modal` 50:68, `shared/Confirm` 50:74, `shared/TreeView` 51:70, `shared/PropertiesTable` 50:91 |
| 2 patterns | `ui/DataTable` 57:100 (State: Populated/Empty), `ui/Select` 57:87 (State: Default/Open), `ui/Segmented` 57:88 (Value: Allow/Ask/Deny), `ui/Pill` 57:89 (Tone ×6, Dot bool), `ui/MetricCard` 56:123 |
| 3 settings A | `settings/SettingsFieldShell` 62:71, `settings/SettingsTable` 62:80, `settings/SettingsGate` 62:125 (Status ×3), `settings/SettingsGroupToggle` 62:126 (Collapsed True/False), `settings/SettingsJumpMenu` 62:112, `settings/ConfigFieldRow` 62:117 |
| 4 settings B | `settings/ProviderForm` 69:77, `settings/ProviderModelsEditor` 69:91, `settings/RoleBindingBlock` 69:114, `settings/PluginCard` 69:120, `settings/IdCell` 69:107, `settings/VerificationPill` 69:143 (Status ×3) |
| 5 admin A | `admin/AdminTopBar` 72:95, `admin/AdminSidebarPanel` 72:149, `admin/StatsPanel` 72:111, `admin/SubjectDetail` 72:131 |
| 6 admin B | `admin/SubjectsTable` 72:164, `admin/SubjectStatsPanel` 72:175, `admin/AdminJumpMenu` 72:183 |

## 6.3 spot-check (get_design_context → registry translation)

- `ui/Pill` (57:89): `tone` Accent→accent via values map, `label`→children, `dot` bool — no invented props
- `settings/SettingsGroupToggle` (62:126): `label`/`hint`/`collapsed` map 1:1; non-representable `controls`/`onToggle`/`testid` correctly absent
- `admin/AdminTopBar` (72:95): no-props entry matches code (no `interface Props`); nested ui/Segmented, ui/Btn, ui/Pill instances translate through their own entries

## Drift / deviations found during apply

1. **D3a premise stale** (design amended): all 5 pattern components have dedicated files under
   `client/shared/ui/`; entries point at those instead of region files (better for codegen; validate passes).
2. **ui/Segmented built with one variant axis** (`Value`: Allow/Ask/Deny) instead of "option × selected" —
   per D2's variant-explosion cap; code renders a single `value` axis.
3. **Non-representable props omitted** (never invented): Modal `open`/`onClose`, Confirm callbacks,
   TreeView `value`/`depth`, PropertiesTable `obj`, SettingsGate session state (Status variant is
   presentational, unmapped), data/function props on StatsPanel/SubjectDetail/SubjectsTable/PluginCard.
4. **VerificationPill `Label` prop unbound visually** — Figma property references cannot target nested
   instance sublayers; the property still exists and maps to `children` for codegen.
5. **Figma-side fixes**: DataTable data-row default white fill cleared; AdminTopBar counter axis hugged.

## Repo checks

- `bun test tests/scripts/figma-connect.test.ts` → 33 pass / 0 fail (shipped-registry test updated from
  base-kit *equality* to base-kit *presence* + name uniqueness — the change grows the registry by design)
- `bun run lint` → clean; `bun run format:check` → clean

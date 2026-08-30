# Baseline audit (task 1.1) — 2026-08-29

Preservation-check baseline taken before any kit work. Re-run at task 6.1 and compare.

## Headless

- `bun run figma:connect validate` → `status=ok components=6 screens=5 sections=13`
- `bun run figma:connect plan` → 24 payloads (6 components, 5 screens, 13 sections), `fileKey: o8B8JfxhFeOHqIfpv0eSdZ`

## Live read-back (use_figma, file o8B8JfxhFeOHqIfpv0eSdZ)

Component descriptions vs plan output: **mismatches: 0** (checked: 6)

| Node    | Name          | Type          | Description match |
| ------- | ------------- | ------------- | ----------------- |
| 19:35   | ui/Btn        | COMPONENT_SET | ✓                 |
| 22:45   | ui/Input      | COMPONENT     | ✓                 |
| 22:47   | ui/Field      | COMPONENT     | ✓                 |
| 22:52   | ui/PageHeader | COMPONENT     | ✓                 |
| 22:62   | ui/SidebarLink| COMPONENT_SET | ✓                 |
| 22:65   | ui/TopBar     | COMPONENT     | ✓                 |

## Screen/section existence (18/18 resolve)

All on page `18:2` (`Editable UI`, 16 top-level children).

| Node    | Registry name                  | Type  | Lives on     |
| ------- | ------------------------------ | ----- | ------------ |
| 22:198  | screen/SettingsApp             | FRAME | 18:2 (page)  |
| 23:58   | screen/MembersSection          | FRAME | 18:2 (page)  |
| 23:103  | screen/TaskProviderSection     | FRAME | 18:2 (page)  |
| 25:133  | screen/ToolsSection            | FRAME | 18:2 (page)  |
| 25:221  | screen/OverviewSection (admin) | FRAME | 18:2 (page)  |
| 22:206  | Sidebar                        | FRAME | 22:205       |
| 22:248  | Section — profile              | FRAME | 22:247       |
| 22:260  | Section — task-provider        | FRAME | 22:247       |
| 22:275  | Section — tools                | FRAME | 22:247       |
| 23:65   | Add form                       | FRAME | 23:58        |
| 23:73   | DataTable — members            | FRAME | 23:58        |
| 23:110  | Bind form                      | FRAME | 23:103       |
| 23:120  | Provision block                | FRAME | 23:103       |
| 25:140  | Preset row                     | FRAME | 25:133       |
| 25:151  | Domain — TASKS                 | FRAME | 25:133       |
| 25:192  | Domain — WEB                   | FRAME | 25:133       |
| 25:228  | KPI row                        | FRAME | 25:221       |
| 25:249  | Charts                         | FRAME | 25:221       |

Pages in file: `0:1` Admin UI — stories (3 children), `5:2` Settings UI — stories (0 children), `18:2` Editable UI (16 children).

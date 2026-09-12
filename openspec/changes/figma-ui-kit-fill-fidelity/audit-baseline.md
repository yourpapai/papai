# Baseline audit (tasks 1.1–1.2) — 2026-08-29

Preserve-check input and per-node fix inventory for the fill-fidelity fixes. Method: `bun run figma:connect validate`, `bun run figma:connect plan`, live read-back via `use_figma` (descriptions of all 34 kit components), resolution check of all 52 registered node ids (34 components + 5 screens + 13 sections), and a container fill scan over page `18:2` (file `o8B8JfxhFeOHqIfpv0eSdZ`).

## Headless

- `bun run figma:connect validate` → `status=ok components=34 screens=5 sections=13`
- `bun run figma:connect plan` → 52 payloads (34 components, 5 screens, 13 sections), `fileKey: o8B8JfxhFeOHqIfpv0eSdZ` on every payload

## Live read-back (file `o8B8JfxhFeOHqIfpv0eSdZ`, page `18:2` `Editable UI`)

- All **34/34** component descriptions byte-identical to plan output: **mismatches: 0**
- All **52/52** registered node ids resolve; names unchanged (screens carry full `screen/*` names, sections match their registry names)
- Backdrop plates present as `backdrop/*` siblings; untouched throughout this change

## Fill scan — defect set

Predicate (identical for baseline and acceptance): solid paint, `visible !== false`, `opacity > 0.99`, `r=g=b>0.99`, on container nodes inside non-`backdrop/*` page tops. Prior fill on **every** flagged node is exactly `{type: SOLID, color: #FFFFFF, opacity: 1}` (rollback data), with one exception noted below.

**69 stray white paints total: 68 rendered + 1 disabled.** The `ui/PageHeader` component frame (22:52) carries its white paint with `visible: false` — invisible in renders, so the rendered-whites scan reports 68; the paint is still a stray default fill and is removed entirely (proposal's "69" counts it). All flagged nodes are `FRAME` type; no text/vector node is part of the defect set.

## Fix inventory (task 1.2, design D1)

Classification evidence: `client/shared/ui/PageHeader.svelte`, `client/settings/components/SettingsTopBar.svelte`, `SettingsSidebar.svelte` (`.settings-sidebar__badge` = danger outline, no background), `client/shared/ui/SegmentedControl.svelte` (`.ui-seg__opt` = `--surface-2`; `--on` = `--accent`), `client/shared/ui/DataTable.svelte` (resting `<tr>` transparent; hover-only `rgba(255,255,255,0.02)`), `client/shared/ui/Field.svelte` (no background), `client/settings/settings.css` (`.settings-grid`, `.settings-grid__main`, `.settings-form`, `.settings-section`: no background), `MembersSection.svelte` (`.members-add`, `.member-cell`: none), `TaskProviderSection.svelte` (`.settings-field-list`: none), `ToolsSection.svelte` (`.settings-tools__domain` = `--surface-1`; `__presets`, `__domain-head`, `__list`: none), `OverviewSection.svelte` (`.overview__kpis`, `__charts`, `__bars-wrap`: none), `tokens.css` (`--surface-1: #111512`, `--surface-2: #171c18`).

### ui/PageHeader + ui/TopBar (definitions — 4 direct edits)

| id | node | target | evidence |
| -- | ---- | ------ | -------- |
| 22:52 | ui/PageHeader (own fill, paint `visible:false`) | remove paint (`fills = []`) | PageHeader.svelte — no background; backdrops baseline "none (transparent)" |
| 22:53 | ui/PageHeader › Text | transparent | `.ui-page-header__text` — no background |
| 22:56 | ui/PageHeader › Action | transparent | `.ui-page-header__action` — no background |
| 22:66 | ui/TopBar › Brand | transparent | SettingsTopBar.svelte — no background |

### screen-local edits (50 direct)

| top | id | node | target | evidence |
| --- | -- | ---- | ------ | -------- |
| SettingsApp | 22:205 | Grid | transparent | `.settings-grid` — no background |
| SettingsApp | 22:207 | Group — PERSONAL | transparent | sidebar groups — no background |
| SettingsApp | 22:208 | Kicker | transparent | `.settings-sidebar__kicker` — none |
| SettingsApp | 22:211 | Nav | transparent | `.settings-sidebar__nav` — none |
| SettingsApp | 22:222 | Group — GROUP | transparent | sidebar groups — no background |
| SettingsApp | 22:223 | Kicker | transparent | `.settings-sidebar__kicker` — none |
| SettingsApp | 22:226 | Nav | transparent | `.settings-sidebar__nav` — none |
| SettingsApp | 22:237 | Group — ADVANCED | transparent | sidebar groups — no background |
| SettingsApp | 22:238 | Kicker | transparent | `.settings-sidebar__kicker` — none |
| SettingsApp | 22:241 | Group — ADMIN | transparent | `.settings-sidebar__group--danger` — none |
| SettingsApp | 22:242 | Kicker | transparent | `.settings-sidebar__kicker` — none |
| SettingsApp | 22:245 | Badge pill | transparent | `.settings-sidebar__badge` — danger outline, **no background** (mirror's white is wrong) |
| SettingsApp | 22:247 | Main | transparent | `.settings-grid__main` — no background |
| SettingsApp | 22:248 | Section — profile | transparent | `.settings-section` — none |
| SettingsApp | 22:260 | Section — task-provider | transparent | `.settings-section` — none |
| SettingsApp | 22:267 | Bind form | transparent | `.settings-form` — none |
| SettingsApp | 22:275 | Section — tools | transparent | `.settings-section` — none |
| SettingsApp | 22:282 | Tool rows | transparent | `.settings-tools__list` — none |
| ToolsSection | 25:140 | Preset row | transparent | `.settings-tools__presets` — none |
| ToolsSection | 25:145 | Opt — read-only | `#171c18` (surface-2) | `.ui-seg__opt` background — unselected option |
| ToolsSection | 25:147 | Opt — full | `#171c18` (surface-2) | `.ui-seg__opt` — unselected option |
| ToolsSection | 25:151 | Domain — TASKS | `#111512` (surface-1) | `.settings-tools__domain { background: var(--surface-1) }` |
| ToolsSection | 25:152 | Domain head | transparent | `.settings-tools__domain-head` — none |
| ToolsSection | 25:164 | Opt — ask | `#171c18` (surface-2) | `.ui-seg__opt` — unselected (allow is on/accent) |
| ToolsSection | 25:166 | Opt — deny | `#171c18` (surface-2) | `.ui-seg__opt` — unselected |
| ToolsSection | 25:174 | Opt — allow | `#171c18` (surface-2) | `.ui-seg__opt` — unselected (ask is on/accent) |
| ToolsSection | 25:178 | Opt — deny | `#171c18` (surface-2) | `.ui-seg__opt` — unselected |
| ToolsSection | 25:186 | Opt — allow | `#171c18` (surface-2) | `.ui-seg__opt` — unselected (ask is on/accent) |
| ToolsSection | 25:190 | Opt — deny | `#171c18` (surface-2) | `.ui-seg__opt` — unselected |
| ToolsSection | 25:192 | Domain — WEB | `#111512` (surface-1) | `.settings-tools__domain { background: var(--surface-1) }` |
| ToolsSection | 25:193 | Domain head | transparent | `.settings-tools__domain-head` — none |
| ToolsSection | 25:203 | Opt — allow | `#171c18` (surface-2) | `.ui-seg__opt` — unselected (deny is on/accent) |
| ToolsSection | 25:205 | Opt — ask | `#171c18` (surface-2) | `.ui-seg__opt` — unselected |
| ToolsSection | 25:217 | Opt — ask | `#171c18` (surface-2) | `.ui-seg__opt` — unselected (allow is on/accent) |
| ToolsSection | 25:219 | Opt — deny | `#171c18` (surface-2) | `.ui-seg__opt` — unselected |
| MembersSection | 23:65 | Add form | transparent | `.settings-form.members-add` — none |
| MembersSection | 23:66 | Field — user id | transparent | `.ui-field` — no background |
| MembersSection | 23:73 | DataTable — members | transparent | table renders on page bg; row lines via border-bottom |
| MembersSection | 23:79 | Row — Dmitriy | transparent | resting `<tr>` — no background (hover-only tint out of scope) |
| MembersSection | 23:80 | Frame (cell) | transparent | `.member-cell` — none |
| MembersSection | 23:87 | Row — @crabnebula | transparent | resting `<tr>` — no background |
| MembersSection | 23:88 | Frame (cell) | transparent | `.member-cell` — none |
| MembersSection | 23:95 | Row — @mira | transparent | resting `<tr>` — no background |
| MembersSection | 23:96 | Frame (cell) | transparent | `.member-cell` — none |
| TaskProviderSection | 23:110 | Bind form | transparent | `.settings-form` — none |
| TaskProviderSection | 23:111 | Field — task instance | transparent | `.ui-field` — no background |
| OverviewSection | 25:228 | KPI row | transparent | `.overview__kpis` — none |
| OverviewSection | 25:249 | Charts | transparent | `.overview__charts` — none |
| OverviewSection | 25:251 | Bars | transparent | `.overview__bars-wrap` — none |
| OverviewSection | 25:270 | Bars | transparent | `.overview__bars-wrap` — none |

### Instance-internal (15 — no direct edit; resolve via D2 propagation)

`I22:199;22:66` (SettingsApp TopBar Brand); `I22:249;22:53`, `I22:249;22:56`, `I22:261;22:53`, `I22:261;22:56`, `I22:276;22:53`, `I22:276;22:56` (SettingsApp PageHeader ×3); `I23:59;22:53`, `I23:59;22:56` (MembersSection); `I23:104;22:53`, `I23:104;22:56` (TaskProviderSection); `I25:134;22:53`, `I25:134;22:56` (ToolsSection); `I25:222;22:53`, `I25:222;22:56` (OverviewSection-admin).

### Keep-list

Empty. No flagged container keeps its white: the only candidate (Badge pill 22:245) is transparent-with-danger-outline in source. White text/icon fills were never flagged (scan is container-scoped) and are untouched.

## Supersession note (design D4)

The `figma-ui-kit-backdrops` audit froze component fills as unchanged. This change **deliberately** edits fills of 2 registered components (`ui/PageHeader` 22:52–22:56, `ui/TopBar` 22:66) and 50 screen-local containers — **54 direct edits** resolving all 69 stray paints: 53 direct edits clear 68 rendered whites (3 component-definition rows + 50 screen-local rows, the latter plus 15 instance-internal rows clearing via propagation), and the 54th removes 22:52's disabled paint. Post-fix, fill deltas vs this baseline must equal exactly these 54 nodes. Descriptions, ids, names, and variant definitions must remain byte-identical/unchanged.

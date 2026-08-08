<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard UI Audit — Prototype vs. Svelte Implementation

Scope: compare the JSX prototypes in [client/assets/](client/assets/) against the Svelte migration under [client/admin/](client/admin/), [client/debug/](client/debug/), and [client/shared/](client/shared/), and survey the Storybook coverage that is supposed to validate parity.

Severity legend: **HIGH** = visible breakage / missing feature, **MED** = wrong visual identity but functional, **LOW** = polish / API divergence with no obvious user-visible effect.

---

## Status — Primitives Pass (2026-05-26)

The plan at [docs/superpowers/plans/2026-05-26-dashboard-primitives-pass.md](../superpowers/plans/2026-05-26-dashboard-primitives-pass.md) closed the following audit items in 10 commits on branch `fix/dashboard-primitives-pass`:

- §1.2 `.panel` collision — RESOLVED (commit `975dbcef`)
- §1.3 Btn `:hover` styles — RESOLVED (commit `b8f88039`)
- §1.4 Btn `icon` prop — RESOLVED (commit `b79c4de2`)
- §1.5 `Panel.pad`, `KV.v`, `TopBar.statusRow` — RESOLVED (commits `8559a5ee`, `4d189488`, `7916b33b`)
- §1.7 `TreeView` and `PropertiesTable` scoped styles — RESOLVED (commits `79bdf19c`, `cba79ca8`)
- §1.8 `status-success`, `truncation-banner`, `masked-value`, `masked-hint` — RESOLVED (commits `106e451b`, `e8f9342a`)

Out of scope and deferred to follow-up plans: §1.1 token/font parity polish, §1.5 `Input.prefix` and `Shell` composition, §1.5 `Seg.active`, §1.6 rgba border tokens, §1.7 `PanelShell`/`StatusDot`/`Confirm`/`Modal` footer, all of §2 (`/debug` page), all of §3 (`/admin` page), and all of §4 (Storybook coverage).

---

## 1. Cross-cutting / Design System Issues

### 1.1 Token & primitive parity

CSS custom properties in [client/shared/tokens.css](client/shared/tokens.css) map 1:1 to the prototype `T` object in [client/assets/bs-tokens.jsx:5](client/assets/bs-tokens.jsx:5). No color drift at the token layer. The font stack benignly adds `'Fira Code', 'Cascadia Code'` fallbacks.

### 1.2 Parallel panel system creates double-styling

`base.css` defines a legacy `.panel` class with `padding: 8px; border-radius: 2px` ([client/shared/base.css:23](client/shared/base.css:23)). `admin.css` then **overrides** `.panel { padding: 20px; border-radius: 0 }` ([client/admin/admin.css:38](client/admin/admin.css:38)).

Several admin sections (`BillingSection`, `IdentitiesSection`, `GroupsSection`, `MemosSection`, `RemindersSection`, `SystemSection`) wrap themselves in `class="panel"`, so they get 20px padding from CSS while also containing `<Panel>` components from `client/shared/ui/Panel.svelte` which have **no body padding by design**. Result: nested double chrome and inconsistent spacing.

**Action**: pick one. The prototype is unambiguous — `<Panel>` is the only panel primitive; sections never carry the `.panel` class.

Severity: **MED** (cross-cutting structural issue affecting six admin sections).

**✅ RESOLVED** (Task 10, commit `975dbcef`): the `.panel` rule in `admin.css` has been removed and `panel` stripped from the outer `<section>` class of all six admin sections. Interior `<Panel>` components now provide the chrome; outer-section padding hoisted to `.admin-section { padding: 20px }`.

### 1.3 Btn primitive has no hover styles

[client/shared/ui/Btn.svelte](client/shared/ui/Btn.svelte) defines all five variants (primary/secondary/ghost/danger/outline) and three sizes correctly, but no `:hover` rule exists. The prototype specifies hover colors for all variants ([client/assets/bs-tokens.jsx:108-114](client/assets/bs-tokens.jsx:108)).

Severity: **HIGH** (every button in the app feels dead).

**✅ RESOLVED** (Task 1, commit `b8f88039`): `:hover:not(:disabled)` rules added for all five variants.

### 1.4 Btn missing `icon` prop

Prototype Btn accepts an `icon` slot rendered before children ([client/assets/bs-tokens.jsx:107](client/assets/bs-tokens.jsx:107)). Svelte implementation only accepts `children`. Several debug-panel headers want the icon-prefix style.

Severity: **MED**.

**✅ RESOLVED** (Task 2, commit `b79c4de2`): `icon?: Snippet` prop added; rendered before children inside `.ui-btn__icon`.

### 1.5 Input / KV / Shell / TopBar API drift

| Primitive          | Prototype                                                                  | Implementation                                        | Severity |
| ------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| `Input.prefix`     | string/JSX child                                                           | Svelte snippet — callers must `{#snippet prefix()}`   | MED      |
| `KV.v`             | any node (Pills used in design-system anatomy)                             | `string \| number` only                               | MED      |
| `Shell`            | accepts `page`, `statusRow`, `secondaryRow` and composes TopBar internally | accepts a `topBar` Snippet (composition externalised) | MED      |
| `Shell` min-height | `100%`                                                                     | `100vh` (overflows in nested layouts)                 | LOW      |
| `TopBar.statusRow` | optional                                                                   | required Snippet, errors if not passed                | MED      |
| `Panel.pad` prop   | numeric padding for body                                                   | missing                                               | MED      |
| `Seg.active` prop  | `active`                                                                   | renamed to `value`                                    | LOW      |

**Partial resolution** (primitives-pass plan, 2026-05-26):

- `KV.v` — **✅ RESOLVED** (Task 4, commit `4d189488`): now `string | number | Snippet`.
- `TopBar.statusRow` — **✅ RESOLVED** (Task 5, commit `7916b33b`): now optional; wrapper omitted when absent.
- `Panel.pad` — **✅ RESOLVED** (Task 3, commit `8559a5ee`): `pad?: number` prop applies inline padding to the body.
- `Input.prefix`, `Shell` composition / min-height, `Seg.active` — deferred to a follow-up plan.

### 1.6 Untokened rgba literals

Hardcoded `rgba(…, 0.3)` border colors in [Pill.svelte:54–69](client/shared/ui/Pill.svelte:54) and [Btn.svelte:79](client/shared/ui/Btn.svelte:79). Values match the prototype but should be promoted to tokens (`--accent-border`, `--warn-border`, `--danger-border`, `--info-border`) to stop drift.

Severity: **LOW**.

### 1.7 Conflicting shared components

| Component                                | Issue                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PanelShell.svelte` + `.panel` CSS       | parallel panel implementation; `letter-spacing: 0.05em` vs proto `0.08em`, title color `fg3` vs proto `fg2`                                                      |
| `StatusDot.svelte`                       | renders `●` text with class names that exist nowhere; conflicts with `Dot.svelte` + `Pill.svelte`                                                                |
| `PropertiesTable.svelte`                 | ✅ RESOLVED (2026-05-30 visual sweep): renders correctly with type-coloured cells; no tree-\* class drift observed                                               |
| `TreeView.svelte`                        | Story decorator padding missing — top rows clipped at iframe edge. Fixed in the visual-bugs fix series; see docs/design/dashboard-visual-bugs-2026-05-30.md §2.8 |
| `Confirm.svelte` / `Modal.svelte` footer | plain `<button>` instead of `<Btn>` — no shared variant styling                                                                                                  |

The TreeView is the engine behind the entire `TurnDetail` rail (see § 2.7), so its unstyled state is the visible problem there.

Severity: **HIGH** for TreeView/PropertiesTable (used in user-facing detail rails). **MED** for the rest.

**Partial resolution** (primitives-pass plan, 2026-05-26):

- `TreeView.svelte` — **✅ RESOLVED** (Task 8, commit `79bdf19c`): scoped `<style>` block added covering all referenced `tree-*` classes.
- `PropertiesTable.svelte` — **✅ RESOLVED** (Task 9, commit `cba79ca8`): scoped `<style>` block added covering `tree-empty`, `tree-container`, `tree-table`, `tree-key-cell`, `tree-value-cell`.
- `PanelShell.svelte`, `StatusDot.svelte`, `Confirm`/`Modal` footer — deferred to a follow-up plan.

### 1.8 Undefined CSS classes referenced by components

Found by scanning admin components — classes referenced with no matching CSS rule:

| Class                         | Used in                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `status-success`              | [CredentialsForm.svelte:110](client/admin/components/CredentialsForm.svelte:110) — saved-credentials feedback unstyled |
| `truncation-banner`           | [SubjectDetail.svelte:46](client/admin/components/SubjectDetail.svelte:46)                                             |
| `masked-value`, `masked-hint` | [CredentialsForm.svelte:86–87](client/admin/components/CredentialsForm.svelte:86)                                      |

Severity: **HIGH** for `status-success` (user-visible after every save). **MED** for the rest.

**✅ RESOLVED** (primitives-pass plan, 2026-05-26):

- `status-success` and `truncation-banner` — Task 6, commit `106e451b`: defined in `client/shared/base.css`.
- `masked-value` and `masked-hint` — Task 7, commit `e8f9342a`: defined in `client/admin/admin.css`.

---

## 2. /debug page

### 2.1 Page layout — broken grid spans + double padding

Prototype uses an inner grid where the left and right rails declare `gridRow: 'span 2'` to flank a center column ([client/assets/bs-debug.jsx:156,172](client/assets/bs-debug.jsx:156)). Impl loses the span declaration in [debug.css:1026–1041](client/debug/debug.css:1026). Layout collapses to single-row.

Additionally, `Shell` adds `padding: 16px` and the inner grid declares its own `padding: 16px` ([Shell.svelte:34](client/shared/ui/Shell.svelte:34) + [debug.css:1031](client/debug/debug.css:1031)) — outer canvas is 32px padded.

Severity: **HIGH**.

### 2.2 Six of six panels bypass `<Panel>`

`SessionsList`, `TraceList`, `TurnsPanel`, `NotificationsPanel`, `ToolFailuresPanel`, `LiveContextCard` are all built with raw `<section>` + hand-rolled CSS classes instead of using `client/shared/ui/Panel.svelte`. They duplicate (badly) the title bar, count badge, action slot, and header styling that the primitive already encodes.

Severity: **MED** (causes the per-panel divergences below).

### 2.3 SessionsList / SessionCard

| Issue                                          | Proto                                                              | Impl                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Active card lacks `accentSoft` background tint | [bs-debug-sessions.jsx:19](client/assets/bs-debug-sessions.jsx:19) | [debug.css:219](client/debug/debug.css:219)                              |
| Active Dot indicator missing                   | [bs-debug-sessions.jsx:24](client/assets/bs-debug-sessions.jsx:24) | [SessionCard.svelte](client/debug/components/SessionCard.svelte)         |
| No `<Panel>` wrapper / no search action button | [bs-debug-sessions.jsx:5](client/assets/bs-debug-sessions.jsx:5)   | [SessionsList.svelte:15](client/debug/components/SessionsList.svelte:15) |

Severity: **HIGH**.

### 2.4 TraceList

- Status `Dot` (ok/error) absent on trace rows ([TraceList.svelte:30](client/debug/components/TraceList.svelte:30)).
- Extra `user` field rendered; duration shown in seconds instead of ms; tokens shown input-only.
- `TraceDetail` section `<h4>` is 14px — should be the 10px Caption style ([debug.css:716](client/debug/debug.css:716) vs [bs-tokens.jsx:248](client/assets/bs-tokens.jsx:248)).

Severity: **HIGH** for missing status dots; **MED** for the rest.

### 2.5 TurnsPanel

The most degraded panel.

| Issue                                       | Proto                                                        | Impl                                                                 |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Status-count action pills in header missing | [bs-debug-turns.jsx:12](client/assets/bs-debug-turns.jsx:12) | [TurnsPanel.svelte:41](client/debug/components/TurnsPanel.svelte:41) |
| Column-header row missing                   | [bs-debug-turns.jsx:19](client/assets/bs-debug-turns.jsx:19) | TurnsPanel.svelte                                                    |
| Status rendered as text, not `<Pill dot>`   | [bs-debug-turns.jsx:43](client/assets/bs-debug-turns.jsx:43) | [TurnsPanel.svelte:62](client/debug/components/TurnsPanel.svelte:62) |
| Tool pills absent (count-only)              | [bs-debug-turns.jsx:47](client/assets/bs-debug-turns.jsx:47) | [TurnsPanel.svelte:64](client/debug/components/TurnsPanel.svelte:64) |
| Error rows lack `dangerSoft` background     | [bs-debug-turns.jsx:40](client/assets/bs-debug-turns.jsx:40) | TurnsPanel.svelte                                                    |
| `msgs` count column absent                  | [bs-debug-turns.jsx:46](client/assets/bs-debug-turns.jsx:46) | TurnsPanel.svelte                                                    |

Severity: **HIGH** (panel is structurally unrecognisable next to prototype).

### 2.6 LogExplorer

- 4-column grid rows replaced by flat row ([bs-debug-logs.jsx:119–130](client/assets/bs-debug-logs.jsx:119) vs [debug.css:360](client/debug/debug.css:360)).
- Active-filter chip bar above the list missing ([bs-debug-logs.jsx:84](client/assets/bs-debug-logs.jsx:84)).
- Custom `FilterSelect` dropdowns degraded to native `<select>` ([LogExplorer.svelte:63](client/debug/components/LogExplorer.svelte:63)).
- Search match highlighting missing.
- Log body lacks `--inset` background; row separator changed from dashed to zebra striping.

Severity: **HIGH** for grid+chip bar; **MED** for the rest.

### 2.7 TurnDetail — entire structured layout replaced by raw TreeView

Prototype shows a structured KV layout: scope / status / startedAt / msgCount KV rows, routing section, tokens with embedded `<Spark>` sparkline ([bs-debug-turn-detail.jsx:39–97](client/assets/bs-debug-turn-detail.jsx:39)). Impl shows `<TreeView>` of the raw object ([TurnDetail.svelte:12](client/debug/components/TurnDetail.svelte:12)).

Spark.svelte and Bars.svelte exist in `client/shared/ui/` but are not imported anywhere in `client/debug/`.

Severity: **HIGH**.

### 2.8 LiveContextCard

Identity mappings section, authorised groups section, message-cache big-number display, refresh `⟳` action button — all absent ([bs-debug-context.jsx:18–80](client/assets/bs-debug-context.jsx:18)).

Severity: **HIGH**.

### 2.9 NotificationsPanel / ToolFailuresPanel

- Notifications: `scope` field not rendered, 2-column grid layout absent ([bs-debug-notifications.jsx:14](client/assets/bs-debug-notifications.jsx:14)).
- Failures: duration `<Pill>` absent, `reason·turn` 3-column grid absent ([bs-debug-failures.jsx:18](client/assets/bs-debug-failures.jsx:18)).

Severity: **HIGH** for the failure pill; **MED** otherwise.

---

## 3. /admin page

### 3.1 Sidebar

| Issue                                                                                                                                       | Severity | Reference                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Section id `credentials` → renamed `system` (label "System") merges credentials with environment summary into one panel                     | MED      | [bs-admin-sidebar.jsx:18](client/assets/bs-admin-sidebar.jsx:18) vs [AdminSidebarPanel.svelte:26](client/admin/components/AdminSidebarPanel.svelte:26) |
| Section id `identity` → renamed `identities`; nav labels Title Case vs proto lowercase (mono-uppercase styling)                             | LOW      | [bs-admin-sidebar.jsx:22](client/assets/bs-admin-sidebar.jsx:22)                                                                                       |
| Per-section count badges (billing `8`, memos `32`, reminders `7`, identity `4`, groups `4`) missing                                         | MED      | [bs-admin.jsx:151](client/assets/bs-admin.jsx:151)                                                                                                     |
| Active state background `accentSoft` → impl uses opaque `--raised`                                                                          | MED      | [bs-admin-sidebar.jsx:20](client/assets/bs-admin-sidebar.jsx:20) vs [AdminSidebarPanel.svelte:84](client/admin/components/AdminSidebarPanel.svelte:84) |
| Quick stats: 5 items (DM/Groups/Active 24h with green/Active 7d/Storage) → 3 items (DM/active/tools `—`); `Active 24h` green accent missing | MED      | [bs-admin.jsx:160](client/assets/bs-admin.jsx:160)                                                                                                     |
| Hover background added in impl (`--raised`) — proto has none                                                                                | LOW      | [AdminSidebarPanel.svelte:75](client/admin/components/AdminSidebarPanel.svelte:75)                                                                     |
| Sidebar grid width 180px → 220px                                                                                                            | LOW      | [admin.css:140](client/admin/admin.css:140)                                                                                                            |

### 3.2 TopBar

| Issue                                                                    | Severity |
| ------------------------------------------------------------------------ | -------- |
| `admin dl@papai` identity label missing from status row                  | HIGH     |
| Back link rendered as `<a>` instead of `<Btn variant="ghost" size="sm">` | LOW      |
| Window options `'24h'` → `'1d'`                                          | MED      |
| Refresh button variant `outline` → `ghost`                               | LOW      |

### 3.3 Overview section

Major structural collapse.

- **MetricCard tile design completely absent** — prototype uses 26px huge-number tiles with caption and optional sparkline; impl uses flat `<KV>` rows ([bs-admin-helpers.jsx:18](client/assets/bs-admin-helpers.jsx:18) vs [OverviewSection.svelte:87](client/admin/sections/OverviewSection.svelte:87)). **HIGH**.
- **AdminGrowthPanel (bar chart + 3 date axis labels) replaced by a sparkline** with no axis labels. **HIGH**.
- **AdminSurfaceMixPanel (memos/recurring/deferred/instructions adoption progress bars) missing entirely**. **HIGH**.
- KPI count: 4 → 5 with `tokens` tile dropped and `storage`+`active 30d` added. **MED**.
- `SectionHeader` (label + subtitle) replaced by single inline panel title. **MED**.

### 3.4 Billing section

- "export csv" action button missing from header ([bs-admin.jsx:228](client/assets/bs-admin.jsx:228)). **MED**.
- Section wrapped in `.panel` which double-pads against inner `<Panel>` chrome (see §1.2). **MED**.
- Table column layout differs (`160px 1fr 80px 110px 110px 80px 80px` → standard HTML table); `id` column dropped; tokens shown as combined "in/out" strings; no per-column right-alignment ([bs-admin-billing-table.jsx:8](client/assets/bs-admin-billing-table.jsx:8) vs [SubjectsTable.svelte:29](client/admin/components/SubjectsTable.svelte:29)). **HIGH**.
- Table header row: prototype 10px / 600 / uppercase / `inset` bg; impl plain `<th>` with only fg2 color. **HIGH**.
- Numeric columns not right-aligned ([admin.css:107](client/admin/admin.css:107)). **HIGH**.
- Selected-row highlight (`accentSoft` bg + 2px accent border + bold name) missing. **HIGH**.
- DM/group type `<Pill>` replaced by plain text. **MED**.
- Token values not locale-formatted (raw integers). **MED**.
- **SubjectDetail**: per-role mini-card grid (main/small/embedding) replaced by HTML expandable table; expand-to-JSON behaviour added with no prototype reference. **HIGH**.
- **AdminToolCallsPanel missing entirely** (success-rate, sparkline, top-tools list) — replaced by `SubjectStatsPanel` showing anonymous stats that don't belong in the billing slot. **HIGH**.

### 3.5 Stats section

- **AdminActiveSubjectsPanel** (3 tiles × 28px big numbers) → flat `<dl>` ([bs-admin-active-subjects.jsx:6](client/assets/bs-admin-active-subjects.jsx:6)). **HIGH**.
- **AdminStoragePanel** (big number + unit) → `<dl>`. **MED**.
- **AdminDistributionsPanel** (8-column right-aligned stats table for memos/recurring/messages/attachments per subject) → only memos shown as `<dl>` ([bs-admin-distributions.jsx](client/assets/bs-admin-distributions.jsx)). **HIGH**.
- Section duplicates window selector locally instead of using the global TopBar `<Seg>`; the two are not state-synced. **MED**.
- Extra elements not in prototype: `identityMix.byProvider`, `webFetches.topHosts` keyed-hash list. **LOW**.

### 3.6 Records / Reminders / Access split

The prototype has two combined sections:

- "records" = Memos + Recurring + Deferred (`1.2fr 1fr` grid)
- "access & identity" = Identity + Groups (`1fr 1fr` grid)

The impl flattens these into five sidebar entries (Memos, Reminders, Identities, Groups, plus a `reminders` rollup). The combined `SectionHeader` framing is lost.

Severity: **MED**.

### 3.7 Memos / Recurring / Deferred — card lists become forms+tables

All three prototype panels show **auto-displayed card lists** with rich row chrome:

- Memos: user · when (fg3), summary (fg), tags as `<Pill tone="mute">`, dim id.
- Recurring: title + on/off `<Pill>` (accent dot vs warn dot), user · next-run, rrule in fg4 mono.
- Deferred: user + fireAt as `<Pill tone="info" dot>`, prompt text.

Impl forces the user to enter an ID/filter first, then renders a plain HTML table.

Severity: **HIGH** (different UX paradigm).

Missing actions: "archive selected" button (memos), "+ authorize" button + per-row "revoke" (groups).

### 3.8 Identity & Groups

- Identity prototype shows all rows auto in a grid (user / provider·login / method `<Pill>` / right-aligned confidence). Impl requires per-user/provider lookup → single-mapping `<dl>`. **HIGH**.
- `methodTone` (`unmatched→mute`, `manual_nl→info`) Pill mapping → plain text. **MED**.
- Confidence: prototype right-aligns with accent-or-fg4 dash; impl is plain text. **LOW**.
- Groups: per-row danger `revoke` button missing; "+ authorize" missing. **MED**.

### 3.9 Credentials / System

- Section split: prototype `llm credentials` is its own section with warn-pill action; impl merges into a "System" section that also shows an environment summary. **MED**.
- `DEBUG_TOKEN` notice: warn `<Pill dot>` → plain `<p>`. **MED**.
- Per-credential `required` accent `<Pill>` missing. **MED**.
- Credential value inset code-well (`inset` bg + hair border + `4px 10px` padding) → plain `<span>`. **MED**.
- **Masked API key bug**: prototype shows truncated `****d2a0` in fg3 within inset well; impl exposes the actual value from the API response in `<code class="masked-value">` plus a `(hidden)` span. The `****` prefix is not applied. **HIGH** (potential disclosure concern depending on what `state.value` actually carries).
- "edit" button is plain `<button>` not `<Btn variant="secondary" size="sm">`. **LOW**.
- Extra Environment summary block is not in prototype. **LOW**.

---

## 4. Storybook coverage

Setup: `@storybook/svelte-vite`, `addon-svelte-csf`, `addon-a11y`, `msw-storybook-addon`. Global preview parameter is only `layout: 'fullscreen'`; no viewport, no theme, no padding decorator. Schema validation runs at boot but only covers `BillingSubject`, `GlobalStats`, `SubjectStats`.

### 4.1 Component coverage

Every `.svelte` component has a matching `.stories.svelte` — 1:1 mapping is complete. The problem is **variant depth**, not breadth.

### 4.2 Prototype scenarios are not wired up

[client/assets/bs-scenarios-data.jsx](client/assets/bs-scenarios-data.jsx) and [client/assets/bs-scenarios-admin-data.jsx](client/assets/bs-scenarios-admin-data.jsx) define rich scenario sets (typical/empty/overflow/storm/incident/degraded/allPaused/lowConfidence/whale/coldStart/…) — **no story file imports either of them**. Stories use ad-hoc factory fixtures (`makeBillingSubject`, `makeGlobalStats`, …) and miss every stress case the prototype documents.

### 4.3 Sections stuck in form-shell

`GroupsSection`, `IdentitiesSection`, `MemosSection`, `RemindersSection` each have exactly one story — the empty lookup form. None of the populated/empty/error/overflow states the prototype defines are exercised. This is partly because [client/stories/stubs/intersection-observer.ts](client/stories/stubs/intersection-observer.ts) is installed globally and the sections lazy-fetch on intersection, which never fires in Storybook.

### 4.4 Missing MSW scenarios

`scenarios.ts` exports `billing-loading` but not `admin-loading` or `stats-loading` even though handlers for both exist in `handlers.ts:68`. Consequence:

- `SystemSection`, `OverviewSection`, `StatsSection`, `StatsPanel`, `SubjectStatsPanel`, `AdminApp` have **no loading-state story**.
- `StatsPanel`, `StatsSection`, `AdminApp` have **no error-state story**.

### 4.5 AdminSidebarPanel always renders empty stats

`fixturesLoader` resets `adminGlobals.data = null` and `AdminSidebarPanel.stories.svelte` never sets `refreshGlobals: true`, so every story shows `KV k="DM" v="—"`. Prototype shows `32 / 4 / Active 24h: 4 (green)`. The sidebar quick-stats UI is therefore never reviewable in isolation.

### 4.6 Stories that miss documented states

| Component            | Missing scenarios (per prototype)                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `SessionsList`       | allActive, overflow, single                                                                                             |
| `TraceList`          | allErrors, slow                                                                                                         |
| `TurnsPanel`         | allRunning, toolHeavy                                                                                                   |
| `LogExplorer`        | filter-active (level/scope dropdowns open), allErrors view, debugOnly view                                              |
| `LiveContextCard`    | busy (6 identities, 7 groups, 4 pending), pending (unmatched + pending cache)                                           |
| `NotificationsPanel` | storm (7 simultaneous typing)                                                                                           |
| `ToolFailuresPanel`  | storm (repeated tool)                                                                                                   |
| `SubjectDetail`      | truncated banner branch ([SubjectDetail.svelte:45](client/admin/components/SubjectDetail.svelte:45)); incident scenario |
| `FailureDetail`      | `validation`, `tool_timeout` errorTypes                                                                                 |
| `LogDetail`          | error level, debug level                                                                                                |
| `CredentialsForm`    | partial-config (some keys set), saving, server-error                                                                    |

### 4.7 Dead capabilities

- `sseSeed` parameter wired into [client/stories/decorators/withFixtures.ts:53–55](client/stories/decorators/withFixtures.ts:53) — no story uses it; live-update behaviour is unreviewable.
- No `viewport` presets, so panel-overflow / narrow-screen issues can't be caught.
- No theme toggle decorator despite tokens being colour-themed.

---

## 5. Severity Roll-up

### HIGH (visible breakage)

1. **§1.3** Btn has no `:hover` styles — every button feels dead.
2. **§1.7** `TreeView` / `PropertiesTable` reference undefined CSS classes — TurnDetail rail is the visible casualty.
3. **§1.8** `status-success` CSS class undefined — every successful credential save renders unstyled.
4. **§2.1** /debug grid loses `gridRow: span 2` + double-padded canvas — layout collapses.
5. **§2.3** Active session card missing accent tint and Dot indicator.
6. **§2.4** Trace rows missing status Dots.
7. **§2.5** Turns panel structurally unrecognisable (no status counts, no column header, no Pill status, no tool pills, no error tint, no msgs column).
8. **§2.6** LogExplorer rows aren't a 4-col grid, no active-filter chip bar, no `--inset` body.
9. **§2.7** TurnDetail = raw TreeView; structured KV + routing + Spark all gone.
10. **§2.8** LiveContextCard missing identity mappings, authorised groups, message-cache panel, refresh button.
11. **§2.9** ToolFailures panel: duration Pill missing.
12. **§3.2** Admin TopBar missing `admin dl@papai` identity label.
13. **§3.3** Overview tiles regressed to KV rows; Growth chart now sparkline w/o axis labels; SurfaceMix panel entirely missing.
14. **§3.4** Billing table broken: HTML `<table>`, no column widths, no right-aligned numerics, no selected-row highlight, no Pill type column, no formatting; SubjectDetail per-role tiles replaced by JSON expander; AdminToolCallsPanel missing.
15. **§3.5** Stats panels (active-subjects tiles, storage big-number, distributions table) replaced by flat `<dl>`s.
16. **§3.7** Memos / Recurring / Deferred forced behind a lookup form instead of auto-displayed card lists.
17. **§3.8** Identity panel forced behind lookup form; loses pill+confidence visual grammar.
18. **§3.9** Masked credential display does not actually mask with `****` prefix.

### MED

Sidebar count badges, sidebar active background token, quick-stats coverage; six debug panels bypass `<Panel>`; `.panel` CSS conflicts with `Panel` component; record/access section grouping flattened; numerous missing action buttons (export csv, archive selected, + authorize, revoke); TopBar window options; per-pill tones in memos/recurring/identity/deferred; credentials `required`/source/inset-well visuals; DEBUG_TOKEN warn pill; section h4 sizing; etc.

### LOW

Nav label casing; sidebar grid width; `Seg.active` → `value` rename; rgba border literals lacking tokens; hover backgrounds added where prototype has none; `Shell` 100vh vs 100%; Btn icon-prop missing; KV.v node type narrowed.

---

## 6. Recommended Next Steps

1. **Stop the bleeding on primitives** — fix Btn hover, restore Panel.pad / Btn.icon, broaden KV.v to Snippet, make TopBar.statusRow optional. These unlock cleaner section rewrites.
2. **Kill the `.panel` CSS class** in admin.css; migrate the six sections to use the `<Panel>` component exclusively (resolves §1.2 and most of §3.4 / 3.5).
3. **Fix TreeView / PropertiesTable styling** — they are the actual blockers behind TurnDetail looking broken; this is one CSS file's worth of work.
4. **Wire the prototype scenarios** into Storybook (import `bs-scenarios-data.jsx`/`bs-scenarios-admin-data.jsx` data into the existing factories) so the typical / overflow / storm / incident states become reviewable.
5. **Add the missing MSW scenarios** (`admin-loading`, `stats-loading`) and prime `adminGlobals` in sidebar stories so they aren't always empty.
6. **Rewrite the four card-list panels** (memos / recurring / deferred / identity) — they're currently fundamentally the wrong UX pattern, not a styling delta.
7. **Restore the missing helpers** (`MetricCard`, `SectionHeader`) and the four missing admin panels (`AdminGrowthPanel`, `AdminSurfaceMixPanel`, `AdminToolCallsPanel`, `AdminDistributionsPanel`, `AdminActiveSubjectsPanel`, `AdminStoragePanel`) — these are the biggest structural gaps in Overview/Billing/Stats.
8. **Fix the credential masking** (§3.9 #5) — verify whether `state.value` is ever the raw secret; if so, this is also a security finding.

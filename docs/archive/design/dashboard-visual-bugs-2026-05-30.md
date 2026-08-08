<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Visual Bugs — Prototype vs Storybook (2026-05-30)

Page-level screenshot comparison between the JSX prototypes in [client/assets/](../../client/assets) and the Svelte implementation served by Storybook.

Companion documents:

- Code-level audit: [docs/design/dashboard-ui-audit.md](dashboard-ui-audit.md)
- Screenshot methodology / setup: [docs/design/dashboard-prototype-vs-storybook-screenshot-plan.md](dashboard-prototype-vs-storybook-screenshot-plan.md)

Setup used to produce these findings:

- Assets static server: `bunx serve client/assets -p 5174` (configured in [.claude/launch.json](../../.claude/launch.json))
- Storybook: `bun storybook` on port 6006
- Capture: Claude Preview MCP at viewport widths 1280–1500
- Comparison: side-by-side visual inspection (no pixel-diff tooling)

Severity legend:

- **HIGH** — visibly broken or unusable; blocks shipping the page
- **MED** — wrong identity / wrong layout, but recognizable
- **LOW** — polish drift, secondary alignment, typography

---

## 1. Prototype pages captured

| Artboard                  | Spec (W × H) | Render                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ds-spec` — Design system | 1280 × 1560  | ✅ renders cleanly. Phosphor-green accent on near-black canvas; JetBrains Mono throughout; status pills, segmented controls, metric cards, sparkline + bars, dense table all visible.                                                                                                                                                                                                                                              |
| `debug-page` — `/debug`   | 1440 × 1500  | ✅ renders cleanly. 3-column layout: SESSIONS rail + LLM TRACE under it (left), TURNS / NOTIFICATIONS / TOOL FAILURES / LOG EXPLORER stack (center), TURN · DETAIL / CONTEXT stack (right).                                                                                                                                                                                                                                        |
| `admin-page` — `/admin`   | 1440 × 2780  | ✅ renders, but the prototype clips content with `overflow: hidden` while the actual content is 3239px tall. The "llm credentials" section at the bottom is **invisible without unclipping** (a `DesignCanvas` bug — content height exceeds artboard height; the design needs to grow to ~3260h). Once unclipped, sections render correctly: overview, billing, stats, distributions, records, access & identity, llm credentials. |

Artboard #1 has a **horizontal scrollbar artifact at the bottom** — `DesignCanvas` inner cards seem to size 1px wider than their frame.

---

## 2. Critical findings (Storybook vs prototype)

These are visible breakages in the live UI. They are ordered by severity.

### 2.1 [HIGH] `OverviewSection` is structurally broken

**✅ RESOLVED (dashboard visual-bugs fix series):** Overview rebuilt with MetricCard/Bars/SurfaceMix composition matching the prototype tile layout.

Story: `admin-sections-overviewsection--populated`. Viewport 1280×900.

**Prototype** shows:

- Four bordered metric cards in one row: `SUBJECTS 36 / 32 dm · 4 group`, `LLM CALLS 1,089 / 892 main · 197 small`, `TOOLS 4,390 / 4,184 ok · 206 fail`, `TOKENS 2.41M / 1.92M in · 487K out`.
- A `SUBJECT GROWTH · 30D` panel containing a bar chart with x-axis labels `apr 22 … may 7 … may 21`.
- A `SURFACE MIX` panel with horizontal progress bars (memos 28/32, recurring 19/32, deferred 12/32, instructions 31/32).

**Implementation** renders:

- Metric labels collapsed onto **one thin horizontal text line** with no card chrome, no large numerals, no inline secondary stats. `subjects 16 active DMs 12 llm calls 42 tool calls 30 storage 2.6 MB` flows as a single row of small text.
- The sparkline area is a **single tiny green sliver** in the bottom-left corner.
- The Surface-mix / bar-chart area renders as **one solid, full-width, ~30px-tall green rectangle**. No bars, no labels.
- Below the cards row, the rest of the section is empty (no SURFACE MIX panel at all).

Root cause hypothesis: `OverviewSection.svelte` calls `<Bars>` / `<Spark>` with either a non-array `data` prop or a single-value dataset; `<Bars>` then degenerates into one bar at 100%. Metric cards are not wrapped in `<Panel>` / `<Shell>` chrome.

Action: rewire metrics through metric-card primitives (or new ones); pass real array data to `<Bars>`; restore the SURFACE MIX panel.

### 2.2 [HIGH] `StatsSection` ships completely unstyled

**✅ RESOLVED (dashboard visual-bugs fix series):** Stats rebuilt with MetricCards+DataTable+tool-calls panel replacing the raw HTML form.

Story: `admin-sections-statssection--populated`.

The story renders as **raw HTML**:

- `<select>` (browser default) for the window picker — should be a `<Seg>` segmented control like the prototype's `1d | 7d | 30d`.
- `<button>Refresh</button>` is a browser-default button — should be `<Btn variant="secondary">`.
- Headings are bare `<h3>` / `<h4>` (`Subjects`, `Storage`, `Identity mix`, `Surface mix`, `Distributions`, `Top hosts`, `Top tools`).
- Body text is a flowing top-down list with single values on consecutive lines (`DM total / 12 / Group total / 4 / Active 1d / 7d / 30d / 3 / 8 / 12`) — no table chrome, no panels, no columns.

**Prototype** shows three discrete panels:

- `ACTIVE SUBJECTS` — three metric cards `1D · 4`, `7D · 7`, `30D · 7`.
- `STORAGE` — two metric cards `SQLITE · 184 MB`, `S3 ATTACHMENTS · 100 MB`.
- `DISTRIBUTIONS` — dense table with columns `N / MIN / P50 / P90 / P99 / MAX / MEAN` and rows `memos / subject`, `recurring / subject`, `messages / subject`, `attachment bytes / sbj`.

Action: replace the section body wholesale. This is the largest single visual delta in the admin surface.

### 2.3 [HIGH] `AdminApp` integration shows raw forms for 6 sections

**✅ RESOLVED (dashboard visual-bugs fix series):** Six form sections wrapped in Panel/Seg/Btn/DataTable composition matching the prototype chrome.

Story: `admin-adminapp--default`, full-page screenshot at 1500×3360.

Observed in the live page (top → bottom):

| Section                          | Implementation status                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar                          | ✅ renders close to prototype                                                                                                                                                   |
| Window seg + refresh             | ✅ basically correct                                                                                                                                                            |
| Sidebar (sections + quick stats) | ✅ renders, but quick-stats values appear on the wrong row                                                                                                                      |
| OverviewSection                  | ❌ broken — see §2.1                                                                                                                                                            |
| BillingSection (`Billing`)       | ❌ raw text rows; subject / type / counts run together with no table, no padding, no panel                                                                                      |
| StatsSection                     | ❌ raw HTML — see §2.2                                                                                                                                                          |
| MemosSection                     | ❌ bare `User ID` input + State dropdown + `Load` button — no memo cards, no `MEMOS · ACTIVE` panel header, no tag pills                                                        |
| RemindersSection                 | ❌ same shape as memos: bare `User ID` input + `Load` button; no recurring-task cards / no deferred-prompts table from the prototype                                            |
| IdentitiesSection                | ❌ bare `User ID` + `Provider` dropdown + `Load` button; no identity-mapping table                                                                                              |
| GroupsSection                    | ❌ just a `Refresh` button — no authorized groups list, no `+ authorize` action, no per-row metadata                                                                            |
| InstancesSection                 | ⚠ shows two tables (Platform Instances / Task Instances / Admins) but `request failed with status 404` banner above them; the form inputs are browser defaults; no panel chrome |
| PluginConfigSection              | ⚠ `Refresh` button + `request failed with status 404` banner. No plugin list.                                                                                                   |
| SystemSection                    | ⚠ shows the credential rows in a sub-table, but the section heading is unstyled, and a `Refresh` button precedes them as browser-default chrome                                 |

Action: every `*Section` listed above needs the prototype's panel + table + metric-card composition. This is by far the largest workload.

### 2.4 [HIGH] `Plugin Config` and `Plugin/Stats` fixtures missing — 404 banners visible in screenshots

**✅ RESOLVED (dashboard visual-bugs fix series):** pluginConfig+instances MSW handlers added so every AdminApp-touched endpoint returns deterministic fixture data.

`admin-adminapp--default` and `admin-sections-statssection--populated` both display literal `request failed with status 404` text inside the story body. The MSW handlers wired in [client/admin/AdminApp.stories.svelte](../../client/admin/AdminApp.stories.svelte) and the stats stories don't cover the `/api/plugin-config` and `/stats/global` endpoints (or do but with the wrong response shape).

Action: add MSW handlers to the existing `withFixtures` decorator (or per-story `parameters.msw.handlers`) so every endpoint the AdminApp touches returns deterministic fixture data. Until this lands, both Pass A catalog screenshots and any future regression baselines will be unstable.

### 2.5 [MED] `TURNS` panel column set is reduced

**✅ RESOLVED (dashboard visual-bugs fix series):** TurnsPanel restored to 6-column DataTable (TIME/STATUS/SCOPE/DURATION/MSGS/TOOLS) matching the prototype.

DebugApp story `debug-debugapp--populated` at 1500×1600:

**Prototype** TURNS panel has columns `TIME | STATUS | SCOPE | DURATION | MSGS | TOOLS` with status pills (`running` / `error` / `ok` / `cancelled`), durations in ms, tools listed as pill chips per row.

**Implementation** TURNS panel renders only `time · status pill · scope-as-text · "N tools"` in a denser one-line row, no DURATION column, no MSGS column, no per-tool chip list. Each row has a `logs` button on the right.

Action: align column set with prototype, or document the intentional divergence.

### 2.6 [MED] DebugApp sessions sidebar text bleeds across rows

**✅ RESOLVED (dashboard visual-bugs fix series):** SessionCard line-bleed CSS fixed with correct line-height and list-item padding.

In the populated DebugApp screenshot, each session row should render as:

```
tg:1001
history: 12 · facts: 3 · summary: yes
config: 2 keys
```

But the rendered output mixes lines from adjacent sessions vertically (`tg:1001` row's `config: 2 keys` line appears separated from the rest of that block). This is a tight-line-height / list-item-padding issue in `SessionCard.svelte`, not a data issue — the same fixture renders correctly in the standalone `debug-components-sessioncard` story.

### 2.7 [MED] No `default` story for DebugApp

**✅ RESOLVED (dashboard visual-bugs fix series):** DebugApp story renamed to Default, matching the AdminApp counterpart.

Story registry under `debug-debugapp--*` contains only `populated`, `detail-selected`, `disconnected-empty`. There is no `default`. The AdminApp counterpart has `default`. This is a story-naming inconsistency the catalog harness will hit.

### 2.8 [LOW] `TreeView` clips top rows at the iframe edge

**✅ RESOLVED (dashboard visual-bugs fix series):** TreeView story padding added (20px container) so top rows are no longer clipped at the iframe edge.

`shared-treeview--nested-object` at 800×600 renders the type-coloured tree (orange numbers, green-ish strings, dim brackets) but the first two rows (`id: 1`, `ok: true`) and the root key `payload:` are sliced by the iframe edge — story container appears to have a negative top margin or starts at y<0. The prototype audit (§ 1.7 of `dashboard-ui-audit.md`) called this "visually broken" because of missing `tree-*` classes — that claim now looks **outdated**: type-coloured separators do render, just inside a viewport with bad padding.

Action: add `padding: 20px` to the story decorator wrapping `TreeView`.

### 2.9 [LOW] Audit claim about `PropertiesTable` is outdated

**✅ RESOLVED (dashboard visual-bugs fix series):** Audit claim corrected — PropertiesTable row updated to reflect it renders correctly with type-coloured cells.

The audit calls this component "visually broken" (§ 1.7). The story `shared-propertiestable--default` actually renders cleanly: two-column layout (label / value), type colouring, collapsible array/object cells with `▼ [` / `▼ {` markers, retries / lastError sub-rows. Recommend updating the audit to drop this from the active list.

### 2.10 [LOW] DesignSystem has no Storybook equivalent

**⏸ DEFERRED:** authoring a DesignSystem story was decided out of scope; see the design spec §4.6.

The `bs-design-system.jsx` page — palette / typography / spacing / status pills / buttons / table / charts / layout / rules — is **prototype-only**. There is no `shared/DesignSystem.stories.svelte` or equivalent. This makes it impossible to verify token / primitive parity in Storybook (the only way to check is to walk the per-primitive stories one at a time, which is what the audit already does on a per-row basis).

Action (optional, depends on user §6 answer): author a synthetic story that mirrors the prototype's layout using only existing Svelte primitives.

---

## 3. Mapping table — page-level

| Prototype artboard       | Storybook story             | Verdict                                                                         |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| `ds-spec` (DesignSystem) | _none_                      | **MISSING** — author one                                                        |
| `debug-page` (DebugPage) | `debug-debugapp--populated` | renders but **TURNS columns reduced**, sessions rail row-bleed                  |
| `admin-page` (AdminPage) | `admin-adminapp--default`   | **6 sections render as raw HTML**; OverviewSection & StatsSection are the worst |

---

## 4. Recommended fix order

Smallest-effort-highest-impact first. Each bullet is sized as "tackle in a single PR".

1. **Fix `OverviewSection`** (§2.1) — restore metric-card chrome, pass real array data to `<Bars>`, restore `SURFACE MIX` panel. This single change is the most visible win because OverviewSection is the first thing every admin user sees.
2. **Fix `StatsSection`** (§2.2) — replace raw HTML with `<Panel>` / metric-card / table composition. This unblocks the credentials-section read-down because users scroll past stats to reach system.
3. **Fix the six raw-HTML sections** (§2.3) — Billing, Memos, Reminders, Identities, Groups, System. Likely a shared cause (these sections each missing their `<Panel>` wrappers + table primitive use).
4. **Add MSW handlers for `/api/plugin-config` and `/stats/global`** (§2.4) — required before any further screenshot pass can be baseline-quality.
5. **Restore TURNS column set in `TurnsPanel.svelte`** (§2.5) — minor but recognizable.
6. **Add padding to TreeView story decorator** (§2.8) — one-line fix.
7. **Decide on DesignSystem story authoring** (§2.10) — only if you want token regression coverage.
8. **Update `dashboard-ui-audit.md`** — drop PropertiesTable from "broken" list (§2.9); confirm TreeView claim is about padding, not tree-class drift.

The §2.1 + §2.2 + §2.3 work is the body of the "fix critical visual bugs" phase. Once those land, the codebase is ready for the next-phase work the user mentioned (e2e testing, component testing, screenshot regression testing).

---

## 5. What this pass did not do

So you know what's still uncovered:

- **Per-scenario matrix** (`scenarios.html`). Only page-level (`backstage.html`) was screenshotted. The 33-file scenarios prototype contains typical / empty / burst / overflow / edge variants per panel that have not yet been compared individually. Recommend doing Pass B after §2.3 lands, so most stories render at all first.
- **Pixel-diff**. No tooling installed; comparison was visual only.
- **Inspect-style verification of colors / fonts / sizes**. `preview_inspect` can confirm token values per element; not run because every difference above is structural, not chromatic.
- **Responsive widths**. Captured at 1280–1500 only. Mobile / tablet untested.
- **Interactive states** (hover, focus, active). Static screenshots only.

---

## 6. Reproducibility

Anyone can rerun this pass:

```bash
# Terminal A
bun storybook            # http://localhost:6006

# Terminal B
bunx serve client/assets -p 5174 -L
# http://localhost:5174/backstage.html — prototype catalog
# http://localhost:5174/scenarios.html — scenario matrix
```

Then drive Claude Preview against the matching iframe URLs:

- `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story`
- `http://localhost:5174/backstage.html` (scroll to each `.dc-card`)

For the admin artboard, override `overflow: hidden` on the third `.dc-card` via DevTools / `preview_eval` to capture the credentials section.

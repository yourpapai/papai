<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Prototype vs Storybook — Screenshot & Visual-Diff Plan

Companion to [docs/design/dashboard-ui-audit.md](dashboard-ui-audit.md). That document is a code-level audit. This document scopes the **visual** audit: what is needed to render the JSX prototypes and the Svelte/Storybook implementation side-by-side, screenshot them, and produce a diff report.

Author note (research only): the audit below identifies blockers and required setup. No screenshots have been captured yet — see § 6 for why and § 7 for what unblocks them.

---

## 1. What exists today

### 1.1 Prototypes (the "design truth")

- Location: [client/assets/](../../client/assets)
- 33 files, ~3.3k LOC of JSX.
- Two HTML entry points:
  - [client/assets/backstage.html](../../client/assets/backstage.html) — full pages: `DesignSystem`, `DebugPage`, `AdminPage` rendered inside fixed-width artboards (1280 / 1440 / 2780h).
  - [client/assets/scenarios.html](../../client/assets/scenarios.html) — per-component scenario matrix (typical / empty / overflow / burst / error variants) at fixed widths (mostly 300w).
- Stack: React 18 + ReactDOM 18 + `@babel/standalone` loaded from `unpkg.com`. JSX files are loaded as `<script type="text/babel">`. No build step.
- Fonts: JetBrains Mono via Google Fonts CDN.
- Tokens: a global `T` object defined in [client/assets/bs-tokens.jsx](../../client/assets/bs-tokens.jsx) (~310 LOC; mirrors `tokens.css`).
- Fixture data: `window.SCENARIOS` / `window.SCENARIOS_ADMIN` set by [client/assets/bs-scenarios-data.jsx](../../client/assets/bs-scenarios-data.jsx) and [client/assets/bs-scenarios-admin-data.jsx](../../client/assets/bs-scenarios-admin-data.jsx).

### 1.2 Implementation (the "code truth")

- Svelte 5 components under [client/admin/](../../client/admin), [client/debug/](../../client/debug), [client/shared/](../../client/shared).
- Built for production via `bun build:client` → `public/`.

### 1.3 Storybook

- Config: [.storybook/main.ts](../../.storybook/main.ts), [.storybook/preview.ts](../../.storybook/preview.ts), [.storybook/preview-head.html](../../.storybook/preview-head.html).
- Framework: `@storybook/svelte-vite` v9; addons: `@storybook/addon-svelte-csf`, `@storybook/addon-a11y`, `msw-storybook-addon`.
- Story files discovered via glob `../client/**/*.stories.svelte` — **52 stories** today, breakdown:
  - `client/shared/ui/*` — 13 (Btn, Pill, Panel, Shell, TopBar, KV, Input, Seg, Select, Bars, Caption, Dot, HR, Spark).
  - `client/shared/*` — 6 (Confirm, Modal, PanelShell, PropertiesTable, StatusDot, TreeView).
  - `client/debug/components/*` — 15.
  - `client/admin/{components,sections,AdminApp}` — 17.
- `storybook:prepare` script concatenates `base.css + tokens.css + admin.css + debug.css` into `public/storybook-base.css` so stories pick up the shipped CSS.
- Run: `bun storybook` on port 6006.

### 1.4 Existing audit

[docs/design/dashboard-ui-audit.md](dashboard-ui-audit.md) already enumerates structural & token-level drift items (§ 1.1–1.8, plus the open § 2 `/debug` and § 3 `/admin` page sections, and § 4 Storybook coverage gaps). The visual sweep in this plan is intended to **verify** and **extend** that audit with rendered evidence per artboard/scenario.

---

## 2. Tooling that is available right now

- **Claude Preview MCP** (`mcp__Claude_Preview__preview_*`) — starts servers defined in `.claude/launch.json`, takes JPEG screenshots, inspects CSS, resizes the viewport (presets: `mobile`, `tablet`, `desktop`; custom width/height supported), can also `eval`, `click`, `fill`, dump `console_logs` and `network`. Screenshots are returned to the agent as compressed JPEGs.
- **Storybook v9** dev server (already wired).
- **Bun** (`bun --hot`, can also serve static dirs through a tiny script).
- **MSW** for network mocking inside stories (already a story addon).

Tooling that is **not** in the repo:

- No Playwright / Puppeteer / Chromatic / Storybook test runner. No baseline image store. No pixel-diff library (`pixelmatch`, `odiff`, `reg-cli`) and no screenshot assertion suite.
- No `http-server` / `serve` style dev dependency. Bun does not serve `client/assets/` automatically.
- No `.claude/launch.json` in this repo (Claude Preview cannot be started without one).

---

## 3. Blockers to capturing prototype screenshots

These must be fixed before any screenshot of the prototype is possible:

### 3.1 `design-canvas.jsx` is referenced but does not exist

Both [backstage.html:32](../../client/assets/backstage.html#L32) and [scenarios.html:31](../../client/assets/scenarios.html#L31) load `design-canvas.jsx`. Grep confirms the file is missing from the working tree, never committed, and the JSX is consumed via `<DesignCanvas>`, `<DCSection>`, `<DCArtboard>` (visible in `backstage.html` lines 78–95 and `scenarios.html` lines 86+). Opening either page today renders nothing past the Babel error.

Severity: **blocking**. Until restored, the prototypes cannot be rendered at all.

Minimum reproducible contract (inferred from call sites):

- `DesignCanvas({ title, subtitle, children })` — outer chrome with section TOC.
- `DCSection({ id, title, subtitle, children })` — collapsible/anchored section.
- `DCArtboard({ id, label, width, height, children })` — fixed-width frame mirroring a viewport. `width` is in CSS pixels; the canvas seems to use `transform: scale()` to fit screens but a minimal version without scaling is enough for capture.

A ~80-line replacement is enough to render. The work is small (one new JSX file) but **must be authored** because no git history of the original exists.

### 3.2 The prototype HTML is not served

Opening `client/assets/backstage.html` via `file://` works for the Babel-in-browser pipeline only if all sibling `.jsx` files load via relative `src=`. That works in Chrome, but Claude Preview drives a server, not a `file://` URL. We need a tiny static server (`bunx serve client/assets -p 5174`, or a 20-line `Bun.serve` script, or `python3 -m http.server` rooted at `client/assets/`).

### 3.3 External CDN dependence

`unpkg.com` (React, ReactDOM, Babel standalone) and `fonts.googleapis.com` (JetBrains Mono). Capture environments without network will render broken layouts (no font, no Babel → empty body). Two options:

- Accept the network dependency and document it.
- Vendor these into `client/assets/vendor/` (recommended for stability and CI reproducibility).

### 3.4 Stable initial state

Several scenario JSX modules use timestamp-relative phrasing ("3m ago", "now"). To diff reliably we need a frozen clock or a sentinel `Date.now`. Simplest: a `?freezeAt=…` query param honored by `bs-admin-helpers.jsx` / `bs-debug-*` helpers (one new utility), or just accept that "Nm ago" labels will fluctuate and exclude those bands from pixel diff.

---

## 4. Blockers to capturing Storybook screenshots

Lower-risk; mostly already in place:

### 4.1 `bun storybook:prepare` must run before screenshot

`public/storybook-base.css` is concatenated at prepare time. If a story screenshot runs before prepare, tokens are missing and panels render bare. The `storybook` script chains them, so this is fine as long as the screenshot harness invokes `bun storybook`, not `storybook dev` directly.

### 4.2 SSE / network state

Some stories (notably `DebugApp`, `DebugDetailRail`, `LogExplorer`, `SessionsList`) depend on streaming or fetch responses. MSW is wired (`msw-storybook-addon`); we need to confirm each story declares parameters/handlers, or pins a fixture via [client/stories/decorators/withFixtures.ts](../../client/stories/decorators/withFixtures.ts). Stories that still hit live SSE would screenshot empty.

Survey results (52 stories, by file): every story file is present, but a subset needs an MSW/decorator audit before they screenshot deterministically. This audit is part of § 7.4 below.

### 4.3 Viewport

Storybook defaults to a flexible canvas. Prototype artboards are fixed-width (300, 1280, 1440). For parity we must drive Storybook through `preview_resize` at the matching width per story before screenshot.

---

## 5. Comparison methodology

Two complementary passes, in order of return on effort:

### 5.1 Pass A — Page-level catalog (high signal, low cost)

For each of the three artboards in `backstage.html` (`ds-spec` 1280×1560, `debug-page` 1440×1500, `admin-page` 1440×2780):

1. Render the prototype page → screenshot at the artboard width.
2. Render the matching Storybook story (`AdminApp.stories.svelte`, `DebugApp.stories.svelte`, plus a synthetic "Design system" story or the closest equivalent — there is **no current Storybook coverage equivalent to `DesignSystem`** in [client/assets/bs-design-system.jsx](../../client/assets/bs-design-system.jsx), this is a gap worth flagging).
3. Place side-by-side at the same pixel width.

Deliverable: a tri-pane image per page (prototype | implementation | overlay-diff) plus a per-page bullet list of visible deltas.

### 5.2 Pass B — Per-component scenario matrix (definitive, higher cost)

For each panel in `scenarios.html` (sessions, traces, turns, notifications, failures, logs, turn-detail, context, plus the 13 admin panels), there are 3–6 scenario artboards (typical, empty, burst, overflow, edge). For each:

1. Render the prototype scenario → screenshot.
2. Render the matching Storybook story variant at the same width.
3. Diff.

Deliverable: a CSV-style table keyed by `(panel, scenario)` with columns `[prototype-shot, story-shot, story-name, deltas]`. The "story-name" column will be **empty for any prototype scenario that has no equivalent story** — this is the gap list § 4 of the existing audit is supposed to enumerate, now backed by visual evidence.

### 5.3 Visual diff

Two viable approaches:

- **Manual side-by-side** in the report (markdown image grids). Cheap, low fidelity, sufficient for first pass.
- **Programmatic pixel-diff** with `pixelmatch` or `odiff`. Requires adding a devDependency and tolerating noise from font hinting differences (React vs Svelte renderers produce the same DOM but ship through different style stacks — small antialiasing drift is expected). A 0.1–0.2 threshold is reasonable. Worth doing for the page-level catalog (Pass A) only.

For colors, font sizes, paddings — use `mcp__Claude_Preview__preview_inspect` (per the tool description, screenshots are not authoritative for these). This means the visual diff is the trigger; the verdict comes from inspecting computed styles on both renderers.

---

## 6. Why I have not captured screenshots yet

In a single sentence: I cannot. Concretely, of the three preconditions to running Claude Preview against the prototype, only one is met:

| Precondition                                                              | State                                      |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| `.claude/launch.json` with at least `storybook` + `assets` server entries | **Missing**                                |
| `client/assets/design-canvas.jsx` exists so the prototype renders at all  | **Missing**                                |
| A static server fronts `client/assets/`                                   | **Missing**                                |
| `bun storybook` runs (port 6006)                                          | Available; not yet started in this session |
| MSW handlers / fixtures pinned for SSE-dependent stories                  | **Partially unknown** — audit pending      |

Authoring the missing artifacts (one JSON file, one ~80-line JSX shim, one launch entry, optionally a `Bun.serve` wrapper) is a small change set but it is an active code change and outside research scope; it should be scoped to the user's go-ahead.

---

## 7. What I recommend, in order

### 7.1 Restore the prototype harness (smallest unblock)

- Write `client/assets/design-canvas.jsx` providing `DesignCanvas`, `DCSection`, `DCArtboard` (no auto-scaling; fixed width; renders children inside a bordered frame). ~60–80 LOC.
- Vendor `react`, `react-dom`, `@babel/standalone` into `client/assets/vendor/` and switch the two HTML files to local paths. Removes CDN flakiness.

### 7.2 Add a launch config

Create `.claude/launch.json` with two entries:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "storybook", "runtimeExecutable": "bun", "runtimeArgs": ["storybook"], "port": 6006 },
    {
      "name": "assets",
      "runtimeExecutable": "bunx",
      "runtimeArgs": ["serve", "client/assets", "-p", "5174", "-s"],
      "port": 5174
    }
  ]
}
```

(Or, if `bunx serve` is undesirable as a build-time dep, ship a 20-line `scripts/serve-assets.ts` using `Bun.serve` and point `runtimeExecutable` at it.)

### 7.3 Capture the catalog (Pass A)

After 7.1 + 7.2 land:

- `mcp__Claude_Preview__preview_start { name: "assets" }`, `preview_resize` to each artboard width, navigate to `/backstage.html#…`, screenshot.
- `mcp__Claude_Preview__preview_start { name: "storybook" }`, navigate to each story's iframe URL (`/iframe.html?id=…&viewMode=story`), `preview_resize` to the same width, screenshot.

### 7.4 Pre-flight the SSE/fixture audit

For each of these stories (the SSE-suspect set), confirm an MSW handler or a fixture decorator is wired:

- `client/debug/DebugApp.stories.svelte`
- `client/debug/components/{SessionsList,SessionDetail,SessionCard,TurnsPanel,TurnDetail,TraceList,TraceDetail,LogExplorer,LogDetail,NotificationsPanel,LiveContextCard,DebugDetailRail}.stories.svelte`
- `client/admin/components/StatsPanel.stories.svelte`, `client/admin/sections/StatsSection.stories.svelte`

Stories without one will need a decorator added before they screenshot deterministically.

### 7.5 Author the scenario→story mapping table

Walk `scenarios.html` and produce a mapping table keyed by `(panel, scenario)` with the matching Storybook story name or `MISSING`. The `MISSING` rows directly extend the open § 4 of [dashboard-ui-audit.md](dashboard-ui-audit.md).

### 7.6 Decide on diff fidelity

Recommend: manual side-by-side for Pass A; defer pixel-diff tooling until Pass A finds enough deltas to justify it. If pixel-diff is wanted, add `pixelmatch` + `pngjs` as devDeps and a `scripts/visual-diff.ts` that consumes pairs of PNGs and writes a delta image plus a JSON manifest.

---

## 8. Known gaps — RESOLVED 2026-05-30

These predictions all surfaced in the visual sweep and are tracked in
[docs/design/dashboard-visual-bugs-2026-05-30.md](dashboard-visual-bugs-2026-05-30.md).
Fixes shipped in the dashboard visual-bugs fix series (see
[docs/superpowers/plans/2026-05-30-dashboard-visual-bugs-fix.md](../superpowers/plans/2026-05-30-dashboard-visual-bugs-fix.md)).

These were predictions, not findings — they are the items that did show up once screenshots existed:

- The whole `bs-design-system.jsx` page has **no Storybook equivalent**. Either author one (recommended; it's the canonical token/primitive sheet) or accept that the design-system page is prototype-only forever.
- `PropertiesTable.svelte` / `TreeView.svelte` use `tree-*` classes that are not defined in any CSS (§ 1.7 of the existing audit). Their stories will render structurally but visually flat compared to the prototype.
- `StatusDot.svelte` uses class names not present in CSS and overlaps with `Dot.svelte` (§ 1.7). Comparing stories will show whether either renders intentionally.
- `Confirm.svelte` / `Modal.svelte` use raw `<button>` instead of `<Btn>` (§ 1.7). Footer buttons will differ.
- Per § 1.2, the `.panel` class is double-applied on some admin sections. Even though the resolution claim says it's fixed, the visual sweep should confirm none of `BillingSection`, `IdentitiesSection`, `GroupsSection`, `MemosSection`, `RemindersSection`, `SystemSection` still nest `<Panel>` inside a `.panel`-wrapped section.
- `Shell` `min-height: 100vh` vs prototype `100%` (§ 1.5) — visible in any nested layout.
- Hardcoded `rgba(…, 0.3)` borders (§ 1.6) — will likely show as borderline drift vs. token-driven prototype.

---

## 9. Open questions for the user

Listed so the next session can make the call rather than blocking:

1. Should `design-canvas.jsx` be reconstructed from scratch, or recovered from a separate location (sibling repo, backup) that I do not have access to?
2. Vendor React/Babel locally, or accept CDN dependence?
3. Is `bunx serve` acceptable as a runtime dep, or should the static server be hand-rolled (`scripts/serve-assets.ts`)?
4. Catalog (Pass A) only, or commit to the scenario matrix (Pass B) as well? Pass B is roughly 90–120 screenshot pairs.
5. Pixel-diff tooling now, or defer until Pass A produces signal?
6. Should a `DesignSystem.stories.svelte` be authored to mirror `bs-design-system.jsx`?

---

## 10. Effort estimate

Rough, for sizing:

| Step                               | Effort                                 |
| ---------------------------------- | -------------------------------------- |
| 7.1 design-canvas shim + vendoring | 1–2 h                                  |
| 7.2 launch.json + serve script     | 15 min                                 |
| 7.3 Pass A catalog (3 page pairs)  | 30 min if 7.4 passes; +1 h if MSW gaps |
| 7.4 SSE/fixture audit + fixes      | 2–4 h depending on gaps                |
| 7.5 scenario→story mapping table   | 1–2 h                                  |
| 7.6 pixel-diff tooling (optional)  | 2 h                                    |
| Pass B (full scenario matrix)      | 4–6 h, dominated by image management   |

Total to deliver a complete visual audit report: ~1 working day if the SSE/fixture audit is light, ~2 days if many stories need fixture wiring.

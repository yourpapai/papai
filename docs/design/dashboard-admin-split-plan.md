<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard / Admin Split — Implementation Plan

Companion to [`dashboard-admin-split-design.md`](./dashboard-admin-split-design.md).
Each phase is sized to fit **one coding session** (plan → tests → impl →
verify → commit, no overflow). The phases are ordered so the tree stays
green and shippable between any two.

## How to use this document

- **Order matters.** Phases are bottom-up: shared primitives first, then
  the two bundles, then the server routes, then the section moves, then
  cleanup. Don't skip ahead — later phases assume earlier ones landed.
- **One phase per commit / PR.** Branch:
  `claude/split-dashboard-admin-zaoys`.
- **TDD is enforced by hooks** on `src/**` and `client/**`. Write the
  test first; the write-policy gate will reject implementation before a
  failing test exists. Phases below already follow that order.
- **Every phase ends with the same verification baseline** (omitted from
  each phase for brevity, run them anyway):

```bash
bun lint
bun typecheck
bun test            # curated main suite
bun test:client     # dashboard UI tests
bun format:check
bun build:client    # both bundles produce non-empty artifacts
```

`bun check:full` is the required pre-merge gate.

## Conventions used by every phase

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| Goal          | One-sentence summary of the phase outcome.                             |
| Touches       | Files created or modified. Numbers are illustrative; expect ±1.        |
| Depends on    | Phase numbers that must be merged first.                               |
| Tests         | Test files added (always added before implementation under TDD hooks). |
| Exit criteria | Observable state when the phase is complete.                           |

---

## Track A — Shared primitives, no behaviour change yet

### Phase 1 — Extract `client/shared/` skeleton

- **Goal.** Create a shared client directory holding only what both pages
  will use. No callers change yet; this is purely an additive move.
- **Touches.** Create `client/shared/`:
  - `helpers.ts` — copy of `client/debug/helpers.ts` (formatTime,
    formatUptime, levelClass, levelName).
  - `api-types.ts` — content of today's `client/debug/dashboard-types.ts`,
    minus the `DashboardState` interface (which is debug-specific).
    Export the admin-side types unchanged.
  - `fetcher-helpers.ts` — extract `readBody`, `requireOk`,
    `errorMessageFrom`, `ErrorBodySchema` from
    `client/debug/billing/fetchers.ts`.
  - `Modal.svelte` — copy of `client/debug/components/Modal.svelte` with
    Escape-key close added.
  - `PropertiesTable.svelte`, `TreeView.svelte` — copied verbatim.
  - `StatusDot.svelte`, `PanelShell.svelte` — new tiny wrappers that
    re-implement today's inline markup.
- **Tests.**
  - `tests/client/shared/Modal.test.ts` — open/close, Escape closes,
    click-outside closes, click-inside does not close.
  - `tests/client/shared/api-types.test.ts` — type-only assertions
    survive `tsc`.
  - `tests/client/shared/fetcher-helpers.test.ts` — covers `readBody`
    (json + non-json), `requireOk` (ok / 4xx / 5xx),
    `errorMessageFrom` fallback.
- **Depends on.** —
- **Exit criteria.** `client/shared/` exists, is fully tested, and is
  imported by **zero** files. `client/debug/` still works exactly as
  before.

### Phase 2 — Migrate `client/debug/` to consume `client/shared/`

- **Goal.** Make `/dashboard` (still served) use the shared primitives.
  Catches divergence before we split into two bundles.
- **Touches.**
  - `client/debug/components/Modal.svelte` — delete; replace every
    import with `from '../../shared/Modal.js'`.
  - `client/debug/components/PropertiesTable.svelte`,
    `TreeView.svelte` — delete; redirect imports.
  - `client/debug/helpers.ts` — delete; re-import from `../shared/helpers.js`.
  - `client/debug/dashboard-types.ts` — keep only `DashboardState` +
    `DashboardWizard` + `DashboardStats`. Re-export everything else
    from `../shared/api-types.js` so existing imports stay valid.
  - `client/debug/billing/fetchers.ts` — pull `readBody`, `requireOk`,
    `errorMessageFrom`, `ErrorBodySchema` from
    `../../shared/fetcher-helpers.js`.
  - `client/debug/stats/fetchers.ts` — same.
- **Tests.** Existing `tests/client/debug/**` must still pass without
  modification.
- **Depends on.** Phase 1.
- **Exit criteria.** No file under `client/debug/components/` exports
  `Modal.svelte`, `PropertiesTable.svelte`, `TreeView.svelte`, or the
  helper functions; they all import from `client/shared/`. Bundle size
  is within ±2 % of pre-phase.

### Phase 3 — Two-entrypoint build script

- **Goal.** Teach `scripts/build-client.ts` to build N bundles from a
  list. Today it builds one. After this phase it still produces exactly
  the same output (`dashboard.*`) because only one entry is listed — the
  generalisation is the point.
- **Touches.**
  - `scripts/build-client.ts` — refactor into `buildBundle({ entry,
htmlSrc, jsName, htmlName, cssName })`. Loop over a config array.
    For this phase the config holds **one** entry:
    `{ entry: 'client/debug/index.ts', htmlSrc: 'client/debug/dashboard.html',
jsName: 'dashboard.js', htmlName: 'dashboard.html',
cssName: 'dashboard.css' }`. Shared base CSS read once.
  - `client/shared/base.css` (new) — extracted from
    `client/debug/dashboard.css`: reset, body, font stack, panel,
    count-badge, placeholder, status-error, status-success, modal.
    The remainder stays as `dashboard.css` (debug-specific layout +
    log explorer styles).
- **Tests.**
  - `tests/scripts/build-client.test.ts` — invoke buildBundle for the
    debug entry against a temp `outdir`, assert non-empty
    `dashboard.{html,js,css}` are produced and the CSS contains both
    base and component-scoped rules. (Repo currently has no
    `tests/scripts/`; create it; add to the main test glob if necessary.)
- **Depends on.** Phase 2.
- **Exit criteria.** `bun build:client` emits the exact same artifacts
  (modulo whitespace ordering inside `dashboard.css`).
  `tests/debug/server.test.ts` still passes.

---

## Track B — `/debug` page extraction (parallel-safe)

### Phase 4 — Carve out `DebugApp.svelte`

- **Goal.** Build a new `DebugApp.svelte` that composes only the
  observability panels per design §4.4. Run it under the existing
  `/dashboard` route for one phase so we can compare side-by-side.
- **Touches.**
  - `client/debug/DebugApp.svelte` — new. Header + ContextChips +
    SessionsList/TraceList sidebar + 2-column panel grid
    (TurnsPanel, NotificationsPanel, ToolFailuresPanel,
    `LiveContextCard.svelte`) + LogExplorer + modals
    (Session / Trace / Log / Turn / Failure).
  - `client/debug/components/LiveContextCard.svelte` — new. Renders
    only `wizards` + `activeConfigEditors` from the old `ContextPanel`.
  - `client/debug/App.svelte` — temporarily becomes a thin alias:
    `<DebugApp {dashboard} />` while we cut other panels out.
  - `client/debug/dashboard.svelte.ts` — drop fields not consumed by
    DebugApp: `memos`, `recurringTasks`, `deferredPrompts`,
    `identityMappings`, `authorizedGroups`, `billingWindow`,
    `billingSubjects`, `billingDetail`, `adminLlm`, `statsWindow`,
    `globalStats`, `subjectStats`. The handler functions that wrote
    them move out in Phase 5.
- **Tests.**
  - `tests/client/debug/components/DebugApp.test.ts` — mounts
    DebugApp with a minimal state, asserts presence of each retained
    section, asserts the absence of `[data-testid="billing-*"]`,
    `[data-testid="stats-*"]`, memos, reminders.
  - Existing `tests/client/debug/components/App.test.ts` — flip to
    assert the new layout; do **not** delete (App is now an alias).
- **Depends on.** Phase 2 (shared Modal in place).
- **Exit criteria.** `/dashboard` still works; visually the admin panels
  are gone; the engineer panels look right; existing debug-only tests
  still pass.

### Phase 5 — Trim `client/debug/handlers-extras.ts`

- **Goal.** Move admin-only SSE handlers out of the debug bundle so the
  debug bundle doesn't even know how to populate memos/recurring/etc.
- **Touches.**
  - `client/debug/handlers-extras.ts` — keep only
    `handleConfigEditorEvent`. Delete `handleRecurringEvent`,
    `handleDeferredEvent`, `handleMemoEvent`, `handleIdentityEvent`,
    `handleAuthEvent` from this file.
  - `client/debug/sse.ts` — drop their wiring from
    `recurringHandlers()` / `contextHandlers()`. Keep
    `config_editor:opened/closed/step`.
  - Save the deleted handlers verbatim into
    `client/admin/handlers-admin-extras.ts` (new; unused yet — Phase 9
    wires it). This is a temporary file and Phase 11 inlines it.
- **Tests.**
  - `tests/client/debug/handlers.test.ts` — assert the moved handlers
    are no longer exported from the debug module.
  - `tests/client/debug/sse.test.ts` — assert the debug event map no
    longer contains `memo:created`, `memo:archived`, `identity:set`,
    `identity:cleared`, `auth:group_authorized`, `auth:group_revoked`,
    `recurring:*`, `deferred:*`.
- **Depends on.** Phase 4.
- **Exit criteria.** Debug bundle no longer touches admin-only state.
  Live wizard / config-editor indicator still works on `/debug`.

### Phase 6 — Rename `/dashboard` → `/debug`, add 301 redirect

- **Goal.** Flip the URL. Tests update in lock-step.
- **Touches.**
  - `client/debug/dashboard.html` → `client/debug/debug.html` (rename;
    update bundle config in `build-client.ts` accordingly to emit
    `debug.{html,js,css}`).
  - `client/debug/dashboard.svelte.ts` → `client/debug/debug.svelte.ts`
    (rename + update imports).
  - `client/debug/dashboard.css` → `client/debug/debug.css` (rename).
  - `src/debug/server.ts`:
    - `handleDashboardFile()` → `handleDebugFile()` matching `/debug`,
      `/debug.js`, `/debug.css`.
    - Add `if (pathname === '/dashboard') return new Response(null, {
status: 301, headers: { Location: '/debug' } })`.
  - `tests/debug/server.test.ts` — flip to `/debug` + assert 301 from
    `/dashboard`.
  - `tests/debug/dashboard-smoke.test.ts` — rename references to /debug.
  - `client/debug/index.ts` — keep `mountApp` exported; selector
    `#app` unchanged.
- **Tests.**
  - All renamed tests pass with the new URL.
  - New test: `GET /dashboard` returns 301 with `Location: /debug`.
- **Depends on.** Phase 5.
- **Exit criteria.** `bun start:debug` opens at `http://127.0.0.1:9100/debug`
  and shows the engineer page. `/dashboard` redirects.

---

## Track C — `/admin` page bring-up

### Phase 7 — Empty `/admin` bundle and route

- **Goal.** Ship an /admin route that returns an empty shell so the URL
  exists and is testable. No sections wired yet.
- **Touches.**
  - `client/admin/admin.html` (new) — `<div id="app"></div>` + scripts.
  - `client/admin/index.ts` (new) — mounts `AdminApp`.
  - `client/admin/AdminApp.svelte` (new) — sidebar + topbar + empty
    section pane with "select a section" placeholder.
  - `client/admin/admin.svelte.ts` (new) — admin-side reactive state
    with empty fields for the future sections.
  - `client/admin/admin.css` (new) — sidebar + topbar styles only.
  - `client/admin/components/NavSidebar.svelte` (new) —
    `[System, Billing, Stats, Memos, Reminders, Identities, Groups]`,
    hash-routed via `location.hash`.
  - `scripts/build-client.ts` — add a second entry for the admin
    bundle. Bundle outputs: `public/admin.{html,js,css}`.
  - `src/debug/server.ts` — `handleAdminFile()` matching `/admin`,
    `/admin.js`, `/admin.css`. Keep them behind the same
    `isAuthorizedRequest()` gate.
- **Tests.**
  - `tests/debug/server.test.ts` — `GET /admin`, `/admin.js`,
    `/admin.css` all return non-empty 200s.
  - `tests/client/admin/AdminApp.test.ts` — mounts the app, asserts
    the seven nav items, asserts default selection is `System`,
    asserts switching hash to `#billing` updates the visible section.
  - `tests/scripts/build-client.test.ts` — assert both bundles build.
- **Depends on.** Phase 3 (multi-entry build).
- **Exit criteria.** `/admin` renders an empty shell; hash routing
  works; no admin section is wired yet.

### Phase 8 — System section (Credentials form)

- **Goal.** Move the LLM credentials form into `/admin` so the **only
  write surface** lives in the admin page from day one.
- **Touches.**
  - `client/admin/components/CredentialsForm.svelte` — copied verbatim
    from `client/debug/billing/CredentialsForm.svelte`; imports updated
    to use `client/shared/fetcher-helpers.js`.
  - `client/admin/fetchers.ts` (new) — re-export
    `fetchAdminLlm`, `submitAdminLlm` (lifted from the debug billing
    fetchers).
  - `client/admin/sections/SystemSection.svelte` — wraps
    `CredentialsForm` + a small read-only block listing required env
    presence (from a new `GET /admin/system` route that returns
    `{ chatProvider, taskProvider, debugServer, adminUserSet }`).
  - `src/debug/server.ts` — register `GET /admin/system` (read-only,
    same gate as everything else; no new data exposure beyond enum
    booleans).
  - `client/debug/billing/CredentialsForm.svelte` — delete; remove
    from `BillingPanel.svelte` (still rendered on /dashboard for one
    more phase via the temporary App.svelte shim — actually, by Phase
    6 /dashboard is gone, so this is a clean delete).
- **Tests.**
  - `tests/client/admin/sections/SystemSection.test.ts` — renders
    masked apikey row, edit/save flow against a mocked fetch.
  - `tests/debug/admin-llm-route.test.ts` — unchanged; route shape
    didn't move.
  - `tests/debug/server.test.ts` — add `GET /admin/system` coverage.
- **Depends on.** Phase 7.
- **Exit criteria.** `/admin#system` shows the credentials editor;
  posting to `/admin/llm` still works; nothing in `/debug` lets you
  edit credentials anymore.

### Phase 9 — Billing section

- **Goal.** Move the entire billing surface into `/admin#billing`.
- **Touches.**
  - `client/admin/sections/BillingSection.svelte` — window selector +
    subjects table + opens SubjectDetail modal.
  - `client/admin/components/SubjectsTable.svelte`,
    `SubjectDetail.svelte`,
    `SubjectStatsPanel.svelte`,
    `WindowSelect.svelte` — moved from `client/debug/billing/` and
    `client/debug/stats/`.
  - `client/admin/fetchers.ts` — append `fetchBillingSubjects`,
    `fetchBillingDetail`, `fetchStatsSubject` (the last is used by
    SubjectStatsPanel inside the billing modal).
  - `client/debug/billing/` — directory deleted.
- **Tests.**
  - `tests/client/admin/sections/BillingSection.test.ts` — port the
    existing `tests/client/debug/billing/*` tests with updated imports.
  - `tests/debug/billing-route.test.ts` — unchanged.
- **Depends on.** Phase 8.
- **Exit criteria.** `/admin#billing` lists subjects, opens detail
  modal, and renders the per-subject anonymous stats inside. `/debug`
  has no billing references left.

### Phase 10 — Stats section

- **Goal.** Move global stats to `/admin#stats`.
- **Touches.**
  - `client/admin/sections/StatsSection.svelte` — window selector +
    StatsPanel content rendered inline.
  - `client/admin/fetchers.ts` — append `fetchStatsGlobal`.
  - `client/debug/stats/` — directory deleted.
- **Tests.**
  - `tests/client/admin/sections/StatsSection.test.ts` — port from
    `tests/client/debug/stats/StatsPanel.test.ts`.
  - Existing `tests/debug/stats-routes.test.ts` — unchanged.
- **Depends on.** Phase 9.
- **Exit criteria.** `/admin#stats` shows the global stats lists.

### Phase 11 — Memos, Reminders, Identities, Groups sections

- **Goal.** Move the four user-data browsers into `/admin`. v1 read-only.
- **Touches.**
  - `client/admin/sections/MemosSection.svelte` — userId input +
    state filter + table backed by `GET /memos?userId=&state=`.
  - `client/admin/sections/RemindersSection.svelte` — userId input,
    two tables (recurring / deferred) backed by
    `GET /recurring?userId=` and `GET /deferred?userId=`.
  - `client/admin/sections/IdentitiesSection.svelte` — userId +
    provider input, single lookup backed by
    `GET /identity?userId=&provider=`.
  - `client/admin/sections/GroupsSection.svelte` — full list backed
    by `GET /auth/groups`.
  - `client/admin/fetchers.ts` — append the four fetchers (with
    Zod-validated response schemas, same pattern as today's billing
    fetchers).
  - Delete `client/debug/components/MemosPanel.svelte`,
    `RemindersPanel.svelte`, `ContextPanel.svelte`.
  - Delete `client/admin/handlers-admin-extras.ts` (the temporary
    holding pen from Phase 5).
- **Tests.**
  - `tests/client/admin/sections/MemosSection.test.ts`,
    `RemindersSection.test.ts`,
    `IdentitiesSection.test.ts`,
    `GroupsSection.test.ts` — happy path + empty state + error state
    for each.
  - `tests/client/admin/fetchers.test.ts` — Zod schemas reject
    malformed responses.
  - Server-side route tests in `tests/debug/server.test.ts` already
    cover `/recurring`, `/deferred`, `/memos`, `/identity`,
    `/auth/groups` — unchanged.
- **Depends on.** Phase 10.
- **Exit criteria.** Every former panel on the old `/dashboard` has a
  home: engineer panels on `/debug`, operator panels on `/admin`. No
  dead code.

---

## Track D — Tidy-up and polish

### Phase 12 — Cleanup

- **Goal.** Remove the temporary shim `client/debug/App.svelte` (or
  reduce it to just `<DebugApp />`), tighten CSS imports, prune
  unused fields from the dashboard state.
- **Touches.**
  - `client/debug/App.svelte` — delete; `index.ts` mounts
    `DebugApp` directly.
  - `client/debug/debug.svelte.ts` — drop any field that no remaining
    component reads. `bun knip` flags them.
  - `client/shared/base.css` — confirm both bundles import it; remove
    duplicated rules from `debug.css` and `admin.css`.
- **Tests.**
  - `bun knip` clean.
  - Existing tests unchanged.
- **Depends on.** Phase 11.
- **Exit criteria.** `bun check:full` green; no dead exports flagged.

### Phase 13 — Documentation

- **Goal.** Update top-level docs to reflect the split.
- **Touches.**
  - `CLAUDE.md` — change "the dashboard at `/dashboard` exposes a
    Billing panel" to describe the split: `/debug` (engineer surface)
    and `/admin` (operator surface). Update the description of the
    Billing / Stats sections to point to `/admin#billing` /
    `/admin#stats`. Mention the 301 from `/dashboard`.
  - `README.md` — refresh the debug-server section accordingly.
  - This design doc gains a "Status: implemented" tag and a final
    date.
- **Tests.** —
- **Depends on.** Phase 12.
- **Exit criteria.** Top-level docs read accurately for any future
  contributor.

### Phase 14 — Modal primitive: size + footer + Escape (deferred enhancement)

- **Goal.** Promote the shared `Modal.svelte` to a sized + footer-slot
  primitive so the next admin destructive action (out of scope here)
  can land without modal-rewrite friction.
- **Touches.**
  - `client/shared/Modal.svelte` — add `size?: 'sm' | 'md' | 'lg' |
'xl'` and `footer?: Snippet`. CSS classes `.modal--sm/md/lg/xl`.
  - `client/shared/Confirm.svelte` — new; thin wrapper around Modal
    with `size: 'sm'` + Cancel/Confirm footer.
  - All current callers keep using defaults — no visible change.
- **Tests.**
  - `tests/client/shared/Modal.test.ts` — size variants render the
    matching class; footer snippet renders when provided.
  - `tests/client/shared/Confirm.test.ts` — Cancel and Confirm both
    fire, click-outside fires Cancel.
- **Depends on.** Phase 12.
- **Exit criteria.** Modal supports the patterns called out in
  §4.7 of the design spec, ready for the first admin action.

## Cross-cutting checklist

Before each PR is opened:

- [ ] Branch is `claude/split-dashboard-admin-zaoys`.
- [ ] `bun lint` + `bun typecheck` + `bun test` + `bun test:client` +
      `bun format:check` + `bun build:client` all green.
- [ ] No new admin route added without the central
      `isAuthorizedRequest()` gate (grep
      `src/debug/server.ts` for `/admin/` after the diff).
- [ ] No new ungated **write** route on any path.
- [ ] No `eslint-disable`, `oxlint-disable`, `@ts-ignore`,
      `@ts-nocheck`, or `.oxlintrc.json` edits (hooks block them
      anyway; double-check before pushing).
- [ ] Tests for any new component live at the mirrored path under
      `tests/client/{debug,admin,shared}/`.
- [ ] If a panel is moved, the **old import path is gone** in the same
      commit — don't leave a re-export shim behind.

## Rollback plan

If a phase wedges the tree:

- Phases 1-3 are additive; revert the phase commit only.
- Phase 4 + 5 + 6 cluster — these together move /dashboard to /debug.
  If a regression escapes, revert all three commits in order (6 → 5 →
  4). The 301 redirect lets stale links keep working post-revert.
- Phases 7-11 are per-section; reverting one phase only loses that
  section, leaving /admin shell + earlier sections intact.
- Phases 12-14 are cleanup; reverting them never affects functionality.

## Out-of-scope follow-ups (post-split)

Listed here so the plan is honest about what comes next without
expanding the scope of this PR series:

- Admin → destructive actions (revoke group, clear identity mapping,
  archive memo) with Confirm dialogs (Phase 14 primitive lands first).
- Stats charts (sparklines for distributions; Chart.js or hand-rolled
  SVG — open).
- Separate auth tokens for `/debug` vs `/admin` (today both share
  `DEBUG_TOKEN`).
- Filtered SSE for the admin page (live "new memo created" toast).
- Build SHA / git rev surfaced in both pages' footers.

# Dashboard/Admin Split Plan

**Date:** 2026-05-21
**Status:** Draft
**Companion design:** [`../../design/dashboard-admin-split-design.md`](../../design/dashboard-admin-split-design.md)

Split the current debug dashboard into two shipped surfaces: `/debug` for engineer-facing observability and `/admin` for operator-facing controls and data browsing. The work stays bottom-up so the tree remains green between phases: shared client primitives first, then the `/debug` extraction, then `/admin`, then cleanup and documentation. Each phase is intended to fit one coding session.

## Validation baseline

Every phase should leave the repo green on the same baseline: `bun lint`, `bun typecheck`, `bun test`, `bun test:client`, `bun format:check`, and `bun build:client`. `bun check:full` remains the pre-merge gate.

Cross-cutting checklist and rollback plan live in [`../notes/plan-phase-conventions-and-checklists.md`](../notes/plan-phase-conventions-and-checklists.md).

## Track A — Shared primitives, no behavior change yet

### Phase 1 — Extract `client/shared/` skeleton

- **Goal:** Create a shared client layer without changing any callers yet.
- **Touches:** Add `client/shared/helpers.ts`, `api-types.ts`, `fetcher-helpers.ts`, `Modal.svelte`, `PropertiesTable.svelte`, `TreeView.svelte`, plus new thin wrappers `StatusDot.svelte` and `PanelShell.svelte`. `api-types.ts` is today's `client/debug/dashboard-types.ts` minus the debug-only `DashboardState`.
- **Tests:** Add `tests/client/shared/Modal.test.ts`, `api-types.test.ts`, and `fetcher-helpers.test.ts` to cover modal behavior, type survival, and fetch helper error handling.
- **Depends on:** —
- **Exit criteria:** `client/shared/` exists, is fully tested, and is imported by zero files; `client/debug/` behaves exactly as before.

### Phase 2 — Migrate `client/debug/` to consume `client/shared/`

- **Goal:** Prove the shared primitives work before introducing a second bundle.
- **Touches:** Delete debug-local copies of `Modal.svelte`, `PropertiesTable.svelte`, `TreeView.svelte`, and `helpers.ts`; re-point imports to `client/shared/`. Reduce `client/debug/dashboard-types.ts` to `DashboardState`, `DashboardWizard`, and `DashboardStats`, while re-exporting admin/shared types from `../shared/api-types.js`. Move `readBody`, `requireOk`, `errorMessageFrom`, and `ErrorBodySchema` use sites in `client/debug/billing/fetchers.ts` and `client/debug/stats/fetchers.ts` to `../../shared/fetcher-helpers.js`.
- **Tests:** Existing `tests/client/debug/**` should keep passing without modification.
- **Depends on:** Phase 1.
- **Exit criteria:** The removed primitives are no longer exported from `client/debug/`; they are imported from `client/shared/`, and bundle size stays within roughly ±2% of the pre-phase size.

### Phase 3 — Two-entrypoint build script

- **Goal:** Generalize `scripts/build-client.ts` to support multiple bundles while still emitting only the existing dashboard bundle in this phase.
- **Touches:** Refactor the build script around `buildBundle({ entry, htmlSrc, jsName, htmlName, cssName })` and iterate a config array that still contains only the debug entry. Extract shared CSS into new `client/shared/base.css`, leaving only debug-specific layout and log styles in the debug stylesheet.
- **Tests:** Add `tests/scripts/build-client.test.ts` to build the debug entry into a temp output dir and assert non-empty `dashboard.{html,js,css}` with both base and component CSS present.
- **Depends on:** Phase 2.
- **Exit criteria:** `bun build:client` still emits the same dashboard artifacts modulo CSS ordering/whitespace, and existing server tests remain green.

## Track B — `/debug` page extraction

### Phase 4 — Carve out `DebugApp.svelte`

- **Goal:** Build a dedicated observability app and temporarily serve it under the existing route.
- **Touches:** Add `client/debug/DebugApp.svelte` with header, context chips, sessions/traces sidebar, the retained observability panels, log explorer, and retained modals. Add `LiveContextCard.svelte` for only `wizards` and `activeConfigEditors`. Make `client/debug/App.svelte` a thin alias to `DebugApp`. Trim `client/debug/dashboard.svelte.ts` so it no longer carries admin-only state such as billing, stats, memos, reminders, identities, and groups.
- **Tests:** Add `tests/client/debug/components/DebugApp.test.ts` and update the existing `App.test.ts` to assert the new layout and the absence of billing/stats/admin sections.
- **Depends on:** Phase 2.
- **Exit criteria:** `/dashboard` still works, but only the engineer-facing panels remain visible and tested.

### Phase 5 — Trim `client/debug/handlers-extras.ts`

- **Goal:** Remove admin-only SSE handler knowledge from the debug bundle.
- **Touches:** Keep only `handleConfigEditorEvent` in `client/debug/handlers-extras.ts`; remove recurring, deferred, memo, identity, and auth handlers from debug wiring in `client/debug/sse.ts`. Park those deleted handlers temporarily in new `client/admin/handlers-admin-extras.ts` for later reuse.
- **Tests:** Update `tests/client/debug/handlers.test.ts` to assert the moved handlers are no longer exported, and `tests/client/debug/sse.test.ts` to assert the debug event map no longer includes memo, identity, auth, recurring, or deferred events.
- **Depends on:** Phase 4.
- **Exit criteria:** The debug bundle no longer populates admin-only state, but the live wizard/config-editor indicators still work.

### Phase 6 — Rename `/dashboard` to `/debug` and add redirect

- **Goal:** Flip the primary engineer URL without breaking old links.
- **Touches:** Rename `dashboard.html`, `dashboard.svelte.ts`, and `dashboard.css` to `debug.*`; update `scripts/build-client.ts` to emit `debug.{html,js,css}`. In `src/debug/server.ts`, replace the dashboard file handler with `/debug` handling and add a `301 Location: /debug` redirect from `/dashboard`.
- **Tests:** Update route and smoke tests to use `/debug`, and add coverage that `GET /dashboard` returns a 301 redirect to `/debug`.
- **Depends on:** Phase 5.
- **Exit criteria:** `bun start:debug` serves the engineer page at `/debug`, and `/dashboard` redirects cleanly.

## Track C — `/admin` page bring-up

### Phase 7 — Empty `/admin` bundle and route

- **Goal:** Ship an authorized but mostly empty admin shell so the route exists before sections move.
- **Touches:** Add `client/admin/admin.html`, `index.ts`, `AdminApp.svelte`, `admin.svelte.ts`, `admin.css`, and `components/NavSidebar.svelte` with hash-routed sections `[System, Billing, Stats, Memos, Reminders, Identities, Groups]`. Extend `scripts/build-client.ts` with a second bundle entry and extend `src/debug/server.ts` with `/admin`, `/admin.js`, and `/admin.css`, all behind `isAuthorizedRequest()`.
- **Tests:** Extend server tests for the new assets, add `tests/client/admin/AdminApp.test.ts` for nav rendering and hash routing, and update the build-script test to assert both bundles build.
- **Depends on:** Phase 3.
- **Exit criteria:** `/admin` renders an empty shell with working sidebar navigation, but no admin sections are wired yet.

### Phase 8 — System section (credentials form)

- **Goal:** Move the LLM credentials write surface into `/admin` first.
- **Touches:** Port `CredentialsForm.svelte` into `client/admin/components/`, backed by new `client/admin/fetchers.ts` re-exporting `fetchAdminLlm` and `submitAdminLlm`. Add `SystemSection.svelte` with the credentials form and a small read-only env-presence block powered by new `GET /admin/system`. Remove the credentials form from the old debug billing area.
- **Tests:** Add `tests/client/admin/sections/SystemSection.test.ts` for masked API key display and edit/save flow; keep the admin-LLM route tests intact; extend server tests for `GET /admin/system`.
- **Depends on:** Phase 7.
- **Exit criteria:** `/admin#system` owns the credentials editor, posting to `/admin/llm` still works, and `/debug` no longer exposes credential edits.

### Phase 9 — Billing section

- **Goal:** Move the billing list and subject drill-down into `/admin#billing`.
- **Touches:** Add `BillingSection.svelte` plus `SubjectsTable.svelte`, `SubjectDetail.svelte`, `SubjectStatsPanel.svelte`, and `WindowSelect.svelte`, migrated from the debug billing/stats area. Extend `client/admin/fetchers.ts` with `fetchBillingSubjects`, `fetchBillingDetail`, and `fetchStatsSubject`. Delete `client/debug/billing/`.
- **Tests:** Port the existing debug billing UI tests to `tests/client/admin/sections/BillingSection.test.ts`; keep server billing route tests unchanged.
- **Depends on:** Phase 8.
- **Exit criteria:** `/admin#billing` lists subjects, opens drill-down details, and renders per-subject anonymous stats; `/debug` has no billing references left.

### Phase 10 — Stats section

- **Goal:** Move global anonymous stats to `/admin#stats`.
- **Touches:** Add `StatsSection.svelte`, extend `client/admin/fetchers.ts` with `fetchStatsGlobal`, and delete the old `client/debug/stats/` directory.
- **Tests:** Port the stats panel client test to `tests/client/admin/sections/StatsSection.test.ts`; keep server-side stats route tests unchanged.
- **Depends on:** Phase 9.
- **Exit criteria:** `/admin#stats` shows the global stats view, and `/debug` no longer carries that section.

### Phase 11 — Memos, Reminders, Identities, Groups sections

- **Goal:** Move the remaining operator-facing data browsers into `/admin` as read-only v1 sections.
- **Touches:** Add `MemosSection.svelte`, `RemindersSection.svelte`, `IdentitiesSection.svelte`, and `GroupsSection.svelte`, backed by new admin fetchers for `/memos`, `/recurring`, `/deferred`, `/identity`, and `/auth/groups`. Delete `client/debug/components/MemosPanel.svelte`, `RemindersPanel.svelte`, and `ContextPanel.svelte`, and remove the temporary `client/admin/handlers-admin-extras.ts` holding file.
- **Tests:** Add per-section happy-path/empty/error tests plus `tests/client/admin/fetchers.test.ts` for Zod response validation. Existing server route tests for those endpoints stay in place.
- **Depends on:** Phase 10.
- **Exit criteria:** Every former operator panel from the old dashboard now lives on `/admin`, and `/debug` contains only engineer-facing panels.

## Track D — Cleanup and polish

### Phase 12 — Cleanup

- **Goal:** Remove temporary shims and dead state once the split is complete.
- **Touches:** Delete `client/debug/App.svelte` so `index.ts` mounts `DebugApp` directly; trim unused fields from `client/debug/debug.svelte.ts`; confirm both bundles consume `client/shared/base.css` and remove duplicated rules from `debug.css` and `admin.css`.
- **Tests:** Existing tests should remain unchanged; `bun knip` should be clean.
- **Depends on:** Phase 11.
- **Exit criteria:** `bun check:full` passes with no dead exports or leftover shim code.

### Phase 13 — Documentation

- **Goal:** Make top-level docs describe the split accurately.
- **Touches:** Update `CLAUDE.md` and `README.md` to describe `/debug` as the engineer surface, `/admin` as the operator surface, and the `/dashboard` → `/debug` redirect. Mark this plan implemented when the work lands.
- **Tests:** —
- **Depends on:** Phase 12.
- **Exit criteria:** Contributor-facing docs match the shipped behavior.

### Phase 14 — Modal primitive: size, footer, Escape

- **Goal:** Finish the shared modal primitive so later admin destructive actions can reuse it without another modal rewrite.
- **Touches:** Extend `client/shared/Modal.svelte` with `size?: 'sm' | 'md' | 'lg' | 'xl'` and a footer slot/snippet, add matching CSS size classes, and add new `client/shared/Confirm.svelte` as a thin confirm wrapper.
- **Tests:** Extend `tests/client/shared/Modal.test.ts` for size and footer behavior and add `tests/client/shared/Confirm.test.ts` for confirm/cancel/click-outside flows.
- **Depends on:** Phase 12.
- **Exit criteria:** Shared modal primitives cover the patterns called out in the companion design and are ready for the first admin destructive action.

## Risks and rollback

- **Route/auth risk:** Every new `/admin` route must remain behind the existing `isAuthorizedRequest()` gate; accidental ungated write routes are release blockers.
- **Split drift risk:** If panels move, the old import path should disappear in the same phase so no long-lived shim layer accumulates.
- **Build risk:** The multi-entry client build must keep both bundles non-empty and independently testable.
- **Rollback:** Phases 1-3 are additive and can be reverted individually. Phases 4-6 should be reverted as a cluster if the `/dashboard` → `/debug` transition regresses. Phases 7-11 can be reverted section-by-section without collapsing the whole `/admin` shell. Phases 12-14 are cleanup/polish and should be safe to revert independently.

## Out of scope follow-ups

- Destructive admin actions such as revoke group, clear identity mapping, or archive memo.
- Richer stats visualizations.
- Separate auth tokens for `/debug` and `/admin`.
- Filtered SSE for the admin page.
- Build SHA or git revision surfaced in both page footers.

# Phase 3 — Billing Dashboard + Admin Credentials — Implementation Plan

**Date:** 2026-05-19
**Status:** Draft
**Branch:** `claude/phase-3-llm-billing-pMOsy`
**Per-phase design:** [`../specs/2026-05-19-phase-3-billing-dashboard-design.md`](../specs/2026-05-19-phase-3-billing-dashboard-design.md)
**Brainstorm:** [`../notes/2026-05-19-phase-3-billing-dashboard-brainstorm.md`](../notes/2026-05-19-phase-3-billing-dashboard-brainstorm.md)
**Parent roadmap:** [`2026-05-19-central-llm-billing-roadmap.md`](2026-05-19-central-llm-billing-roadmap.md)

## Sequencing principle

The TDD hook gates every `src/` and `client/` edit on a failing test.
Each step splits into:

- **T**: write the failing test(s).
- **I**: write implementation that turns the test(s) green.
- **R**: refactor only when there's something to refactor.

Steps are ordered so each leaves the tree green between steps. Within a
step the tree may be red, but never between steps.

Test-first applies to both `src/` and `client/` implementation files.
Markdown / config / migration edits do not trigger the gate.

## Step 0 — Pre-flight

- Confirm we are on branch `claude/phase-3-llm-billing-pMOsy`.
- `bun test` passes on the baseline.
- `bun typecheck` passes.
- Phase 2's recorder is in place: `grep -l initUsageRecorder src/index.ts`
  returns the import.
- The system-config module exposes `setSystemConfig` and
  `SYSTEM_CONFIG_KEYS` (Phase 1). Confirmed via `grep -n
  SYSTEM_CONFIG_KEYS src/system-config.ts`.

## Step 1 — `system-config` helper extensions

**T**: extend `tests/system-config.test.ts`:

- `maskSystemConfigValue('llm_apikey', 'sk-abc12345')` returns
  `'****2345'`.
- `maskSystemConfigValue('llm_baseurl', 'https://api.example.com')`
  returns the value unchanged.
- `maskSystemConfigValue('main_model', 'gpt-5')` returns the value
  unchanged.
- `listSystemConfigEntries()` returns one entry per row in the table,
  each with `{ key, value, updatedAt, updatedBy }` — typed against the
  Drizzle row shape.
- `listSystemConfigEntries()` returns an empty array when the table is
  empty.

**I**: add to `src/system-config.ts`:

```ts
export const maskSystemConfigValue = (key: SystemConfigKey, value: string): string => {
  if (key === 'llm_apikey') return `****${value.slice(-4)}`
  return value
}

export const listSystemConfigEntries = (): Array<{
  key: SystemConfigKey
  value: string
  updatedAt: number
  updatedBy: string
}> => {
  const rows = getDrizzleDb().select().from(systemConfig).all()
  return rows
    .filter((r): r is typeof r & { key: SystemConfigKey } => isSystemConfigKey(r.key))
    .map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt, updatedBy: r.updatedBy }))
}
```

**R**: extract `isSystemConfigKey` already present in the file; reuse.

**Verify**: `bun test tests/system-config.test.ts && bun typecheck`.

## Step 2 — `src/debug/billing.ts` module

**T**: add `tests/debug/billing.test.ts`:

- `parseWindow('24h')` returns `'24h'`; `parseWindow('7d')` returns
  `'7d'`; `parseWindow('30d')` returns `'30d'`; `parseWindow('all')`
  returns `'all'`; `parseWindow(null)` returns `'30d'` (default);
  `parseWindow('foo')` returns `null` (invalid).
- `windowToMs('24h')` returns `86_400_000`; `windowToMs('all')` returns
  `null`.
- `listBillingSubjects('all')` over a seeded fixture (3 subjects, 2 DM
  + 1 group) returns 3 `BillingSubject`s, with DM display names from
  `users.username` and group display name `null`.
- `listBillingSubjects('24h')` filters by window.
- DM with no matching `users` row returns `displayName: null`.
- `getBillingDetail(id, 'all')` returns `{ subject, requests, truncated }`;
  `truncated: false` when row count ≤ 500.
- `getBillingDetail(id, 'all')` with 501 seeded rows returns 500 rows
  and `truncated: true`.
- `getBillingDetail('missing', 'all')` returns `null`.

Seed users via `getDrizzleDb().insert(users)...`. Seed usage events via
`recordUsage(...)` calls or direct insert.

**I**: add `src/debug/billing.ts` per design D4. Types
(`BillingSubject`, `BillingDetail`, `Window`) live here. Helpers
(`parseWindow`, `windowToMs`, `listBillingSubjects`, `getBillingDetail`)
likewise.

The detail SQL uses `getDrizzleDb()` to select from
`llmUsageEvents` with `LIMIT 501` then trims to 500 in JS.

**R**: extract `resolveDisplayNames` as a module-local helper if it
becomes more than 10 lines.

**Verify**: `bun test tests/debug/billing.test.ts && bun typecheck`.

## Step 3 — `src/debug/admin-llm.ts` module

**T**: add `tests/debug/admin-llm.test.ts`:

- `getAdminLlmSnapshot()` with no `system_config` rows returns the five
  keys all with `{ value: null, updatedAt: null, updatedBy: null }`.
- `getAdminLlmSnapshot()` with all five keys set returns each key
  with its `updatedAt`/`updatedBy`; `llm_apikey` is masked
  (`'****XXXX'`), others verbatim.
- `applyAdminLlmUpdate({ key: 'main_model', value: 'gpt-6' }, 'admin-1')`
  returns `{ key: 'main_model', updatedAt: <number> }` and persists via
  `setSystemConfig`.
- `applyAdminLlmUpdate({ key: 'unknown', value: 'x' }, 'admin-1')`
  throws a typed error with `kind: 'bad-key'`.
- `applyAdminLlmUpdate({ key: 'main_model', value: '' }, 'admin-1')`
  throws a typed error with `kind: 'bad-value'`.
- `applyAdminLlmUpdate({ key: 'main_model', value: '  trim  ' }, 'admin-1')`
  persists `'trim'`.

**I**: add `src/debug/admin-llm.ts`. Zod schema:
`z.object({ key: z.enum(SYSTEM_CONFIG_KEYS), value: z.string().trim().min(1) })`.

Error type: a small tagged union `AdminLlmError = { kind: 'bad-key' | 'bad-value', message: string }`.
Use a custom class extending `Error` carrying `kind` so route handlers can
discriminate without parsing the message.

**R**: none.

**Verify**: `bun test tests/debug/admin-llm.test.ts && bun typecheck`.

## Step 4 — Route handlers

This step adds the four route branches inside `src/debug/server.ts`.
The current `routeRequest` is a chain of `if (url.pathname === ...)`
checks. We extend it; we do NOT refactor the router shape.

**T**: add `tests/debug/billing-route.test.ts`:

Uses the live-`Bun.serve` test pattern from `tests/debug/server.test.ts`
(start server on a test port, fetch routes, parse JSON).

For each new route:

- 401 when DEBUG_TOKEN set but missing/wrong on the request.
- 200 happy path with expected shape (use `BillingSubject` type
  assertions in TypeScript via narrowing).
- 400 on invalid `?window=...` value.
- 404 on `GET /billing/subject/missing-id`.
- Truncation flag honored for subject detail.

Add `tests/debug/admin-llm-route.test.ts`:

- GET `/admin/llm` returns the snapshot with `llm_apikey` masked.
- POST `/admin/llm` with valid body returns 200 and writes the value.
- POST `/admin/llm` with unknown key returns 400.
- POST `/admin/llm` with empty value returns 400.
- POST `/admin/llm` with malformed JSON returns 400.
- POST `/admin/llm` when DEBUG_TOKEN unset in env returns 401.
- POST `/admin/llm` when ADMIN_USER_ID unset returns 503.

`updatedBy` assertion: after POST, the row's `updated_by` equals
`process.env.ADMIN_USER_ID`.

**I**: in `src/debug/server.ts`:

- Add `import` for `listBillingSubjects`, `getBillingDetail`,
  `parseWindow` from `./billing.js`.
- Add `import` for `getAdminLlmSnapshot`, `applyAdminLlmUpdate` from
  `./admin-llm.js`.
- Add a small `parseJsonBody(req)` helper (returns `unknown` on
  success, `null` on parse failure) — module-local.
- Add four new route branches to `routeRequest`:

```ts
if (url.pathname === '/billing/subjects') return handleBillingSubjects(url)
if (url.pathname.startsWith('/billing/subject/')) return handleBillingSubject(url)
if (url.pathname === '/admin/llm' && req.method === 'GET') return handleAdminLlmGet()
if (url.pathname === '/admin/llm' && req.method === 'POST') return handleAdminLlmPost(req)
```

- Each handler returns the right JSON Response with the right status.
- `handleAdminLlmPost` reads `process.env['DEBUG_TOKEN']` and
  `process.env['ADMIN_USER_ID']`; refuses with 401/503 when unset.
  Calls `applyAdminLlmUpdate`; catches the typed error to return 400.

The router argument was `routeRequest(req)`. With the method check
added, the handlers can take `(req, url)` consistently.

**R**: none — keep the if-chain style for consistency.

**Verify**:

```
bun test tests/debug/billing-route.test.ts
bun test tests/debug/admin-llm-route.test.ts
bun test tests/debug/server.test.ts   # smoke that the existing routes still work
bun typecheck
```

## Step 5 — Client state additions

**T**: add `tests/client/billing/dashboard-types.test.ts`:

- A factory `makeEmptyAdminLlm()` returns an `AdminLlmSnapshot` with
  the five keys all `{ value: null, updatedAt: null, updatedBy: null }`.
- A factory `makeEmptyBillingState()` returns `{
  billingWindow: '30d', billingSubjects: [], billingDetail: null,
  adminLlm: makeEmptyAdminLlm() }`.
- The shapes match the server-side `BillingSubject` and
  `AdminLlmSnapshot`.

(These are essentially type-level tests + minimal factories so the
implementation has somewhere to compile against.)

**I**:

- Add types to `client/debug/dashboard-types.ts`: `BillingSubject`,
  `BillingDetail`, `AdminLlmKeyState`, `AdminLlmSnapshot`,
  `BillingWindow`. Extend `DashboardState` with `billingWindow`,
  `billingSubjects`, `billingDetail`, `adminLlm`.
- Update `client/debug/dashboard.svelte.ts` to initialize the new
  fields.
- Add the `BillingRequestRow` type imported from
  `src/usage/types.js` (already exists from Phase 2) so the
  per-request shape is shared.

**R**: none.

**Verify**: `bun test:client tests/client/billing/dashboard-types.test.ts && bun typecheck`.

## Step 6 — Client fetchers

**T**: add `tests/client/billing/fetchers.test.ts`:

- `fetchBillingSubjects(window)` calls `fetch('/billing/subjects?window=30d')`
  and returns the parsed `subjects`.
- `fetchBillingDetail(id, window)` calls
  `fetch('/billing/subject/<encoded id>?window=30d')` and returns the
  `BillingDetail`. URL encoding of `:` covered by a test.
- `fetchAdminLlm()` calls `fetch('/admin/llm')` and returns the
  snapshot.
- `submitAdminLlm({ key, value })` POSTs JSON and returns the
  response body.
- All fetchers parse JSON, propagate non-2xx as a thrown `Error` with
  the response body's `error` field as the message.

Use `setMockFetch()` from `tests/utils/test-helpers.ts` to install
fixtures; `restoreFetch()` in `afterEach` (the global hook handles
this).

**I**: add `client/debug/billing/fetchers.ts` exporting the four
functions above. Each fetcher uses the global `fetch` (not the Bun
server directly) so the test mock can intercept.

**R**: none.

**Verify**: `bun test:client tests/client/billing/fetchers.test.ts && bun typecheck`.

## Step 7 — Client components

The TDD hook applies to client files too. Each component lands T-then-I.

### Step 7a — `SubjectsTable.svelte`

**T**: `tests/client/billing/SubjectsTable.test.ts`:

- Renders one row per subject; columns: subject (displayName or id),
  type, main tokens (in/out), small tokens, embedding tokens, tool
  calls, last active.
- Clicking a row fires the `onSelect(subject)` callback.
- Empty state shows "No usage in the selected window".
- Display name `null` falls through to `storageContextId`.

**I**: write the component. It takes
`{ subjects: BillingSubject[], onSelect: (s) => void }` as props.

**Verify**: `bun test:client tests/client/billing/SubjectsTable.test.ts`.

### Step 7b — `SubjectDetail.svelte`

**T**: `tests/client/billing/SubjectDetail.test.ts`:

- Renders one row per request, ordered as given.
- Row expansion toggles a detail block showing JSON of all fields
  (model, finishReason, stepCount, toolCallCount, messageCount, etc.).
- Truncation banner visible when `truncated: true`.
- Empty requests array → "No requests in this window".

**I**: write the component.

**Verify**: `bun test:client tests/client/billing/SubjectDetail.test.ts`.

### Step 7c — `CredentialsForm.svelte`

**T**: `tests/client/billing/CredentialsForm.test.ts`:

- Renders 5 rows (one per `SYSTEM_CONFIG_KEYS`).
- For `llm_apikey`, the displayed value is the masked string from the
  server (e.g. `****1234`) when set, or `(not set)` when null.
- For non-secret keys, the displayed value is the cleartext.
- Each row has an "Edit" button; clicking reveals an `<input>` and a
  "Save" / "Cancel" pair.
- "Save" posts to `submitAdminLlm` and re-fetches the snapshot via
  `fetchAdminLlm`.
- "Cancel" reverts without posting.
- Submit shows a success/error toast (or inline text) based on the
  fetcher response.

**I**: write the component. Props: `{ snapshot: AdminLlmSnapshot,
onRefresh: () => Promise<void> }`. The component dispatches
`submitAdminLlm` itself and calls `onRefresh` after success.

**Verify**: `bun test:client tests/client/billing/CredentialsForm.test.ts`.

### Step 7d — `BillingPanel.svelte`

**T**: `tests/client/billing/BillingPanel.test.ts`:

- On mount, the panel calls `fetchBillingSubjects(window)` and
  `fetchAdminLlm()`.
- Window selector with four options; changing the selection re-fetches
  the subjects.
- Refresh button re-fetches subjects and admin snapshot.
- Selecting a subject in the table triggers a detail fetch and
  populates `billingDetail`.

**I**: write the container component. It owns the panel-level state
(`fetching: boolean`, `error: string | null`), composes the three
sub-components, and uses the dashboard's reactive store for
`billingSubjects`, `billingDetail`, `adminLlm`, `billingWindow`.

**Verify**: `bun test:client tests/client/billing/BillingPanel.test.ts`.

## Step 8 — Slot `BillingPanel` into `App.svelte`

**T**: extend `tests/client/app.test.ts` (or create if absent):

- The rendered App contains a `<section>` with `data-testid="billing-panel"`
  (or matching role).
- Selecting a subject from the inner `SubjectsTable` opens a modal
  containing `SubjectDetail`.

If the existing app test is too heavy to extend, write a focused
`tests/client/billing/App-billing-integration.test.ts`.

**I**: in `client/debug/App.svelte`:

- Import `BillingPanel` from `./billing/BillingPanel.svelte`.
- Slot it inside the `.panel-grid` next to `MemosPanel`.
- Add `selectedBillingSubject` state, like `selectedSession`.
- Add a `Modal` block for the detail view; render `SubjectDetail`
  inside.
- On row click, set `selectedBillingSubject` and dispatch
  `fetchBillingDetail`.

**R**: none.

**Verify**: `bun test:client && bun typecheck`.

## Step 9 — Dashboard CSS additions

`client/debug/dashboard.css` already has panel styles. Add:

- `.billing-panel` rules to expand width if necessary.
- `.credentials-form` rules: row layout, "Edit" button, masked value
  styling.
- `.subjects-table` rules: hover, sortable header chevrons (sort is
  client-side and v1 — can be deferred if time pressed).

No tests for CSS; visual smoke covers this in Step 12.

## Step 10 — Documentation

- Update `CLAUDE.md` to mention the dashboard credentials surface
  (a one-line addition under "Required Environment Variables" noting
  that the dashboard at `/dashboard` exposes `/admin/llm` when
  `DEBUG_SERVER=true` and `DEBUG_TOKEN` is set).
- Add a short Billing section to whatever dashboard guide exists. If
  none does, skip; do not invent a doc file.

## Step 11 — Full suite + lint + typecheck + security

Run in order:

1. `bun typecheck`
2. `bun lint`
3. `bun test` — main curated suite
4. `bun test:client` — dashboard tests
5. `bun format:check`
6. `bun security`

Any failure pauses the plan and we fix forward.

## Step 12 — Manual smoke (mandatory acceptance)

Reuse the Phase 2 smoke fixture if available; otherwise:

1. Fresh DB (`rm papai.db*` in a scratch dir).
2. Start the bot with full env:
   `LLM_API_KEY=… LLM_BASE_URL=… MAIN_MODEL=… EMBEDDING_MODEL=… ADMIN_USER_ID=… CHAT_PROVIDER=telegram TASK_PROVIDER=kaneo KANEO_CLIENT_URL=… DEBUG_SERVER=true DEBUG_TOKEN=devtoken bun start:debug`.
3. Send a chat message; let it complete.
4. Save a memo.
5. Trigger `web_fetch` on a long URL (forces distill).
6. Open `http://127.0.0.1:9100/dashboard` (with Bearer `devtoken` header
   via browser extension or `curl -H 'Authorization: Bearer devtoken'`
   for routes).
7. Confirm the Billing panel shows one subject with main + embedding +
   small calls populated.
8. Click the subject; modal shows the three request rows.
9. Expand a row to see the JSON.
10. In the credentials form, edit `main_model` to a different model
    name, save. Confirm GET refresh shows the new value.
11. Send another message; the bot uses the new model (visible in the
    Logs panel's `model=` field or the next billing row).
12. Edit `llm_apikey` to an invalid value; send a message; expect an
    error row in the subject detail (`error` populated).
13. Restore the correct `llm_apikey`; verify normal behavior resumes
    without restart.

Capture SQL output and a screenshot of the Billing panel in the PR
description.

## Step 13 — Commit groups + push

Group by surface:

- **Commit A**: `system-config` helpers + tests.
- **Commit B**: `src/debug/billing.ts` + tests.
- **Commit C**: `src/debug/admin-llm.ts` + tests.
- **Commit D**: `src/debug/server.ts` route wiring + route tests.
- **Commit E**: client state + fetchers + tests.
- **Commit F**: client components (4 svelte files) + tests.
- **Commit G**: `App.svelte` integration + integration test + CSS.
- **Commit H**: docs (if any).

If a hook fails on a commit, fix the underlying issue and create a NEW
commit (no `--amend`, no `--no-verify`).

Push with
`git push -u origin claude/phase-3-llm-billing-pMOsy`.

## Step 14 — Review (per roadmap)

- `bun security` already run in Step 11. Investigate findings.
- The `/admin/llm` route is the new sensitive surface — invoke the
  `security-review` skill on the credentials form changes.
- Manual smoke notes from Step 12 in the PR description.
- Dashboard walkthrough screenshot in the PR description.

## Risks + mitigations

| Risk                                                                             | Mitigation                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TDD hook blocks an `src/` edit because the new test was not yet written          | Strict T → I sequencing inside each step                                                                                  |
| Bun.serve test ports collide with other suites                                   | Use a distinct port (e.g. `19101`) for the billing-route suite                                                            |
| `process.env['DEBUG_TOKEN']` leaks across tests                                  | Always set/unset in `beforeEach`/`afterEach`                                                                              |
| The dashboard build doesn't pick up the new `billing/` subdirectory              | Verify `scripts/build-client.ts` imports from `App.svelte` (it should — the bundler follows imports)                       |
| `llm_apikey` accidentally logged                                                 | Pino logger only ever sees `{ key, updatedBy }`. Code review confirms no `value` lands in a log line                       |
| Credentials form posts before re-render flushes (Svelte 5 batching)              | Use `await tick()` in the test setup if needed; the form's submit is `async` and awaits the fetch                          |
| Subject id with `:` breaks the router slice                                      | Decode with `decodeURIComponent`; test fixture includes a `groupId:threadId` subject                                       |
| `users.username` is null for some platforms (Mattermost) → DM display = null      | Falls through to the raw id rendering in `SubjectsTable.svelte`; verified by the test for null displayName                |
| Group has no display name in v1; operators may assume a bug                       | Document in the dashboard guide (Step 10); UI shows the raw id, no question marks                                          |
| The `LIMIT 501 / trim 500 / set truncated` flow can drift if someone changes LIMIT | Constants exported from `billing.ts` so the test references the same value                                                 |
| Auth gate gives 401 with no body, confusing the form                              | The credentials form treats 401 as "session expired" and shows a one-line "Refresh and re-authenticate" message            |
| Read-only dashboard mode (no `DEBUG_TOKEN`) silently allows writes               | POST `/admin/llm` returns 401 when `DEBUG_TOKEN` is unset (D7); explicit refusal, not silent acceptance                    |

## Out-of-plan checklist before Step 13

- [ ] No `eslint-disable`, `oxlint-disable`, `@ts-ignore`, or
      `@ts-nocheck` comments anywhere (hook policy)
- [ ] `bun knip` shows no new unused exports — every export is reachable
      from `App.svelte`, server routes, or tests
- [ ] `bun duplicates` does not regress
- [ ] `tests/CLAUDE.md` style respected (DI-first; helpers from
      `tests/utils/test-helpers.ts`)
- [ ] No `value` (raw API key) logged at any level
- [ ] `tests/debug/admin-llm-route.test.ts` asserts the 401-when-no-token
      contract explicitly
- [ ] Window default 30d documented in route docstring

## Notes for follow-up phases

- Phase 4 (tool-call rows) adds a per-tool table; the subject detail
  modal grows a "Tools" tab. The route shape extends; no breaking
  changes.
- Phase 5 (anonymous stats) follows the same module pattern
  (`src/debug/stats.ts`, `src/stats/`) and a parallel set of dashboard
  components.
- Group title capture is a candidate future enhancement; the
  `BillingSubject.displayName` field is already nullable so a future
  resolver lights it up automatically.

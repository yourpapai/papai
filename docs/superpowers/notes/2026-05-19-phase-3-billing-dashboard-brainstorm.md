<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 — Billing Dashboard + Admin Credentials, Brainstorm

**Date:** 2026-05-19
**Parent plan:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Parent design:** [`../specs/2026-05-19-central-llm-billing-design.md`](../specs/2026-05-19-central-llm-billing-design.md)
**Phase 1 (merged):** [`../plans/2026-05-19-phase-1-central-llm-credentials-plan.md`](../plans/2026-05-19-phase-1-central-llm-credentials-plan.md)
**Phase 2 (merged):** [`../plans/2026-05-19-phase-2-usage-recorder-plan.md`](../plans/2026-05-19-phase-2-usage-recorder-plan.md)

Open exploration before the per-phase design and plan land. Goal: surface
the UX shape, decide where Phase 3 lives in the existing dashboard, lock
the route contract, and resolve the open questions the roadmap lists for
Phase 3.

## Surface area survey

Phase 2 has already landed the data model and read helpers; Phase 3 wires
HTTP routes around them, adds the admin credentials form, and renders both
on the dashboard.

| Location                                     | Today                                                                                                                                                                                     | Phase 3 implication                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/usage/query.ts`                         | `listSubjects(window)` returns `SubjectSummary[]` keyed by `storageContextId`; no `displayName`                                                                                           | Add a join-or-resolver layer that decorates each summary with a best-effort `displayName`                                          |
| `src/usage/types.ts`                         | `SubjectSummary` shape does NOT include `displayName`; design D6 says it does                                                                                                             | Either widen the type or layer a new `BillingSubject` over it; recommend layering in `src/debug/billing.ts` so query stays generic |
| `src/system-config.ts`                       | `getSystemConfig(key)`, `setSystemConfig(key, value, updatedBy)`, `SYSTEM_CONFIG_KEYS`; cache already invalidated on set                                                                  | Add a "list all keys" / "snapshot" helper returning `{ key, hasValue, updatedAt, updatedBy }` for the GET /admin/llm response      |
| `src/debug/server.ts:182-200`                | Plain pattern-match routing with `routeRequest`; no body parsing helper today                                                                                                             | Add 4 routes + a small request-body parser for POST `/admin/llm`                                                                   |
| `src/debug/server.ts:41-48`                  | `isAuthorizedRequest` gates everything on `DEBUG_TOKEN` (Bearer header); no per-route ACL today                                                                                           | Same gate covers `/admin/llm` and `/billing/*` — no new auth surface to design                                                     |
| `client/debug/App.svelte`                    | Single-page panel grid (`SessionsList`, `TraceList`, `TurnsPanel`, `NotificationsPanel`, `ToolFailuresPanel`, `RemindersPanel`, `MemosPanel`, `ContextPanel`) + `LogExplorer`; NO tab nav | Roadmap says "New 'Billing' tab" but today there are no tabs. Two design options below                                             |
| `client/debug/dashboard-types.ts:115-137`    | `DashboardState` carries all live state; `billingSubjects`/`billingDetail` not yet present                                                                                                | Add the two fields plus their handlers (fetch on tab/panel open)                                                                   |
| `client/debug/sse.ts`                        | Live SSE handlers update most panels in real time                                                                                                                                         | Billing data is fetched-on-demand (no SSE event for usage rows). Decision: do we add SSE updates or rely on manual refresh?        |
| `src/users.ts`                               | `users` table has `platformUserId`, `username`                                                                                                                                            | DM subject display = `users.username` lookup by `platformUserId`                                                                   |
| `src/db/schema.ts` — `authorizedGroups`      | `groupId`, `addedBy`, `addedAt` — no title field                                                                                                                                          | Group subject has no canonical title locally; fall through to `group_user_observations` heuristic OR the raw id                    |
| `src/db/schema.ts` — `groupUserObservations` | `(provider, contextId, userId)` keys; per-user labels per group                                                                                                                           | The group itself has no title row; this table stores members, not the group name. So group `displayName` = null (raw id)           |
| `src/embeddings.ts` / `src/web/distill.ts`   | Each `recordUsage` call now writes a row keyed by `(storageContextId, chatUserId)`; both already in scope                                                                                 | No change for Phase 3 (Phase 2 already wires writes)                                                                               |
| `tests/utils/test-helpers.ts`                | `setupTestDb()` mounts an isolated DB and runs migrations; standard pattern                                                                                                               | Server tests use it; route tests use Bun's request-shaped fetch against the handler                                                |

Net: ~3-4 new server files (`src/debug/billing.ts` for the joined-list
helper, route wiring inside `src/debug/server.ts`, possibly a `src/debug/admin-llm.ts`
helper for the POST body parsing), 3-4 new client files (Billing panel +
nested SubjectsTable, SubjectDetail, CredentialsForm), and corresponding
tests.

## Open question A — Tab vs panel in the dashboard

The parent design says "New 'Billing' tab in the dashboard nav". The
current `App.svelte` has no tab nav — it's a single panel-grid view with
modals.

Three options:

- **A1. Introduce a tab navigation component.** Add a tab bar at the top
  of `App.svelte` toggling between the existing panel-grid view and a new
  "Billing" view. Two routes worth of state in a single SPA. Substantial
  UX refactor.
- **A2. Add `BillingPanel.svelte` next to `MemosPanel` etc.** Reuse the
  existing panel-grid layout. Conceptually fits "billing is a slice of
  state, like memos or notifications". Cheapest, minimal UX churn.
- **A3. Separate "/admin" sub-route with its own page.** Conditionally
  render based on a URL `?view=billing` query parameter. The credentials
  form is admin-only so it makes sense to keep it off the default view.

Trade-offs:

- A1 is the roadmap's literal wording but requires inventing tabbed nav
  for a dashboard that doesn't have any.
- A2 keeps the dashboard cohesive; billing fits the "operator overview"
  framing. The credentials form is unique (it's a write surface, all
  other panels are read-only), so it gets visual treatment that makes
  the write nature obvious (a card with an "Edit" gesture).
- A3 introduces a single-page-app router pattern for the first time.
  Heavier than needed for one new view.

**Recommendation:** A2 with a structural twist — the Billing panel is
visually larger than memos/recurring (it has tables and the credentials
form), so it spans both columns of the grid OR sits below the grid as a
dedicated section. The credentials form sits at the top of the Billing
section, the subjects table in the middle, and the subject detail
expands below as a modal (matching `SessionDetail`/`TurnDetail`
patterns).

If operator feedback after Phase 3 ships says "billing is visually
overwhelming the dashboard", we promote it to a tab in a follow-up. That
is a UX call, not a data-model call, so it doesn't paint any corners.

## Open question B — Where does `displayName` come from?

Parent design D6:

> `displayName` is best-effort: join to `users.username` when subject is a
> DM, or to `authorized_groups`/`group_user_observations` (already used by
> the group selector) for a group title. If unknown, return null; the UI
> shows the raw id.

A quick read of the schema:

- DM subjects: `storageContextId == platformUserId`. The `users.username`
  field is populated when the user has set one on the chat platform. Good
  source.
- Group subjects: `storageContextId` is either `groupId` or
  `groupId:threadId`. Local data:
  - `authorized_groups(groupId, addedBy, addedAt)` — no title field.
  - `group_user_observations(provider, contextId, userId, username, displayLabel, lastSeenAt)` — per-user labels INSIDE a group, no group title row.

So the local DB does NOT have a canonical "group title". The bot does not
persist group titles today. Options:

- **B1. Return null for groups.** UI shows the raw `groupId[:threadId]`.
  Operator can correlate manually. Phase 3 ships, follow-up enrichment
  later.
- **B2. Synthesize a label from the group's most-observed member.** Use
  `group_user_observations` to pick e.g. the `displayLabel` of the most
  recently active user, prefixed with `"~"`. Cheap hack, but misleading —
  it's not the group title.
- **B3. Add a `group_titles(groupId, title, updatedAt)` table and a
  capture path.** Substantial cross-cutting work (every chat-provider
  message handler updates it on context render). Out of scope for Phase 3.

**Recommendation:** B1 for now — null displayName for groups, raw id in
the UI. B3 is the proper fix and earns a roadmap entry for Phase 4 or
later. B2 is misleading and not worth shipping.

The DM path uses `users.username`. If that is also null, fall through to
the raw id.

Resolver shape:

```ts
const resolveDisplayName = (storageContextId: string, contextType: ContextType): string | null => {
  if (contextType === 'dm')
    return (
      getDrizzleDb()
        .select({ username: users.username })
        .from(users)
        .where(eq(users.platformUserId, storageContextId))
        .get()?.username ?? null
    )
  // group → null in v1
  return null
}
```

Batched in `listSubjects` (single `WHERE platformUserId IN (...)`)
because per-call lookups in a 100-subject list are wasteful.

## Open question C — Window selector parsing

Roadmap says "24h / 7d / 30d / all". The query module already takes
`{ windowMs: number | null }`.

The route accepts `?window=30d` (string). Parsing options:

- **C1. Whitelist exact strings.** `"24h" | "7d" | "30d" | "all"`. Reject
  everything else with 400.
- **C2. Parse a duration string.** Any `<number>[smhd]` works. More
  expressive but invites edge cases (`"100y"`, `"0s"`).
- **C3. Numeric ms.** Like Prometheus' rangeMs. Operator-friendly but
  not user-facing.

**Recommendation:** C1. Whitelist exactly the four values listed in the
roadmap. Map `"24h" → 86_400_000`, `"7d" → 604_800_000`,
`"30d" → 2_592_000_000`, `"all" → null`. Default to `"30d"` when missing.
Reject other values with 400 to avoid silent fallback.

## Open question D — `displayName` join vs in-process resolver

Two implementations:

- **D1. SQL LEFT JOIN inside `listSubjects`.** Single query, single
  result set. Couples `query.ts` to the `users` and authorized-groups
  tables — Phase 2's `query.ts` deliberately stays generic.
- **D2. Separate decorator in `src/debug/billing.ts`.** Calls
  `listSubjects()`, then resolves names in a follow-up batched query.
  Keeps `query.ts` table-scoped to `llm_usage_events`.

**Recommendation:** D2. `query.ts` keeps its single-responsibility shape
(usage-event aggregates only); the dashboard-shaped output (with
`displayName`) lives next to the route in `src/debug/billing.ts`. That
file is also where the window-string-to-ms parsing logic sits.

## Open question E — POST `/admin/llm` body shape and validation

Parent design D6 says: `POST /admin/llm` with `{ key, value }`.

- `key` must be one of `SYSTEM_CONFIG_KEYS` from `src/system-config.ts`
  (already exported).
- `value` must be a non-empty string. Trim whitespace.
- Other keys (e.g. `kaneo_apikey`) MUST NOT be settable through this
  endpoint — it is LLM-specific. The endpoint name `/admin/llm` signals
  scope, but the validator enforces it.

Validation library: Zod is already the standard (`CLAUDE.md` "Key
Conventions"). Add a tiny `BodySchema` per route.

The `updatedBy` field on the row is the bot admin identity. Today we
authenticate with `DEBUG_TOKEN` — that's a shared secret, not a user
identity. Options:

- **E1. `updatedBy = "debug-token"`.** Honest but uninformative.
- **E2. `updatedBy = ADMIN_USER_ID` (from env).** Better — every admin
  edit attributes to the registered bot admin. Single-tenant assumption
  matches the v1 reality.
- **E3. Add a separate `ADMIN_DASHBOARD_USER` env override.** Overkill.

**Recommendation:** E2 — read `ADMIN_USER_ID` (already required at
startup) and use that as the `updated_by` value. If the bot grows to
multiple admins, the auth layer changes and `updated_by` becomes more
meaningful.

Error responses:

- 401 if `DEBUG_TOKEN` missing or wrong (existing gate).
- 400 if the body is malformed, the key is unknown, or `value` is empty
  after trim.
- 500 if the DB write fails (should never happen but defensive logging).

Success response: `{ ok: true, key, updatedAt }` — does NOT echo back the
new value (which would defeat the purpose of masking on GET).

## Open question F — GET `/admin/llm` masking strategy

Today, `setSystemConfig` writes the value verbatim. The GET endpoint must
NOT return the API key in cleartext. Two options:

- **F1. Return `null` for `llm_apikey`, return the rest as-is.** The UI
  knows the value is "set but hidden" via a `hasValue: true` flag.
- **F2. Return masked values everywhere (`\*\***6f5a`).** Match the
existing `maskValue`helper that`src/config.ts`uses for`kaneo_apikey`.

Looking at `src/config.ts`: `maskValue` keeps the last 4 chars. Useful
for "did we paste the right key" verification.

**Recommendation:** F2 — mask using the existing helper. Apply it ONLY
to `llm_apikey`. The other keys (`llm_baseurl`, `main_model`,
`small_model`, `embedding_model`) return verbatim because they're not
secrets. The response shape:

```ts
type AdminLlmSnapshot = {
  llm_apikey: {
    value: string | null /* masked */
    updatedAt: number | null
    updatedBy: string | null
  }
  llm_baseurl: {
    value: string | null /* cleartext */
    updatedAt: number | null
    updatedBy: string | null
  }
  main_model: {
    value: string | null /* cleartext */
    updatedAt: number | null
    updatedBy: string | null
  }
  small_model: {
    value: string | null /* cleartext */
    updatedAt: number | null
    updatedBy: string | null
  }
  embedding_model: {
    value: string | null /* cleartext */
    updatedAt: number | null
    updatedBy: string | null
  }
}
```

`null` value means "row absent in `system_config`" (operator hasn't seeded
yet).

## Open question G — Refresh strategy on the dashboard

Usage rows are produced by the recorder, not the SSE bus. Three options
for keeping the Billing panel fresh:

- **G1. Fetch once on panel mount.** Static snapshot until the operator
  refreshes the page.
- **G2. Periodic refetch (e.g. every 30s).** Polling. Simple, costs a few
  queries per minute.
- **G3. Add an SSE event for `usage:recorded`.** The recorder emits
  `usage:recorded` to the bus after a successful insert; the dashboard
  appends/updates its in-memory state. No refetch.

Trade-offs:

- G1 is fine for ops eyeballing, but a sustained conversation means
  the table is stale by the time they look.
- G2 adds polling load on a small SQLite query; bounded by the window.
- G3 is the cleanest but couples Phase 3 to a Phase-2-public-surface
  extension (the recorder doesn't currently emit anything; it's a sink).

**Recommendation:** G1 in v1 plus a manual "Refresh" button on the
Billing panel. Operator-driven polling. G3 is appealing but earns its
place when usage volume makes manual refresh feel slow. Document G3 as a
follow-up if Phase 3 ships and the operator complains.

The credentials form is special: after a successful POST, the GET is
re-fetched automatically (the form does it inline). No polling needed —
the operator just changed it.

## Open question H — Subject detail rendering shape

The roadmap says: "Bottom half: when a row is clicked, fetch
`/billing/subject/:id` and show a virtualized table of requests".

Volume estimate: a busy DM might produce 50-200 LLM calls per day. With
a 30d window, that's 1.5k-6k rows. A naive table renders that fine. True
virtualization is overkill for v1.

- **H1. Plain `{#each}` table.** Simple. Slow if the DB has 50k+ rows
  for one subject (unlikely in current operator deployments).
- **H2. Paginated table.** 50 rows per page. Same complexity as today's
  log explorer.
- **H3. True virtualization (`svelte-virtual-list` or similar).** New
  dependency for marginal benefit.

**Recommendation:** H1 plus a SQL `LIMIT 500` server-side cap. If a
subject has more than 500 rows in the window, the response includes
`"truncated": true` and the UI shows a banner. Operator can shorten the
window. No new dependencies.

## Open question I — `:id` URL encoding for group subjects

For thread-scoped groups, `storageContextId` looks like `123456:7890`
(Telegram channel:thread). The colon is allowed in URLs but it's a
reserved character; we should URL-encode it client-side and decode
server-side.

- Client: `encodeURIComponent(storageContextId)`.
- Server: `decodeURIComponent(req.params.id)` via `URL` parsing.

Bun's URL parsing handles this. The route handler reads
`url.pathname.slice('/billing/subject/'.length)` and runs it through
`decodeURIComponent`. Test fixture covers the colon case.

## Open question J — Test strategy

Server-side route tests have two competing patterns in the codebase:

- **J1. Direct handler-function test.** Call the route function with a
  hand-built `Request` and assert the `Response`. Mirrors
  `tests/debug/server-billing.test.ts` from the parent design.
- **J2. Bun.serve up + real fetch().** Spin up the real server in the
  test, fetch the route, parse the response. Closer to integration but
  flaky if ports are taken.

**Recommendation:** J1. The route handler is a pure function from
`Request` to `Response`. Mock `DEBUG_TOKEN`, seed
`llm_usage_events`/`system_config` via Drizzle, call the handler. Same
shape `tests/debug/server-billing.test.ts` is meant to take per the
parent design.

Client-side tests use `tests/client-setup.ts` (happy-dom) with
`bun test:client`. Existing pattern in `tests/client/` covers Svelte 5
runes. Three new test files:

- `tests/client/billing/SubjectsTable.test.ts` — renders subjects,
  click triggers fetch, error state.
- `tests/client/billing/SubjectDetail.test.ts` — renders requests, row
  expansion shows raw JSON.
- `tests/client/billing/CredentialsForm.test.ts` — masked display, edit
  reveals input, submit POSTs and re-fetches GET.

## Open question K — Validation order in `routeRequest`

`routeRequest` runs `isAuthorizedRequest` first. Phase 3 routes inherit
that.

For POST `/admin/llm`:

- Auth (existing).
- Method check (only POST; GET is the read).
- Content-Type check (must be `application/json`).
- Zod-parse body.
- Resolve `updatedBy` from env.
- Call `setSystemConfig`.
- Return 200 with `{ ok: true, key, updatedAt }`.

The bot already has structured logging at `info`/`warn`/`error`. The
admin route logs:

- `info`: "system_config key set via dashboard" + `{ key, updatedBy }`
- `warn`: "admin/llm rejected" + `{ reason, status }` for 400/401
- never `error` for user mistakes; only for actual DB failures

## Open question L — Server-Sent Events bus for usage updates

Already touched in (G). Affirming for the design: no SSE for usage in
v1. The bus could be extended later; the cost today (an event handler
per recorder write) is small but the dashboard refetch story is fine.

## Open question M — Operator audit trail

`system_config.updated_by` already records who changed each row. The
roadmap mentions an "admin route audit log records the change with
`updated_by`". Two interpretations:

- **M1. The structured log line is the audit trail.** No new table.
  Pino logs go to stdout/file; the operator runs `journalctl` or
  `tail` to inspect.
- **M2. A new `admin_audit(timestamp, action, key, updatedBy)` table.**
  Phase-3-scope creep.

**Recommendation:** M1. The Pino info-level log line is the audit trail;
`system_config.updated_by` + `updated_at` is the structured-row trail.
Operators with a real auditing requirement can pipe Pino to a sink. No
new table.

## Open question N — Idempotent POST and retry behavior

`setSystemConfig` is an UPSERT (`onConflictDoUpdate`). The POST is
naturally idempotent — submitting the same key/value twice is harmless.
No special retry handling.

The client form does not optimistic-update; it waits for the POST
response, then refetches GET. Simple and correct.

## Things explicitly NOT to do in Phase 3

- No charts (roadmap: "very basic", tables only).
- No CSV/JSON export of usage rows.
- No DM `/admin` command (deferred per parent design D4).
- No per-tool drill-down (Phase 4 territory).
- No new SSE event types for usage (Phase 5 or later if needed).
- No identity merge (subject keys stay opaque `platform_user_id` / group ids).
- No edit/delete of historical `llm_usage_events` rows. Read-only.
- No "test connection" button on the credentials form (would require
  actually invoking the LLM; out of scope for a basic form).
- No CSRF token — `DEBUG_TOKEN` is bearer-style, same-origin policy +
  the token gate is sufficient for a local-only debug surface.

## Risks identified by the brainstorm that weren't in the parent doc

1. **`DEBUG_TOKEN` is optional in dev.** When unset, the dashboard runs
   without auth. `POST /admin/llm` with no token effectively means
   anyone reaching the port can rewrite the LLM API key. Mitigation:
   require `DEBUG_TOKEN` to be set before `POST /admin/llm` returns
   anything other than 503 "credentials API disabled". GET routes can
   still run in dev without a token (read-only), but the write endpoint
   refuses to operate without it. Document this in the env-vars table.
2. **`maskValue` requires importing from `src/config.ts`.** That file
   also has a long list of LLM-key cleanup helpers; check that
   `maskValue` is still exported after Phase 1's cleanup. If not,
   re-export from `system-config.ts` or extract to `src/mask.ts`.
3. **Subject id with a colon hits Bun's URL parser, not our regex.**
   `URL.pathname` decodes path segments; the slice approach used in
   `handleTurnLookup` only works because turn ids are ULIDs. For the
   billing route, use `req.params`-style extraction or
   `decodeURIComponent` after slicing.
4. **The dashboard's `dashboard.svelte.ts` initializes `DashboardState`
   with empty defaults; Billing-fetched data must not overwrite live
   state on subsequent renders.** The fetch handlers must merge into
   `billingSubjects` / `billingDetail` only, leaving everything else
   alone. Existing pattern from `handleMemos`-style handlers covers
   this.
5. **The credentials form is the ONLY write path in the dashboard.**
   Every other panel is read-only. We need a clear visual indication
   (input fields, "Save" button styled distinctly) so an operator
   doesn't accidentally type into a read-only field. Phase 3 ships the
   first write UI in the dashboard.
6. **`getLlmConfig` caches `system_config` rows in-process.** The
   `setSystemConfig` call already invalidates that cache. Test: write a
   new key, immediately call `getLlmConfig`, confirm the new value
   takes effect without restart. (Phase 1 already covered this but
   re-verify in Phase 3's smoke checklist.)
7. **`bun build:client` must include the new components.** Phase 3
   ships SvelteKit-style components; the build pipeline already bundles
   `client/debug/` into `public/dashboard.js`. Verify the build picks
   up `client/debug/billing/*.svelte` automatically (it should — the
   bundler is glob-based or it imports from `App.svelte`).

## Forward-compatibility check

- **Phase 4 (tool-call rows).** Adds `tool_call_events` table; Billing
  tab gains a "Tools" section showing per-tool aggregates. The
  subject-detail rows already display `toolCallCount`, so the upgrade
  is additive. ✓
- **Phase 5 (anonymous DB stats).** New `/stats/*` routes alongside
  `/billing/*`. The dashboard wires a new "Stats" panel/tab next to
  Billing. Read-only join over the same tables, but with a forbidden-
  substring test on the response payload. Phase 3's `src/debug/billing.ts`
  helper structure is the template for `src/debug/stats.ts`. ✓
- **Future SSE for usage.** `usage:recorded` event added to the bus,
  dashboard subscribes; Billing panel becomes live. No DB change. ✓
- **Future CSV export.** GET `/billing/subjects.csv` next to the JSON
  endpoint. Trivial Phase 4+ add. ✓

No corners painted.

## Summary of decisions to lift into the per-phase design

1. **Layout:** `BillingPanel.svelte` slotted into the existing
   panel-grid (option A2). Credentials form at top, subjects table in
   the middle, detail rendered as a modal (matching session/turn detail
   modals).
2. **Display name:** DM = `users.username` (best-effort), group = null.
   Batched lookup in `src/debug/billing.ts`. No new table for group
   titles; raw id in UI when null.
3. **Routes:** `GET /billing/subjects?window=24h|7d|30d|all`,
   `GET /billing/subject/:id?window=...`, `GET /admin/llm`,
   `POST /admin/llm`. All gated by `DEBUG_TOKEN`. `POST` additionally
   refuses to run when `DEBUG_TOKEN` is unset.
4. **Window:** whitelist `24h | 7d | 30d | all`. Default `30d`. Reject
   other values with 400.
5. **Body validation:** Zod schema for POST `/admin/llm` with `key` in
   `SYSTEM_CONFIG_KEYS` and `value: z.string().trim().min(1)`.
   `updatedBy` resolved from `ADMIN_USER_ID` env var.
6. **GET masking:** `llm_apikey` masked via the existing helper; other
   keys returned in cleartext. Each key gets `{ value, updatedAt,
updatedBy }`.
7. **Subject detail:** SQL `LIMIT 500`; UI shows a "truncated" banner
   beyond that.
8. **Refresh:** manual button per panel. No SSE for usage rows in v1.
9. **Audit:** structured Pino info log + `system_config.updated_by`
   row column. No new audit table.
10. **Tests:** route handler tests in `tests/debug/server-billing.test.ts`;
    client tests in `tests/client/billing/`. DI-first per
    `tests/CLAUDE.md`.
11. **Modules:**
    - `src/debug/billing.ts` — `listBillingSubjects(window)`,
      `getBillingDetail(id, window)`, `parseWindow(string)` helper.
    - `src/debug/admin-llm.ts` — `getAdminLlmSnapshot()` (with masking),
      `applyAdminLlmUpdate(body)` (validation + setSystemConfig).
    - `src/debug/server.ts` — 4 new route branches in `routeRequest`.
    - `client/debug/billing/SubjectsTable.svelte`
    - `client/debug/billing/SubjectDetail.svelte`
    - `client/debug/billing/CredentialsForm.svelte`
    - `client/debug/components/BillingPanel.svelte` (the container)

## Out of brainstorm (carry to plan, not design)

- Exact test file locations and T-then-I sequencing for each substep.
- Whether to ship the credentials form and the subjects table in
  separate commits or one.
- Manual smoke checklist (open dashboard → see one subject → drill in →
  paste a key in form → confirm bot picks it up without restart).
- Whether to require `ADMIN_USER_ID` to match a header value on POST
  (defense-in-depth on top of `DEBUG_TOKEN`). Recommend NO for v1; the
  shared-secret model is the contract.

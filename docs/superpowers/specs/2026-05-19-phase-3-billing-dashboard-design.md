<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 — Billing Dashboard + Admin Credentials — Design Refinement

**Date:** 2026-05-19
**Status:** Draft, refining parent spec for Phase 3 scope
**Parent design:** [`2026-05-19-central-llm-billing-design.md`](./2026-05-19-central-llm-billing-design.md)
**Roadmap:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Brainstorm:** [`../notes/2026-05-19-phase-3-billing-dashboard-brainstorm.md`](../notes/2026-05-19-phase-3-billing-dashboard-brainstorm.md)
**Branch:** `claude/phase-3-llm-billing-pMOsy`

## Purpose of this document

The parent design covers all three phases. This file narrows its
decisions to Phase 3 and lifts the brainstorm's resolutions. Where this
file and the parent disagree, this file wins for Phase 3 only.

## Phase 3 in one paragraph

Wire HTTP routes around the Phase 2 `src/usage/query.ts` aggregates
(`GET /billing/subjects`, `GET /billing/subject/:id`), add a dashboard
"Billing" panel that renders the subjects table and a click-through
detail modal, and ship the LLM credentials admin surface (`GET
/admin/llm`, `POST /admin/llm`) backed by the Phase 1 `setSystemConfig`
helper. The credentials form lives at the top of the Billing panel; the
GET response masks `llm_apikey`; the POST refuses to operate when
`DEBUG_TOKEN` is unset. No SSE, no charts, no DM `/admin` command, no
tool-call drill-down — those belong to later phases.

## Decisions for Phase 3

### D1. Dashboard layout — panel, not tab

The current `client/debug/App.svelte` is a single panel-grid view with
modals. Introducing a tab nav is out of scope; Billing slots in as a new
panel alongside `MemosPanel`, `RemindersPanel`, etc. The panel spans the
panel-grid normally and renders three stacked sections:

1. **Credentials form** (write surface) — top of the panel.
2. **Subjects table** (read surface) — middle.
3. **Detail modal** — opens on row click; mirrors `SessionDetail`,
   `TurnDetail`, `FailureDetail` patterns.

If post-Phase-3 feedback says the panel is visually overwhelming, a
follow-up promotes it to a tab. No data model changes if that happens.

### D2. Window selector

Whitelist exactly four values: `24h | 7d | 30d | all`. Map server-side:

```ts
const WINDOWS: Record<string, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null,
}
```

Default `30d`. Unknown values return HTTP 400 (no silent fallback).
Client UI exposes the four labels as a `<select>`; default selection is
`30d`.

### D3. Display name resolver

DM: `users.username` looked up by `platformUserId`. Group: `null` in v1
(local DB has no group title; raw id rendered by the UI).

Batched in a single `WHERE platformUserId IN (...)` query so the
resolver does not produce N+1 lookups for a 100-subject list.

```ts
// in src/debug/billing.ts
const resolveDisplayNames = (subjects: readonly SubjectSummary[]): ReadonlyMap<string, string | null> => {
  const dmIds = subjects.filter((s) => s.contextType === 'dm').map((s) => s.storageContextId)
  if (dmIds.length === 0) return new Map()
  const rows = getDrizzleDb()
    .select({ id: users.platformUserId, username: users.username })
    .from(users)
    .where(inArray(users.platformUserId, dmIds))
    .all()
  return new Map(rows.map((r) => [r.id, r.username ?? null]))
}
```

### D4. Module layout — `src/debug/billing.ts` and `src/debug/admin-llm.ts`

Keep `src/usage/query.ts` table-scoped (raw aggregates). The
dashboard-shaped types and resolvers live in a dashboard-adjacent module:

```text
src/debug/
  billing.ts          — listBillingSubjects(window), getBillingDetail(id, window), parseWindow()
  admin-llm.ts        — getAdminLlmSnapshot(), applyAdminLlmUpdate({ key, value }, updatedBy)
  server.ts           — 4 new route branches in routeRequest
```

`src/debug/billing.ts` exports:

```ts
type Window = '24h' | '7d' | '30d' | 'all'

type BillingSubject = SubjectSummary & {
  displayName: string | null
}

type BillingDetail = {
  subject: BillingSubject
  requests: readonly RequestRow[]
  truncated: boolean // true when the SQL LIMIT capped the result
}

export const parseWindow = (raw: string | null): Window | null
export const windowToMs = (w: Window): number | null
export const listBillingSubjects = (w: Window): readonly BillingSubject[]
export const getBillingDetail = (id: string, w: Window): BillingDetail | null
```

`null` from `getBillingDetail` means "no rows for this subject in this
window" → route returns 404.

The subject-detail SQL is the existing `getSubjectDetail` from
`src/usage/query.ts` plus a hard `LIMIT 501` (501 so we can detect
"more than 500 exists" by length > 500). Server caps at 500 in the
response and sets `truncated: true`.

`src/debug/admin-llm.ts` exports:

```ts
type AdminLlmKeyState = {
  value: string | null      // masked for llm_apikey, cleartext otherwise; null if row absent
  updatedAt: number | null
  updatedBy: string | null
}

type AdminLlmSnapshot = Record<SystemConfigKey, AdminLlmKeyState>

export const getAdminLlmSnapshot = (): AdminLlmSnapshot
export const applyAdminLlmUpdate = (body: unknown, updatedBy: string): { key: SystemConfigKey; updatedAt: number }
```

`applyAdminLlmUpdate`:

1. Parses the body with a Zod schema:
   `{ key: enum(SYSTEM_CONFIG_KEYS), value: string().trim().min(1) }`.
2. Throws a typed error on validation failure (route maps to 400).
3. Calls `setSystemConfig(parsed.key, parsed.value, updatedBy)`.
4. Returns `{ key, updatedAt: Date.now() }`.

### D5. Routes

| Method | Path                              | Behavior                                                                                                                                                                                |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/billing/subjects?window=30d`    | Returns `{ subjects: BillingSubject[], window }`. 400 on unknown window.                                                                                                                |
| GET    | `/billing/subject/:id?window=30d` | Returns `BillingDetail`. 404 if no rows. 400 on unknown window. `:id` decoded with `decodeURIComponent`.                                                                                |
| GET    | `/admin/llm`                      | Returns `AdminLlmSnapshot`. Masks `llm_apikey`. Requires `DEBUG_TOKEN` (existing gate).                                                                                                 |
| POST   | `/admin/llm`                      | Body `{ key, value }`. 400 on bad body. 401 if `DEBUG_TOKEN` missing/wrong OR if `DEBUG_TOKEN` unset in env. 503 if `ADMIN_USER_ID` unset (cannot resolve `updatedBy`). 200 on success. |

POST `/admin/llm` extra refusal: if `DEBUG_TOKEN` is unset (i.e. the
dashboard is in unauthenticated-dev-mode), the route returns 401 with
`{ error: 'credentials API requires DEBUG_TOKEN' }`. Read routes still
work without a token in that mode; only writes refuse.

### D6. Masking strategy

A new helper `maskSystemConfigValue(key, value)` lives in
`src/system-config.ts` next to `setSystemConfig`. It masks only
`llm_apikey` (last 4 chars retained, `****XXXX` format); other keys
return verbatim. The shape matches `maskValue` in `src/config.ts` but
keyed on `SystemConfigKey`.

```ts
export const maskSystemConfigValue = (key: SystemConfigKey, value: string): string => {
  if (key === 'llm_apikey') return `****${value.slice(-4)}`
  return value
}
```

The route reads each `system_config` row through `getSystemConfig(key)`
and `system_config` table for `updatedAt`/`updatedBy`. New helper
`listSystemConfigEntries()` in `src/system-config.ts` returns
`Array<{ key, value, updatedAt, updatedBy }>` straight from the table;
`getAdminLlmSnapshot` masks the value per-key, joins with
`SYSTEM_CONFIG_KEYS` so missing rows are returned with `null` value.

### D7. Auth and `updatedBy`

`isAuthorizedRequest` already gates everything on `DEBUG_TOKEN`. Phase 3
adds:

- If `DEBUG_TOKEN` is unset in env, POST `/admin/llm` returns 401 with
  the message documented in D5. This is the "fail-closed when unauthed"
  rule the brainstorm identified.
- `updatedBy` for `setSystemConfig` comes from `process.env.ADMIN_USER_ID`
  (already required at startup per CLAUDE.md). If absent at write time
  (impossible if startup checks ran, but defensive), the route returns
  503 with `{ error: 'admin user id not configured' }`.

No CSRF token. The dashboard is bound to `127.0.0.1` by default
(`DEBUG_HOSTNAME=127.0.0.1`), and the bearer-token gate is the contract.

### D8. Response shapes (final)

```ts
// GET /billing/subjects
{
  window: '24h' | '7d' | '30d' | 'all',
  subjects: Array<{
    storageContextId: string,
    contextType: 'dm' | 'group',
    displayName: string | null,
    totals: {
      main:      { inputTokens: number, outputTokens: number, calls: number },
      small:     { inputTokens: number, outputTokens: number, calls: number },
      embedding: { inputTokens: number, outputTokens: number, calls: number },
    },
    toolCalls: number,
    lastActiveAt: number,
  }>,
}

// GET /billing/subject/:id
{
  window: '24h' | '7d' | '30d' | 'all',
  subject: BillingSubject,         // same as above, one entry
  requests: Array<{
    eventId: string,
    occurredAt: number,
    turnId: string | null,
    chatUserId: string,
    model: string,
    modelRole: 'main' | 'small' | 'embedding',
    inputTokens: number | null,
    outputTokens: number | null,
    stepCount: number,
    toolCallCount: number,
    messageCount: number,
    durationMs: number,
    finishReason: string | null,
    error: string | null,
  }>,
  truncated: boolean,
}

// GET /admin/llm
{
  llm_apikey:      { value: string | null, updatedAt: number | null, updatedBy: string | null },
  llm_baseurl:     { value: string | null, updatedAt: number | null, updatedBy: string | null },
  main_model:      { value: string | null, updatedAt: number | null, updatedBy: string | null },
  small_model:     { value: string | null, updatedAt: number | null, updatedBy: string | null },
  embedding_model: { value: string | null, updatedAt: number | null, updatedBy: string | null },
}

// POST /admin/llm — request
{ key: string, value: string }

// POST /admin/llm — response (200)
{ ok: true, key: string, updatedAt: number }

// POST /admin/llm — response (400)
{ error: string }

// POST /admin/llm — response (401)
{ error: string }
```

### D9. Refresh strategy

Manual refresh in v1. The Billing panel renders a "Refresh" button next
to its title that re-fetches `/billing/subjects` with the current
window. No polling, no SSE.

After a successful POST `/admin/llm`, the form re-fetches `/admin/llm`
inline so the masked value updates without a manual refresh.

### D10. Dashboard state shape additions

`client/debug/dashboard-types.ts` gains:

```ts
type BillingSubject = {
  storageContextId: string
  contextType: 'dm' | 'group'
  displayName: string | null
  totals: {
    main: { inputTokens: number; outputTokens: number; calls: number }
    small: { inputTokens: number; outputTokens: number; calls: number }
    embedding: { inputTokens: number; outputTokens: number; calls: number }
  }
  toolCalls: number
  lastActiveAt: number
}

type BillingDetail = {
  subject: BillingSubject
  requests: ReadonlyArray<RequestRow>
  truncated: boolean
}

type AdminLlmKeyState = {
  value: string | null
  updatedAt: number | null
  updatedBy: string | null
}

type AdminLlmSnapshot = {
  llm_apikey: AdminLlmKeyState
  llm_baseurl: AdminLlmKeyState
  main_model: AdminLlmKeyState
  small_model: AdminLlmKeyState
  embedding_model: AdminLlmKeyState
}

interface DashboardState {
  // ... existing
  billingWindow: '24h' | '7d' | '30d' | 'all'
  billingSubjects: BillingSubject[]
  billingDetail: BillingDetail | null
  adminLlm: AdminLlmSnapshot | null
}
```

Initial values: `billingWindow='30d'`, empty array, nulls. The fetcher
runs from the App mount and from the panel's Refresh button.

### D11. Component layout

```text
client/debug/billing/
  BillingPanel.svelte       — container: header, refresh button, mounts the three sub-components
  CredentialsForm.svelte    — masked rows; "Edit" per key; submits POST then re-fetches GET
  SubjectsTable.svelte      — sortable table; click opens detail
  SubjectDetail.svelte      — renders inside a Modal; per-request rows + expandable JSON
```

`BillingPanel.svelte` is the entry exported into `App.svelte`. It owns
the window selector and the refresh action. The three sub-components are
"dumb" presentational and consume slices of `DashboardState`.

The detail panel mounts inside a Modal (matching session/turn/failure
detail panels). Modal open state is tracked locally in `App.svelte`
(same shape as `selectedSession`).

### D12. Logging and PII

Same rules as parent design D7:

- Never log `llm_apikey` value.
- Log structured info on every credentials change:
  `{ key, updatedBy }`. NEVER include `value`.
- Billing routes log scope = `billing` at debug for happy path; warn
  for 400/401; error for 500.

### D13. Out-of-scope reaffirmed

- No SSE event for `usage:recorded`.
- No DM `/admin` command.
- No tool-call drill-down (Phase 4).
- No CSV/JSON export.
- No identity merge.
- No "test connection" button on the credentials form.
- No CSRF token.

## Test plan (refined for Phase 3)

| Test                                           | What it covers                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `tests/debug/billing-route.test.ts`            | Window parsing, 400s, GET /billing/subjects shape, GET /billing/subject/:id shape, 404, truncation flag at LIMIT  |
| `tests/debug/admin-llm-route.test.ts`          | GET masking, POST validation (400), unauthed POST (401 when DEBUG_TOKEN unset), success path, audit log emitted   |
| `tests/debug/billing.test.ts`                  | `listBillingSubjects` resolves DM display names, leaves group names null, parses window correctly                 |
| `tests/debug/admin-llm.test.ts`                | `getAdminLlmSnapshot` masks llm_apikey, returns null for missing keys, `applyAdminLlmUpdate` rejects unknown keys |
| `tests/system-config.test.ts` (extend)         | `maskSystemConfigValue`, `listSystemConfigEntries`                                                                |
| `tests/client/billing/BillingPanel.test.ts`    | Renders three children; refresh button triggers fetch                                                             |
| `tests/client/billing/SubjectsTable.test.ts`   | Renders subjects; click selects                                                                                   |
| `tests/client/billing/SubjectDetail.test.ts`   | Renders rows; row expansion shows JSON                                                                            |
| `tests/client/billing/CredentialsForm.test.ts` | Masked display; edit reveals input; submit POSTs then re-fetches                                                  |

E2E out of scope (matches parent design — Phase 3 is internal admin
surface).

## Files touched

| File                                          | Change                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/system-config.ts`                        | Add `maskSystemConfigValue`, `listSystemConfigEntries`                                                           |
| `src/debug/billing.ts`                        | NEW — billing aggregation + window parsing                                                                       |
| `src/debug/admin-llm.ts`                      | NEW — admin LLM snapshot + apply                                                                                 |
| `src/debug/server.ts`                         | 4 new route branches + a `parseJsonBody` helper                                                                  |
| `client/debug/dashboard-types.ts`             | Add `BillingSubject`, `BillingDetail`, `AdminLlmSnapshot`, state slots                                           |
| `client/debug/dashboard.svelte.ts`            | Initial values for the new state slots                                                                           |
| `client/debug/billing/BillingPanel.svelte`    | NEW                                                                                                              |
| `client/debug/billing/CredentialsForm.svelte` | NEW                                                                                                              |
| `client/debug/billing/SubjectsTable.svelte`   | NEW                                                                                                              |
| `client/debug/billing/SubjectDetail.svelte`   | NEW                                                                                                              |
| `client/debug/App.svelte`                     | Slot `BillingPanel` into the panel grid; modal open state for detail                                             |
| `client/debug/handlers-extras.ts`             | NEW handlers OR extend existing: `fetchBillingSubjects`, `fetchBillingDetail`, `fetchAdminLlm`, `submitAdminLlm` |

## Open questions for the next session

1. **Group title capture.** Should a future phase add a
   `group_titles(groupId, title)` table populated by the chat-provider
   message handlers, so the UI can show meaningful group names? Defer
   until Phase 3 ships and operator feedback requests it.
2. **Per-tool drill-down.** Phase 4 spawns from data observed in
   Phase 3. Watch for "I want to know which tool burned the tokens"
   feedback.
3. **Live billing via SSE.** Reconsider once usage volume makes manual
   refresh feel slow.
4. **Multiple admin identities.** `updatedBy` is currently
   `ADMIN_USER_ID` only. If the bot adds a multi-admin model, the
   dashboard must convey "which admin am I" to the route. Out of scope.

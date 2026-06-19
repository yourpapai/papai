<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin & Debug Dashboard Fixes — Verification + Spec

Status: in progress (issues 1–4, 6 implemented; see Implementation status)
Date: 2026-06-18
Scope: `client/admin/`, `client/debug/`, `src/debug/`, `src/stats/`, `src/usage/`

This document verifies the reported issues against the current code, records the
root cause for each, and specifies the fix. Each issue is tagged
**CONFIRMED**, **PARTIAL** (real problem, but the reported symptom is imprecise),
or **REFUTED** (the code already does this — the real problem is elsewhere).

---

## 1. Admin charts show hardcoded values with no legend/explanation — **CONFIRMED**

### Verification

- **Hardcoded token KPI.** `client/admin/sections/OverviewSection.svelte:66`
  literally hardcodes the "tokens" metric card to an em-dash:
  ```ts
  // Tokens are not always present; show placeholder if unavailable.
  const tokenTotal = $derived('—')
  const tokenSub = $derived<string | undefined>(undefined)
  ```
  rendered at line 106 as `<MetricCard label="tokens" value={tokenTotal} ... />`.
  This is never populated even though token totals **are** available from the
  stats backend (`GlobalStats.llmUsage.inputTokensTotal` / `outputTokensTotal`,
  `src/stats/types.ts:189-196`).
- **Mislabeled / unexplained charts.** The panel titled `subject growth · 30d`
  (`OverviewSection.svelte:110`) stacks two unrelated charts: a `Spark` of subject
  growth **and** a `Bars` chart of top-tool success counts (`barsData`,
  lines 73-77). The Bars chart has nothing to do with "subject growth" and is not
  labeled. The `count * successRate` derivation is also undocumented in the UI.
- **No axis labels / legend / units / tooltips.** `client/shared/ui/Bars.svelte`
  and `client/shared/ui/Spark.svelte` render bare SVG `<rect>`/`<path>` with no
  axis text, gridlines, legend, or hover values. Same in
  `StatsSection.svelte:220-224` (`toolCallGrowth30d` bars).

### Root cause

Charts were built as decorative sparklines; the data plumbing for tokens was
stubbed and never finished.

### Spec

1. **Populate the token KPI.** Replace the hardcoded `'—'` in
   `OverviewSection.svelte` with values derived from the global-stats payload:
   - `tokenTotal` = `fmtNum(inputTokensTotal + outputTokensTotal)`.
   - `tokenSub` = `"{in} in · {out} out"`.
   - Keep an em-dash fallback only when `adminGlobals.data?.llmUsage` is
     genuinely `undefined` (loading), not unconditionally.
2. **Give every chart a caption + unit line.** Extend `Spark`/`Bars` (or wrap
   them) with optional `caption`, `unit`, and `ariaLabel` props and a small
   value-on-hover affordance. Each chart panel must state: what is plotted, the
   bucket size, and the unit (e.g. "daily new DMs+groups, last 30 days").
3. **Split the mislabeled panel.** Move the top-tools `Bars` chart out of the
   "subject growth" panel into its own captioned panel ("top tools by successful
   calls · all-time"), or relabel the combined panel honestly.
4. **Show min/max/last endpoints.** For sparkline-style charts, render the
   first/last value and the peak as text so a legend-free chart is still
   readable.

---

## 2. No clear token usage over a time period — **CONFIRMED**

### Verification

- Token data is only ever exposed as **all-time-within-a-window totals**:
  - Per-subject: `src/stats/per-table-usage.ts:23-38` sums `inputTokens` /
    `outputTokens` with no time grouping; `getSubjectStats` ignores the window
    entirely for token totals.
  - Global: `src/stats/global-llm.ts:21-61` groups by `modelRole` and applies a
    single window cutoff (`1d`/`7d`/`30d`/`all`) but returns one scalar per role —
    no per-day series.
  - Billing per-subject totals (`src/debug/billing.ts`, `src/usage/query.ts:58-76`)
    are likewise window-summed, not bucketed.
- The **only** time-bucketed series that exists is _tool calls per day_
  (`src/stats/global-web-tools.ts:88-102`, `toolCallGrowth30d`). There is no
  equivalent for tokens.
- Consequence: a `BillingSubject` shows lifetime "input / output" counts
  (`SubjectsTable.svelte:42-46`); there is no way to answer "tokens spent last
  week vs the week before."

### Root cause

The schema fully supports time bucketing — `llm_usage_events.occurredAt` is an
indexed integer ms timestamp (`src/db/llm-usage-events-schema.ts:32-37`) — but no
day-bucketed token query was ever written.

### Spec

1. **Add a token time-series query** in `src/stats/` (mirroring the tool-call
   growth query):
   ```ts
   tokenUsageByDay(window): Array<{
     date: string            // 'YYYY-MM-DD' (UTC)
     inputTokens: number
     outputTokens: number
     mainCalls: number
     smallCalls: number
   }>
   ```
   `SELECT date(occurredAt/1000,'unixepoch') AS date, sum(inputTokens), sum(outputTokens), ... GROUP BY date`.
   Provide both a global variant and a per-subject variant
   (`WHERE storageContextId = ?`).
2. **Anonymity:** counts and byte/token sums grouped by day are aggregate-shaped
   and allowed under the `/stats/*` contract (CLAUDE.md "Anonymity contract").
   No new free-form content is exposed. Add a test asserting the series contains
   only `date` + numeric fields.
3. **Surface it:**
   - Global: a captioned `Bars`/area chart in `StatsSection` ("tokens per day,
     last {window}") with the window selector already present
     (`StatsSection.svelte:170-173`) driving it.
   - Per-subject: the same chart inside the subject detail view (see issue 4),
     honoring the billing window selector.
4. **Window selector consistency.** Stats uses `1d/7d/30d/all`; billing uses
   `24h/7d/30d/all`. Normalize the labels so the same control reads the same
   everywhere.

---

## 3. Ambiguous data: time-without-date, no sorting, raw chat names — **CONFIRMED**

### Verification

- **Time without date.** `client/shared/helpers.ts:26-34` `formatTime()` emits
  `HH:MM:SS` only. Used for "last active" (`SubjectsTable.svelte:46`) and request
  rows (`SubjectDetail.svelte:79`) — ambiguous across a multi-day window.
  Meanwhile `SubjectDetail.svelte:121` dumps a **raw ISO string** for the same
  kind of value — inconsistent within one screen.
- **Raw timestamps elsewhere.** `GroupsSection.svelte` renders `added_at` as a
  raw stored string (no formatter at all).
- **No sorting.** `SubjectsTable`, the distributions and tools tables in
  `StatsPanel`, and the request table in `SubjectDetail` use `DataTable` with no
  sort handlers or header affordances.
- **Raw IDs as names.** `SubjectsTable.svelte:19-22` and `IdentitiesSection`
  fall back to the raw `storageContextId` (a UUID) when `displayName` is null —
  so groups/DMs frequently render as opaque UUIDs.

### Root cause

Ad-hoc formatting per component; no shared "timestamp" or "subject label"
presentation helper; `DataTable` has no sort support.

### Spec

1. **One timestamp helper.** Add `formatDateTime(ts)` →
   locale `YYYY-MM-DD HH:MM` (and a `formatRelative` for "3h ago") in
   `client/shared/helpers.ts`. Replace every `formatTime`/raw-ISO/raw-string
   timestamp in admin with it. Keep `formatTime` only where the date is already
   shown in an adjacent column.
2. **Sortable tables.** Add optional column `sortable` + `sortKey` to the shared
   `DataTable` (clickable header, asc/desc indicator, stable default sort).
   Default `SubjectsTable` to "last active desc", the tools table to "count
   desc".
3. **Resolved subject labels.** Where `displayName` is null, render a short
   typed label instead of a bare UUID — e.g. `DM · {first8(id)}` /
   `Group · {first8(id)}` with the full ID in a `title=`/tooltip. Keep the raw
   ID copyable. (Display-name resolution already exists via
   `resolveSubjectDisplayNames` in `src/debug/billing.ts`; ensure it is invoked
   for the stats/subject views too, not only billing.)

---

## 4. Detailed conversation / group / DM view has poor/unstyled layout — **CONFIRMED**

### Verification

- `SubjectDetail.svelte:136-162` styles the request list as a bare 12px monospace
  table with hairline borders only — no card, no column alignment system, no
  zebra, no empty-state.
- `SubjectStatsPanel.svelte:42-63` renders a plain `<dl>` of ~12 stat rows with no
  grid/card styling ("Anonymous stats" heading + unstyled definition list).
- Per-request expansion dumps raw JSON (`SubjectDetail.svelte:71-96`) with no
  formatting; token cells show `-` for null but adjacent panels show raw numbers.

### Root cause

Detail views were built as raw data dumps, bypassing the `Panel`/`MetricCard`/
`Stat` design-system primitives used elsewhere in the admin UI.

### Spec

1. **Reuse design-system primitives.** Render the subject overview as a row of
   `MetricCard`s (tokens, calls, tools, last-active) and the per-table stats via
   `Stat`/`Meter`, matching `StatsPanel`'s look rather than a `<dl>`.
2. **Restyle the request table** to the shared admin `DataTable` (issue 3's
   sortable variant): aligned numeric columns (right-aligned tokens/duration),
   monospace only for IDs, zebra striping, sticky header, and a proper
   empty-state ("no requests in this window").
3. **Embed the per-subject token-per-day chart** (issue 2) at the top of the
   detail so the detail view answers "usage over time," not just a flat list.
4. **Format expanded request detail** as a `TreeView` (already used in the debug
   client, `client/debug/components/TurnDetail.svelte`) instead of raw JSON text.

---

## 5. Debug dashboard doesn't show current session / internal state / admin's own chat data — **PARTIAL**

### Verification

The debug client already surfaces a great deal — live sessions
(`SessionsList`/`SessionDetail`), turns (`TurnsPanel`/`TurnDetail`), LLM traces
(`TraceList`/`TraceDetail`), scheduler/poller/message-cache state
(`DebugTopBar`), notifications, and tool failures. So "shows nothing" is not
accurate. The real gaps are:

- **Admin's own content is filtered out / redacted.**
  - `src/debug/state-collector.ts:141-142` drops every event where
    `isVisibleToAdmin(event.scope, adminVisibility)` is false. The admin sees
    `global` scope + only the DMs/groups they own or belong to — which is correct
    for multi-tenant privacy, but means the operator cannot inspect _other_
    contexts even when that is the explicit purpose of the debug surface.
  - Even for visible scopes, **message/conversation text never reaches the
    client**: `redactLogEntry` (`src/debug/log-redaction.ts:38-49`) default-denies
    every field and replaces every `msg` not in a 2-item allowlist with
    `[redacted]`. So logs about the admin's own chat show no content.
- **No "current session" pivot.** There is no view that says "this is the
  session/turn happening _right now_ for me, the signed-in operator" — turns and
  sessions are listed globally and must be hunted for.

### Root cause

Two privacy layers (`isVisibleToAdmin` scope filter + `redactLogEntry`
allowlist) are applied uniformly, with no notion of an operator who is
authorized to see content for contexts they own, or a super-admin who may see
more. The debug client also lacks a "me / current" affordance.

### Spec

> Privacy is load-bearing here; this must be designed, not loosened blindly.

1. **Operator-owned content tier.** Introduce an explicit visibility tier so that
   for contexts the signed-in operator **owns** (their own DMs, groups they
   admin), `redactLogEntry` may pass through already-allowed structured fields
   _plus_ the message content for those scopes, while everything else stays
   default-denied. Gate this on the authenticated dashboard principal, not on a
   global flag. Keep the current behavior as the default for non-owned scopes.
   - Add tests: owned-scope log retains content; non-owned-scope log still
     `[redacted]`; global scope unchanged.
2. **"Current session" panel.** Add a pinned card (top of the left rail or in
   `LiveContextCard`) showing the operator's _own_ most recent/active
   session + in-flight turn, derived from the authenticated principal's
   `chatUserId`, so "what's happening with me right now" is one click, not a
   scan.
3. **Document the boundary.** Update `docs/deployment/dashboard-access.md` and
   the CLAUDE.md debug-surface notes to state precisely what an operator can vs
   cannot see and why (owned-scope content vs cross-tenant redaction).
4. **Do not** expose cross-tenant message content to a non-super-admin operator.
   If a "super admin sees all" mode is wanted, make it an explicit, audited,
   separately-gated capability — out of scope for this pass unless requested.

---

## 6. Log output not scrollable / no pagination / no search / no filter — **PARTIAL (mostly REFUTED in code; real issues are different)**

### Verification

The reported symptoms do **not** match the current `LogExplorer`:

- **Scrollable:** yes — `#log-entries` has `overflow-y: auto` with auto-scroll +
  a jump-to-bottom button (`client/debug/components/LogExplorer.svelte:94-121`).
- **Search:** yes — Fuse.js fuzzy search over `msg`/`scope`/extra fields
  (`client/debug/log-filter.ts:11-38`).
- **Filter:** yes — level dropdown, scope dropdown, and turn-id badge filter
  (`LogExplorer.svelte:68-89`).

So the literal complaint is out of date. The **real** log problems are:

- **Content is redacted, making search/filter near-useless.** Per issue 5,
  almost every `msg` is `[redacted]` (`log-redaction.ts:35,42`), so fuzzy search
  has nothing meaningful to match and the log stream reads as noise.
- **"No way to get previous records" is genuine.** Logs live only in an
  **in-memory ring buffer** (`src/debug/log-buffer.ts`), default 65,535 entries,
  **lost on restart**, with **no persistence** and **no time-range query** — the
  server `search()` only returns the last N
  (`log-buffer.ts:69-86`; `/logs` in `src/debug/server.ts:100-110`). You cannot
  page backwards beyond what is in memory, and nothing survives a redeploy.
- **No real pagination.** The client renders the entire filtered set; the server
  takes only a `limit`, no cursor/offset/`before` timestamp.

### Root cause

The viewer was built correctly; the _data_ behind it is privacy-redacted and
non-durable, which is what the user is actually experiencing.

### Spec

1. **Fix the content problem first** via issue 5's operator-owned tier so
   owned-scope logs carry real messages and search/filter become useful.
2. **Cursor pagination for history.** Extend `/logs` to accept
   `before=<ts>` / `cursor` + `limit` and return a `nextCursor`, and have the ring
   buffer's `search()` honor a timestamp upper bound. Add a "load older" control
   in `LogExplorer` that pages backward through the in-memory buffer.
3. **Optional durable log sink (design only).** To truly "get previous records"
   across restarts, add an opt-in persistent sink (a capped
   `debug_log_events` SQLite table or rotating file) behind an env flag, written
   from the same `logBufferStream` path, with the same redaction applied at
   read-egress. Mark this explicitly optional and off by default to avoid writing
   sensitive content to disk; size-cap + TTL it. (Decide with the user before
   building — see Open Questions.)
4. **Clarify volatility in the UI.** Show buffer stats already available from
   `/logs/stats` (count / capacity / oldest / newest) as a header line so the
   operator knows the window is bounded and in-memory.

---

## Cross-cutting / shared work

- `client/shared/helpers.ts`: add `formatDateTime`, `formatRelative`.
- `client/shared/ui/DataTable.svelte`: add sortable columns.
- `client/shared/ui/{Bars,Spark}.svelte`: add `caption`/`unit`/`ariaLabel` +
  endpoint value labels.
- `src/stats/`: add `tokenUsageByDay` (global + per-subject) with anonymity test.
- `src/debug/log-redaction.ts` + `log-buffer.ts` + `server.ts`: owned-scope
  content tier, `before`/cursor pagination on `/logs`.

## Suggested sequencing

1. Backend `tokenUsageByDay` + anonymity test (unblocks issues 1, 2, 4).
2. Shared UI helpers (`formatDateTime`, sortable `DataTable`, chart captions).
3. Admin: token KPI, charts/captions, table sorting, subject-label resolution.
4. Admin: restyle subject detail + embed token chart.
5. Debug: owned-scope content tier + tests (issue 5/6 dependency).
6. Debug: current-session panel, `/logs` cursor pagination, buffer-stats header.
7. Optional durable log sink (only if approved).

## Decisions (resolved)

1. **Operator content visibility (issue 5):** keep the redaction allowlist
   unchanged. Improve the debug-log surface for issues that are independent of
   redaction; do **not** de-redact content. No "super-admin sees all" mode.
2. **Durable logs (issue 6):** no on-disk/DB sink. Keep logs in-memory; the gap
   is that the browser never fetched previous records — fix that with
   backward-paging through the buffer.
3. **Token time-series granularity:** day buckets (UTC).

## Implementation status

Shipped on `claude/admin-debug-dashboards-7dql4d`:

- **Issue 1/2** — `tokenUsageByDay{Global,ForSubject}` (day-bucketed, windowed,
  anonymity-tested); `GlobalStats.tokenUsageByDay` + client schema; Overview
  token KPI populated from `llmUsage`; captioned tokens-per-day chart in the
  Stats panel (input/output/calls cards + peak/last); captions on the tool-call
  sparkline; Overview "subject growth" panel relabeled + per-chart captions.
- **Issue 3** — `formatDateTime` (UTC `YYYY-MM-DD HH:MM`); sortable `DataTable`
  columns (`sortable`/`sortAccessor`/`defaultSort`); SubjectsTable sorts +
  typed short labels (`DM/Group · id8`) instead of raw UUIDs; GroupsSection
  formats/sorts `added_at`.
- **Issue 4** — SubjectDetail tables restyled (sticky header, right-aligned
  tabular numerics, framed JSON, UTC date+time); SubjectStatsPanel converted
  from a bare `<dl>` to a MetricCard grid.
- **Issue 6** — `before` cursor on the log buffer + `/logs`; client
  `fetchOlderLogs`/`fetchLogStats`, "↑ load older" back-paging with scroll
  preservation, oldest-record terminus, buffer-stats footer, full timestamp on
  hover. Redaction left untouched.

Not pursued (per decisions): owned-scope de-redaction tier, durable log sink.
Deferred (optional follow-ups): per-subject token chart embedded in the detail
view (building block `tokenUsageByDayForSubject` already exists); a pinned
"current operator session" pivot in the debug rail.

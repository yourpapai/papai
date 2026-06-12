<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Feature-Flags Section (Settings UI) — Design

Date: 2026-06-12
Branch: `context-pollution`

## Problem

The per-context reduction flags (`result_compaction`, `progressive_disclosure`,
`semantic_tool_retrieval`, stored as JSON under the reserved `tool_context_flags`
config key) have no runtime control surface. Today an operator must edit SQLite
directly and restart the bot (the config cache is lazy and a direct DB write is
invisible to a running process). The only first-class control is the
`TOOL_CONTEXT_REDUCTION_DISABLED=true` env kill switch, which can only force OFF.

## Decision Summary (user-approved)

- **UI model:** context list with per-row toggles. No bulk apply, no global
  default, no flag-resolution changes — `resolveReductionFlags` continues to read
  only the per-context key.
- **Role:** super admin only (`requireSuperAdmin`), same level as plugin approval.
- **Scope:** all known contexts across **all platform instances** (super admins
  are global), each row labeled with its platform instance.
- Writes go through `setConfigValue`, which already invalidates the cached tool
  descriptors for the context (`tool_context_flags` is in
  `TOOL_ASSEMBLY_CONFIG_KEYS`), so toggles take effect on the context's next turn
  without a restart.

## Server

New route file `src/debug/settings/admin/feature-flags-routes.ts` exporting
`handleAdminFeatureFlagsRoutes(req: Request, url: URL, pathname: string): Promise<Response>`,
wired in `src/debug/settings-api-router.ts` for the exact path
`/settings/api/admin/feature-flags`. Handler order per existing admin routes:
`authenticate` (401) → `requireSuperAdmin` (403) → for writes `requireCsrf` (403)
→ Zod body validation (400 malformed JSON / 422 invalid shape) → action →
`settingsJson` response. Method dispatch GET/PATCH; anything else → 405.

### GET /settings/api/admin/feature-flags

Response:

```json
{
  "killSwitchEngaged": false,
  "contexts": [
    {
      "contextId": "<scoped config context id>",
      "kind": "user",
      "label": "<username or platform user id>",
      "platformInstanceLabel": "<instance name or id>",
      "flags": {
        "result_compaction": false,
        "progressive_disclosure": false,
        "semantic_tool_retrieval": false
      }
    }
  ]
}
```

Assembly:

- Enumerate platform instances (the instance store used by `/api/platform-instances`).
- Per instance: `listUsers(instanceId)` → user rows (label `username ?? platform_user_id`;
  contextId via the same scoped-context construction the runtime uses for personal
  config contexts), and `listKnownGroupContextsForPlatform(instanceId)` → group rows
  (label `displayName`, with `parentName` appended as ` — <parentName>` when present;
  contextId from `KnownGroupContext.contextId`).
- Flags per row: `getConfigValue(contextId, 'tool_context_flags')` parsed with the
  shared strict parser (below). Missing/corrupt → all `false`.
- `killSwitchEngaged`: `process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] === 'true'`.
- Ordering: groups after users, both sorted by label; deterministic for tests.

### PATCH /settings/api/admin/feature-flags

Body (Zod):

```json
{
  "contextId": "string (min 1)",
  "flags": {
    "result_compaction": "boolean",
    "progressive_disclosure": "boolean",
    "semantic_tool_retrieval": "boolean"
  }
}
```

Schema: `{ contextId: z.string().min(1), flags: z.object({ result_compaction: z.boolean(), progressive_disclosure: z.boolean(), semantic_tool_retrieval: z.boolean() }).strict() }`.

- `contextId` must be a member of the enumerated known-context set (re-enumerate on
  write); unknown → 422 `{ error: 'unknown context' }`. This prevents junk config rows.
- Write: `setConfigValue(contextId, 'tool_context_flags', JSON.stringify(flags))`.
- Response 200: the updated row in the same shape as a GET `contexts` entry.

## Shared flag parsing

`src/tools/feature-flags.ts`: extract the existing private `parse` into an exported
`parseReductionFlagsJson(raw: string | null): ReductionFlags` (same strict
semantics — only literal JSON `true` enables; missing/empty/corrupt → all OFF;
corrupt JSON logs a warn). `resolveReductionFlags` delegates to it; the new GET
route uses it too. No behavior change to resolution.

The route maps `ReductionFlags` (camelCase) back to the wire/storage snake_case
names; the storage JSON written by PATCH uses exactly the snake_case keys the parser
reads (`result_compaction`, `progressive_disclosure`, `semantic_tool_retrieval`).

## Client

- `client/settings/sections/admin/AdminFeatureFlagsSection.svelte` — follows
  `AdminPluginsConfigSection.svelte` conventions: local `$state` (snapshot, error,
  saving row id), `$effect` initial load, standard section error/loading states.
  Renders: a warning banner when `killSwitchEngaged` ("All reduction flags are
  forced OFF by TOOL_CONTEXT_REDUCTION_DISABLED; toggles below are stored but
  inert until the variable is unset"), then a table — label, kind badge,
  platform instance, three checkboxes, per-row Save button enabled when the row
  is dirty. Save calls the PATCH fetcher and replaces the row from the response.
- `SettingsApp.svelte`: add `{ id: 'feature-flags', label: 'Feature flags' }` to
  the super-admin sidebar items and render `<AdminFeatureFlagsSection />` inside
  the existing `{#if settingsSession.isSuperAdmin}` block.
- `client/settings/admin-fetchers.ts`: `fetchAdminFeatureFlags()` (getJson) and
  `saveAdminFeatureFlags(payload)` (writeJson PATCH) with Zod schemas for the
  snapshot and row shapes; `X-Settings-CSRF` is added automatically by
  `settingsFetch` for PATCH.

## Error handling

- 401 unauthenticated; 403 non-super-admin (including plain bot admins); 403
  missing/invalid CSRF on PATCH; 400 malformed JSON body; 422 schema-invalid body or
  unknown `contextId`; 405 other methods; 500 with `settingsJson` on unexpected
  errors (logged via the route's pino child logger, no flag values logged beyond
  booleans — nothing sensitive here).
- Client: section-level error banner on fetch failure; per-row error text on save
  failure; section is simply absent for non-super-admins.

## Testing

- `tests/debug/settings/admin/feature-flags-routes.test.ts` (mirror
  `plugin-config-routes.test.ts`; `establishSession` + `authHeaders` helpers):
  401 without session; 403 for non-admin and for plain bot admin; PATCH without
  CSRF → 403; GET returns user + group contexts with parsed flags (seed a user,
  a known group, and one `tool_context_flags` row); PATCH round-trips (write then
  GET shows new values) and returns the updated row; PATCH rejects plain bot admin
  write → 403; PATCH unknown contextId → 422;
  PATCH malformed body → 400/422; killSwitchEngaged true when env var set (set/restore
  within the test); 405 for PUT and POST.
- `tests/tools/feature-flags.test.ts`: cover `parseReductionFlagsJson` directly
  (moved/extended from existing resolveReductionFlags parse tests; resolution
  tests stay).
- `tests/client/settings/` fetcher tests (mirror `admin-fetchers.test.ts`):
  GET URL + schema parse; PATCH URL, CSRF header present, payload shape.
- Svelte component testing follows whatever coverage level peers have (fetcher
  tests are the enforced layer; section components are exercised via
  `tests/client` only where peers do the same — match local convention).

## Docs

- Root `CLAUDE.md`: in the two experimental-flag paragraphs, note the flags are
  managed per context in the settings UI super-admin "Feature flags" section;
  kill switch unchanged.
- `src/tools/CLAUDE.md`: no change needed (assembly semantics untouched).

## Out of Scope (YAGNI)

- Bulk "apply to all" action.
- Global default flag values / changes to `resolveReductionFlags`.
- Audit history of flag changes.
- Exposure to non-super-admin roles or end users.
- Pagination/search of the context list (revisit if rosters grow large).

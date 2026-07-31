<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP Catalog Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two operator-config footguns in the MCP catalog — the redundant `host` field and the allow-all-by-omission tool-policy default — so a catalog entry cannot be silently misconfigured into an over-permissive posture.

**Architecture:** papai-only. (1) `host` is derived from `upstream_url` and dropped from the schema — the mismatch class becomes unrepresentable. (2) `default_tool_policy` becomes required on every entry (422 server-side), the code fallback flips to `deny`, and the admin UI makes the posture always-visible, `deny`-pre-filled, with a live plain-language summary. magi is unchanged (it already validates/enforces `projectSpec.mcp.toolPolicy` and `host === url.hostname`).

**Tech Stack:** TypeScript, Zod v4 (`z.url()`, `z.enum`), Svelte 5 runes, Bun test, Storybook + MSW + `@crvy/strybk` visual pipeline.

**Spec:** `docs/superpowers/specs/2026-07-08-mcp-catalog-hardening-design.md`.

---

## Constraints (carry into EVERY task)

- **Concurrent WIP:** another session edits this repo. Every commit uses `git add <exact paths>` — **NEVER** `git add -A`/`.`. Do NOT touch `src/mcp/`, `client/settings/sections/McpSection.svelte` (unrelated orchestrator feature), `tests/visual/settings/sections/KaneoAccessSection.spec.ts`, or `docs/ux-reviews/`. If a hook flags those, leave them.
- **Conventions:** strict TS, Zod v4, Svelte 5 runes, `.js` import extensions, no lint-disable/type-ignore comments (hook-blocked — fix the real issue).
- **Per-task gate:** `bun run check` (4/4: lint, typecheck, format:check, license-headers) AND `bun run knip` (clean, exit 0). The stop-hook runs `check:full` which includes knip — so every commit must leave knip green. `.svelte`-only-consumed exports that knip can't follow are handled via the EXISTING `knip.jsonc` `ignoreIssues` block (match the documented precedent entries; do not invent new disable styles).
- **oxfmt, not prettier:** if `format:check` fails, run `bunx oxfmt --write <your exact files>` (never the whole tree — it would touch concurrent WIP). The repo uses `oxfmt`; `prettier` will reformat wrongly.
- **TDD:** write the failing test first, watch it fail, then implement.
- **Green tree every commit:** Task 1 is deliberately combined because the schema change breaks the resolver and its tests together (see the coupling note in Task 1).

---

## File structure

**Modify (backend — Task 1):**

- `src/coding-credentials/mcp-catalog.ts` — `mcpCatalogEntrySchema`: drop `host`; `default_tool_policy` required.
- `src/coding-credentials/resolve-agent-secrets.ts` — `resolveMcp` derives host from `upstream_url`; `catalogToolPolicy` returns non-optional `ToolPolicy` with `?? 'deny'`.
- `tests/coding-credentials/mcp-catalog.test.ts`, `tests/coding-credentials/resolve-agent-secrets.test.ts`, `tests/debug/settings/admin/mcp-catalog-routes.test.ts` — new shape + new required-default assertions.

**Modify (frontend fields — Task 2):**

- `client/settings/fetcher-schemas-mcp-catalog.ts` — client `AdminMcpCatalogEntrySchema`: drop `host`, require `default_tool_policy`.
- `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte` — drop host input; `default_tool_policy` non-empty (remove "Unset"); `emptyDraftEntry()` pre-fills `deny`.
- `client/settings/sections/admin/AdminMcpCatalogSection.svelte` — `toDraft`/`toEntry` drop host; always set default.
- `client/stories/msw/settings-handlers-admin-2.ts` — fixture drops host.
- `tests/visual/settings/sections/admin/AdminMcpCatalogSection.spec.ts` — regenerated via `bun shoot:gen`.

**Create + modify (posture summary — Task 3):**

- `client/settings/sections/admin/mcp-posture.ts` — pure `describeMcpPosture(...)` helper.
- `tests/coding-credentials/mcp-posture.test.ts` — unit tests for all cases. (Placed under `tests/` so the per-task `bun run check` `test` step runs it; adjust the exact folder to match a sibling client-helper test if one exists.)
- `AdminMcpCatalogEntryRow.svelte` — render the live summary; `AdminMcpCatalogSection.stories.svelte` — a posture story; regen the visual spec.

**Modify (docs — Task 4):**

- `docs/architecture/coding-sessions.md` — catalog entry shape (host dropped, default required).

---

## Task 1: backend — derive host + require default_tool_policy (combined, one green commit)

**Coupling note (why combined):** dropping `host` from `mcpCatalogEntrySchema` immediately breaks `resolve-agent-secrets.ts` (`host: entry.host` no longer typechecks) and `catalogToolPolicy`'s type, and every backend test that constructs an entry with `host` or without `default_tool_policy` (the schema's `setMcpCatalog`/route POST `.parse` would throw, and the route's local response schema requires `host`). All of it must change in one commit or the tree is red. This mirrors 3B-papai Tasks 4+5, which had to land together.

**Files:**

- Modify: `src/coding-credentials/mcp-catalog.ts:13-22`
- Modify: `src/coding-credentials/resolve-agent-secrets.ts:181-184` (`catalogToolPolicy`) and `:217-223` (`resolveMcp` return)
- Test: `tests/coding-credentials/mcp-catalog.test.ts`, `tests/coding-credentials/resolve-agent-secrets.test.ts:191-258`, `tests/debug/settings/admin/mcp-catalog-routes.test.ts`

- [ ] **Step 1: Update the backend tests to the new shape (failing-first).**

In `tests/coding-credentials/mcp-catalog.test.ts` replace the body's entry-shape tests. New content for the three shape-dependent tests plus a new required-default test:

```ts
test('setMcpCatalog round-trips entries (no host field, default required)', () => {
  const entries = [
    { name: 'github', upstream_url: 'https://mcp.example.com/github', default_tool_policy: 'allow' as const },
  ]
  setMcpCatalog('pi-y', entries)
  expect(resolveMcpCatalog('pi-y')).toEqual(entries)
  expect(adminMcpCatalogContextId('pi-y')).toBe('__admin_mcp_catalog__:pi-y')
})

test('resolveMcpCatalog degrades to empty array when stored entry fails schema', () => {
  setCachedConfig(
    '__admin_mcp_catalog__:pi-w',
    'mcp_catalog',
    JSON.stringify([{ name: 'x', upstream_url: 'http://h' }]),
  )
  expect(resolveMcpCatalog('pi-w')).toEqual([])
})

test('mcpCatalogSchema rejects non-https upstream_url', () => {
  const result = mcpCatalogSchema.safeParse([{ name: 'x', upstream_url: 'http://h', default_tool_policy: 'allow' }])
  expect(result.success).toBe(false)
})

test('mcpCatalogSchema rejects an entry missing default_tool_policy', () => {
  const result = mcpCatalogSchema.safeParse([{ name: 'x', upstream_url: 'https://h' }])
  expect(result.success).toBe(false)
})

test('mcpCatalogSchema strips an unknown host key', () => {
  const result = mcpCatalogSchema.safeParse([
    { name: 'x', upstream_url: 'https://h', host: 'h', default_tool_policy: 'allow' },
  ])
  expect(result.success).toBe(true)
  expect(result.data?.[0]).not.toHaveProperty('host')
})
```

Keep the existing `resolveMcpCatalog defaults to empty array when unset` and `degrades to empty array on invalid stored blob` tests unchanged.

In `tests/coding-credentials/resolve-agent-secrets.test.ts:191-258`, update every `setMcpCatalog(...)` entry to drop `host` and include a `default_tool_policy`, keep the expected `host` as the derived hostname, and replace the "omits toolPolicy" test (the no-policy case no longer exists — default is always required):

```ts
test('resolveMcp resolves url/host(derived)/header/allowedHosts/toolPolicy from the selected catalog entry', () => {
  setMcpCatalog(MCP_PI, [
    {
      name: 'Jira',
      upstream_url: 'https://mcp.atlassian.com/v1',
      header: 'X-Auth',
      default_tool_policy: 'deny',
      tool_policy: { echo: 'allow' },
    },
  ])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: 'Jira', upstream_token: 'sek' }, 'user-mcp')
  expect(resolveMcp(MCP_CTX, 'user-mcp')).toEqual({
    url: 'https://mcp.atlassian.com/v1',
    host: 'mcp.atlassian.com',
    header: 'X-Auth',
    allowedHosts: ['mcp.atlassian.com'],
    toolPolicy: { default: 'deny', tools: { echo: 'allow' } },
  })
  expect(resolveMcpToken(MCP_CTX, 'user-mcp')).toBe('sek')
})

test('resolveMcp derives host from upstream_url, not any stored value', () => {
  setMcpCatalog(MCP_PI, [
    { name: 'Jira', upstream_url: 'https://real-host.example.com/v1', default_tool_policy: 'allow' },
  ])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: 'Jira', upstream_token: 'sek' }, 'user-mcp')
  const resolved = resolveMcp(MCP_CTX, 'user-mcp')
  expect(resolved?.host).toBe('real-host.example.com')
  expect(resolved?.allowedHosts).toEqual(['real-host.example.com'])
})

test('resolveMcp defaults header to Authorization when the catalog entry omits it', () => {
  setMcpCatalog(MCP_PI, [{ name: 'Jira', upstream_url: 'https://mcp.atlassian.com/v1', default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: 'Jira', upstream_token: 'sek' }, 'user-mcp')
  expect(resolveMcp(MCP_CTX, 'user-mcp')?.header).toBe('Authorization')
})

test('resolveMcp always carries a toolPolicy (default is required on every entry)', () => {
  setMcpCatalog(MCP_PI, [{ name: 'Jira', upstream_url: 'https://mcp.atlassian.com/v1', default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: 'Jira', upstream_token: 'sek' }, 'user-mcp')
  expect(resolveMcp(MCP_CTX, 'user-mcp')?.toolPolicy?.default).toBe('allow')
})
```

For the remaining MCP tests in that block (`partial vault server without token`, `token without server`, `fail-closed removed/renamed`, `fail-closed no platform instance`), drop `host` and add `default_tool_policy: 'allow'` to each `setMcpCatalog` entry (their assertions are unchanged — they assert `null`). Leave the `no mcp vault stored` test (line 198) as-is (no catalog entry).

In `tests/debug/settings/admin/mcp-catalog-routes.test.ts`: drop `host` from the local `CatalogResponseSchema` (lines 16-27) and make `default_tool_policy` required there; drop `host` from the POST body entry (lines 74-82) and its `toMatchObject` (lines 88-93); the empty-entries POSTs are unchanged. Add a new test proving the server-side required constraint:

```ts
test('POST with an entry missing default_tool_policy returns 422', async () => {
  const url = new URL('https://x/settings/api/admin/mcp-catalog')
  const req = new Request(url, {
    method: 'POST',
    headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'catalog', entries: [{ name: 'J', upstream_url: 'https://h/v1' }] }),
  })
  const res = await handleAdminMcpCatalogRoutes(req, url, url.pathname)
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Run the tests — verify they FAIL.**

Run: `bun test tests/coding-credentials/mcp-catalog.test.ts tests/coding-credentials/resolve-agent-secrets.test.ts tests/debug/settings/admin/mcp-catalog-routes.test.ts`
Expected: failures (schema still has `host`/optional default; `resolveMcp` still reads `entry.host`; the new required-default assertions fail; `strips host key` fails). Typecheck may also complain once you start editing source — that's expected mid-task.

- [ ] **Step 3: Update the schema** in `src/coding-credentials/mcp-catalog.ts` (replace lines 13-22):

```ts
export const mcpCatalogEntrySchema = z.object({
  name: z.string().min(1),
  upstream_url: z.url().refine((url) => url.startsWith('https://'), {
    message: 'must be https',
  }),
  header: z.string().optional(),
  default_tool_policy: z.enum(['allow', 'ask', 'deny']),
  tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
})
export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>

export const mcpCatalogSchema = z.array(mcpCatalogEntrySchema)
```

(`host` removed; `default_tool_policy` no longer `.optional()`. Zod strips the unknown `host` key by default, satisfying the "strips host key" test.)

- [ ] **Step 4: Update the resolver** in `src/coding-credentials/resolve-agent-secrets.ts`. Replace `catalogToolPolicy` (lines 181-184):

```ts
function catalogToolPolicy(entry: McpCatalogEntry): ToolPolicy {
  return { default: entry.default_tool_policy ?? 'deny', tools: entry.tool_policy }
}
```

(Return type is now non-optional `ToolPolicy`. `?? 'deny'` is unreachable belt-and-suspenders — the schema guarantees `default_tool_policy` is present — but if validation is ever bypassed, unlisted tools deny, never allow. Do NOT add a dedicated test for the unreachable branch; it cannot be reached through the public API since `resolveMcpCatalog` `safeParse`-rejects a policy-less entry to `[]`.)

Replace the `resolveMcp` return block (lines 217-223) to derive the host:

```ts
const hostname = new URL(entry.upstream_url).hostname
return {
  url: entry.upstream_url,
  host: hostname,
  header: entry.header ?? 'Authorization',
  allowedHosts: [hostname],
  toolPolicy: catalogToolPolicy(entry),
}
```

(`new URL(...)` cannot throw — `upstream_url` passed `z.url()` + https refine at write time. `ResolvedMcp.toolPolicy` stays optional-typed at line 178 — do NOT narrow it — so nothing ripples into the plugin-context type mirrors; it is simply always populated now.)

- [ ] **Step 5: Run the tests — verify they PASS.**

Run: `bun test tests/coding-credentials/mcp-catalog.test.ts tests/coding-credentials/resolve-agent-secrets.test.ts tests/debug/settings/admin/mcp-catalog-routes.test.ts`
Expected: all pass.

- [ ] **Step 6: Gate + commit.**

Run: `bun run check` (4/4) and `bun run knip` (clean). If `format:check` fails, `bunx oxfmt --write <the exact files>` then re-check.

```bash
git add src/coding-credentials/mcp-catalog.ts src/coding-credentials/resolve-agent-secrets.ts tests/coding-credentials/mcp-catalog.test.ts tests/coding-credentials/resolve-agent-secrets.test.ts tests/debug/settings/admin/mcp-catalog-routes.test.ts
git commit -m "feat(coding-mcp): derive catalog host from upstream_url + require default_tool_policy"
```

Confirm with `git show --stat HEAD` that only those 5 files are in the commit.

---

## Task 2: frontend — drop host input, require + pre-fill the default policy

**Files:**

- Modify: `client/settings/fetcher-schemas-mcp-catalog.ts:10-18`
- Modify: `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte:12-23` (types + `emptyDraftEntry`) and `:74-110` (host input + select)
- Modify: `client/settings/sections/admin/AdminMcpCatalogSection.svelte:26-53` (`toDraft`/`toEntry`)
- Modify: `client/stories/msw/settings-handlers-admin-2.ts:74-81` (fixture)
- Test: `tests/visual/settings/sections/admin/AdminMcpCatalogSection.spec.ts` (regenerated)

- [ ] **Step 1: Update the client schema mirror.** In `client/settings/fetcher-schemas-mcp-catalog.ts` replace `AdminMcpCatalogEntrySchema` (lines 10-17):

```ts
export const AdminMcpCatalogEntrySchema = z.object({
  name: z.string(),
  upstream_url: z.string(),
  header: z.string().optional(),
  default_tool_policy: ToolPolicySchema,
  tool_policy: z.record(z.string(), ToolPolicySchema).optional(),
})
```

(`host` dropped; `default_tool_policy` required.)

- [ ] **Step 2: Update the draft types + empty factory** in `AdminMcpCatalogEntryRow.svelte`. Replace the module `<script>` (lines 6-24):

```ts
export interface DraftToolPolicyRow {
  tool: string
  permission: 'allow' | 'ask' | 'deny'
}

export interface DraftMcpCatalogEntry {
  name: string
  upstream_url: string
  header: string
  default_tool_policy: 'allow' | 'ask' | 'deny'
  toolPolicy: DraftToolPolicyRow[]
}

export function emptyDraftEntry(): DraftMcpCatalogEntry {
  return { name: '', upstream_url: '', header: '', default_tool_policy: 'deny', toolPolicy: [] }
}
```

(`host` dropped from the draft; `default_tool_policy` is now non-empty and a new entry starts at `'deny'` — the secure default.)

- [ ] **Step 3: Remove the host input and the "Unset" option** in `AdminMcpCatalogEntryRow.svelte`. Delete the entire Host `<label>` block (lines 74-84). In the Default-tool-policy `<label>` (lines 96-110), remove the `<option value="">Unset</option>` line so the select has no empty state (structural "required" — it can never be unset). The select's `value={entry.default_tool_policy}` and `onchange` stay as-is (the cast target type is now `'allow'|'ask'|'deny'`).

- [ ] **Step 4: Update `toDraft`/`toEntry`** in `AdminMcpCatalogSection.svelte`. Replace `toDraft` (lines 26-35) and `toEntry` (lines 37-53):

```ts
function toDraft(entry: AdminMcpCatalogEntry): DraftMcpCatalogEntry {
  return {
    name: entry.name,
    upstream_url: entry.upstream_url,
    header: entry.header ?? '',
    default_tool_policy: entry.default_tool_policy,
    toolPolicy: Object.entries(entry.tool_policy ?? {}).map(([tool, permission]) => ({ tool, permission })),
  }
}

function toEntry(draft: DraftMcpCatalogEntry): AdminMcpCatalogEntry {
  const entry: AdminMcpCatalogEntry = {
    name: draft.name.trim(),
    upstream_url: draft.upstream_url.trim(),
    default_tool_policy: draft.default_tool_policy,
  }
  const header = draft.header.trim()
  if (header !== '') entry.header = header
  const toolPolicy: Record<string, 'allow' | 'ask' | 'deny'> = {}
  for (const row of draft.toolPolicy) {
    const tool = row.tool.trim()
    if (tool !== '') toolPolicy[tool] = row.permission
  }
  if (Object.keys(toolPolicy).length > 0) entry.tool_policy = toolPolicy
  return entry
}
```

(`host` gone from both; `default_tool_policy` always set — no conditional.)

- [ ] **Step 5: Update the MSW fixture** in `client/stories/msw/settings-handlers-admin-2.ts`. Replace `adminMcpCatalogEntry` (lines 74-81) — drop `host`, and update the header comment on line 72 to drop `host`:

```ts
const adminMcpCatalogEntry = {
  name: 'Jira',
  upstream_url: 'https://mcp.atlassian.com/v1',
  header: 'Authorization: Bearer xyz',
  default_tool_policy: 'allow' as const,
  tool_policy: { delete_issue: 'deny' as const },
}
```

- [ ] **Step 6: Regenerate the visual spec + verify stories.**

Run: `bun shoot:gen` (regenerates `tests/visual/settings/sections/admin/AdminMcpCatalogSection.spec.ts` from the stories). Then start the story server and shoot this section only, per the repo's visual pipeline (`AdminMcpCatalogSection` was shot this way originally):

```
bun storybook   # (in background; reuse if already running)
bun shoot -g AdminMcpCatalogSection
```

Expected: the Populated/Empty/Error/Loading stories render; the entry row shows Name / Upstream URL / Header / Default tool policy (no Host field), and the default select has no "Unset" option. Visually inspect the Populated PNG under `.storybook-shots/`. If the visual harness cannot run in this environment, say so and rely on `bun run check` + `knip` + the story/fixture being consistent.

- [ ] **Step 7: Gate + commit.**

Run: `bun run check` (4/4) and `bun run knip` (clean — the client schema is already covered by the existing `knip.jsonc` ignoreIssues entry for `fetcher-schemas-mcp-catalog.ts`; do not add new entries unless a NEW unfollowed export appears, and if so match the documented precedent).

```bash
git add client/settings/fetcher-schemas-mcp-catalog.ts client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte client/settings/sections/admin/AdminMcpCatalogSection.svelte client/stories/msw/settings-handlers-admin-2.ts tests/visual/settings/sections/admin/AdminMcpCatalogSection.spec.ts
git commit -m "feat(coding-mcp): drop catalog host input, require + pre-fill default tool policy"
```

Confirm `git show --stat HEAD` lists only those files (no `KaneoAccessSection.*`, no `McpSection.svelte`).

---

## Task 3: live plain-language posture summary

**Files:**

- Create: `client/settings/sections/admin/mcp-posture.ts`
- Test: `tests/coding-credentials/mcp-posture.test.ts` (bun:test, runs under `bun run check`)
- Modify: `AdminMcpCatalogEntryRow.svelte` (render the summary), `AdminMcpCatalogSection.stories.svelte` (a posture story), regen the visual spec.

- [ ] **Step 1: Write the failing unit test** `tests/coding-credentials/mcp-posture.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeMcpPosture } from '../../client/settings/sections/admin/mcp-posture.js'

describe('describeMcpPosture', () => {
  test('default allow, no exceptions → all tools', () => {
    expect(describeMcpPosture('allow', [])).toBe('All tools allowed.')
  })
  test('default allow with deny exceptions → all except', () => {
    expect(describeMcpPosture('allow', [{ tool: 'delete_repo', permission: 'deny' }])).toBe(
      'All tools allowed, except — blocked: delete_repo.',
    )
  })
  test('default deny, no exceptions → warns no tools', () => {
    expect(describeMcpPosture('deny', [])).toBe('⚠ No tools allowed on this server.')
  })
  test('default deny with allow exceptions → only these', () => {
    expect(
      describeMcpPosture('deny', [
        { tool: 'search', permission: 'allow' },
        { tool: 'get_issue', permission: 'allow' },
      ]),
    ).toBe('Only these tools — allowed: search, get_issue — all others blocked.')
  })
  test('default ask → confirm each, with exceptions', () => {
    expect(describeMcpPosture('ask', [{ tool: 'search', permission: 'allow' }])).toBe(
      'Every tool call must be confirmed (ask). Except — allowed: search.',
    )
  })
  test('blank tool names are ignored', () => {
    expect(describeMcpPosture('allow', [{ tool: '   ', permission: 'deny' }])).toBe('All tools allowed.')
  })
})
```

- [ ] **Step 2: Run — verify FAIL.**

Run: `bun test tests/coding-credentials/mcp-posture.test.ts`
Expected: FAIL — `Cannot find module '.../mcp-posture.js'`.

- [ ] **Step 3: Implement the helper** `client/settings/sections/admin/mcp-posture.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type Permission = 'allow' | 'ask' | 'deny'
interface PolicyRow {
  tool: string
  permission: Permission
}

function named(rows: PolicyRow[], permission: Permission): string[] {
  return rows.filter((r) => r.tool.trim() !== '' && r.permission === permission).map((r) => r.tool.trim())
}

export function describeMcpPosture(defaultPolicy: Permission, rows: PolicyRow[]): string {
  if (defaultPolicy === 'allow') {
    const parts: string[] = []
    const denied = named(rows, 'deny')
    const asked = named(rows, 'ask')
    if (denied.length > 0) parts.push(`blocked: ${denied.join(', ')}`)
    if (asked.length > 0) parts.push(`ask first: ${asked.join(', ')}`)
    return parts.length === 0 ? 'All tools allowed.' : `All tools allowed, except — ${parts.join('; ')}.`
  }
  if (defaultPolicy === 'deny') {
    const parts: string[] = []
    const allowed = named(rows, 'allow')
    const asked = named(rows, 'ask')
    if (allowed.length > 0) parts.push(`allowed: ${allowed.join(', ')}`)
    if (asked.length > 0) parts.push(`ask first: ${asked.join(', ')}`)
    return parts.length === 0
      ? '⚠ No tools allowed on this server.'
      : `Only these tools — ${parts.join('; ')} — all others blocked.`
  }
  const parts: string[] = []
  const allowed = named(rows, 'allow')
  const denied = named(rows, 'deny')
  if (allowed.length > 0) parts.push(`allowed: ${allowed.join(', ')}`)
  if (denied.length > 0) parts.push(`blocked: ${denied.join(', ')}`)
  const suffix = parts.length === 0 ? '' : ` Except — ${parts.join('; ')}.`
  return `Every tool call must be confirmed (ask).${suffix}`
}
```

- [ ] **Step 4: Run — verify PASS.**

Run: `bun test tests/coding-credentials/mcp-posture.test.ts`
Expected: all 6 pass.

- [ ] **Step 5: Wire the summary into the row.** In `AdminMcpCatalogEntryRow.svelte`, import the helper and render a `$derived` summary under the per-tool policy block. Add to the instance `<script>` (near the top, after the `<script lang="ts">` imports on line 27):

```ts
import { describeMcpPosture } from './mcp-posture.js'
```

Add a derived value (after `let { entry, ... } = $props()` on line 37):

```ts
const posture = $derived(describeMcpPosture(entry.default_tool_policy, entry.toolPolicy))
```

And render it (inside `.mcp-catalog-entry__tool-policy`, after the "Add tool policy" button around line 154):

```svelte
    <p class="mcp-catalog-entry__posture" data-testid={`mcp-catalog-posture-${index}`}>{posture}</p>
```

Add a matching style rule in the `<style>` block:

```css
.mcp-catalog-entry__posture {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg2);
  margin: 0;
}
```

- [ ] **Step 6: Add a posture story + regenerate the visual spec.** In `AdminMcpCatalogSection.stories.svelte`, add (or extend a fixture into) a story whose MSW `populated` fixture includes both a deny-list entry (`default_tool_policy: 'allow'` + a `deny` override) and an allow-list entry (`default_tool_policy: 'deny'` + `allow` overrides) so the two posture strings are visible. (If the story file drives fixtures via `client/stories/msw/settings-handlers-admin-2.ts`, add a second entry to `adminMcpCatalogEntry`'s family there and reference it; keep the shape valid against the client schema — every entry has `default_tool_policy`.) Then:

```
bun shoot:gen
bun storybook   # reuse if running
bun shoot -g AdminMcpCatalogSection
```

Inspect the Populated PNG: each entry shows its posture sentence (e.g. "All tools allowed, except — blocked: delete_issue." and "Only these tools — allowed: search — all others blocked.").

- [ ] **Step 7: Gate + commit.**

Run: `bun run check` (4/4) and `bun run knip` (clean — `describeMcpPosture` is imported by the unit test AND the `.svelte`; the test import makes it a used export for knip. If knip still flags it as `.svelte`-only, add `client/settings/sections/admin/mcp-posture.ts` to the existing `knip.jsonc` `ignoreIssues` block matching the documented precedent, and say so in the report).

```bash
git add client/settings/sections/admin/mcp-posture.ts tests/coding-credentials/mcp-posture.test.ts client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte client/settings/sections/admin/AdminMcpCatalogSection.stories.svelte tests/visual/settings/sections/admin/AdminMcpCatalogSection.spec.ts
# add client/stories/msw/settings-handlers-admin-2.ts ONLY if you modified it in Step 6
git commit -m "feat(coding-mcp): live plain-language tool-policy posture summary in the catalog UI"
```

Confirm `git show --stat HEAD` lists only your files.

---

## Task 4: docs

**Files:** Modify `docs/architecture/coding-sessions.md` (commit ONLY this file).

- [ ] **Step 1: Update the catalog entry description.** In the "Sandbox MCP broker" section, find where the catalog entry shape is documented (`{ name, upstream_url, host, header?, default_tool_policy?, tool_policy? }`). Update it to `{ name, upstream_url (https), header?, default_tool_policy, tool_policy? }` and add one sentence: the entry's `host`/`allowedHosts` are derived from `upstream_url` (no separate field, so no host/URL mismatch is representable), and `default_tool_policy` is **required** on every entry (there is no allow-all-by-omission — the admin UI pre-fills `deny` and shows a live plain-language posture summary; an entry missing a default is rejected 422). Keep it tight and consistent with the surrounding prose.

- [ ] **Step 2: Gate + commit.**

Run: `bun run check` (license-headers/format apply to docs too; if `format:check` fails run `bunx oxfmt --write docs/architecture/coding-sessions.md`).

```bash
git add docs/architecture/coding-sessions.md
git commit -m "docs(coding-sessions): catalog host derived + default tool policy required (hardening)"
```

Confirm only that file is in the commit.

---

## Definition of done

- [ ] `mcpCatalogEntrySchema` (and the client mirror) has no `host` field and a **required** `default_tool_policy`; the admin POST route rejects a missing default with 422.
- [ ] `resolveMcp` derives `host`/`allowedHosts` from `upstream_url`; `catalogToolPolicy` returns a non-optional `ToolPolicy` with a `deny` fallback; `ResolvedMcp.toolPolicy` stays optional-typed (no plugin-mirror ripple) but is always populated.
- [ ] Admin UI: host input gone; the default-policy select is always present with no empty option and pre-fills `deny` on new entries; a live posture summary renders for every entry.
- [ ] `describeMcpPosture` is unit-tested across allow/deny/ask + empty + blank-name cases.
- [ ] Docs updated. Every commit: `bun run check` 4/4 + `bun run knip` clean; concurrent-WIP files untouched; explicit `git add` per commit.
- [ ] Full docker E2E (operator posture → user pick → worker → denied tool blocked) remains the Linux handoff (unchanged).

## Self-review (author checklist — done)

- **Spec coverage:** Decision 1 (host derivation) → Task 1 (schema + resolver) + Task 2 (client schema + UI input removal). Decision 2 Layer 1 (schema required) → Task 1; Layer 2 (`?? 'deny'`) → Task 1; Layer 3 (UI required/pre-fill/summary) → Tasks 2 + 3. Docs → Task 4. No gaps.
- **Placeholders:** none — every code step shows complete code; the one deferred detail (exact story fixture wiring in Task 3 Step 6) depends on the repo's story structure and is bounded with a concrete requirement + validity constraint.
- **Type consistency:** `DraftMcpCatalogEntry` (no `host`, `default_tool_policy: 'allow'|'ask'|'deny'`) matches `toDraft`/`toEntry`/`emptyDraftEntry` across Tasks 2-3; `describeMcpPosture(defaultPolicy, rows)` signature matches its test and the `$derived` call site; `catalogToolPolicy` return type (`ToolPolicy`) matches `resolveMcp`'s always-populated `toolPolicy`.

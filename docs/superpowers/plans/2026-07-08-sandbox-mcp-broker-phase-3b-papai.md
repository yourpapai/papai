<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 3B-papai (Operator Catalog + Settings UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCP-server access **operator-curated, user-selected** — an admin publishes a vetted catalog of MCP servers, and a user's "Coding MCP servers" section picks an entry (URL/host/header/tool-policy come from the catalog) and supplies only their credential.

**Architecture:** An operator `mcp_catalog` config (mirroring the Phase-5a `coding_guardrails` admin config) lists vetted `{ name, upstream_url, host, header?, default_tool_policy?, tool_policy? }` entries, edited via an admin route + `AdminMcpCatalogSection.svelte`. The 3A `mcp` vault is **restructured** from freeform URL to `{ server (a catalog selection), upstream_token }`. `resolveMcp` becomes **catalog-driven**: it looks up the stored `server` in the catalog and derives `{ url, host, header, allowedHosts, toolPolicy }` — the catalog is authoritative (no drift; a stale/removed entry → `null`, fail-closed). The `toolPolicy` flows into `projectSpec.mcp.toolPolicy`, enforced by magi (Phase 3B-magi).

**Tech Stack:** TypeScript + Svelte 5 (papai); Zod v4; the existing admin-config (`getCachedConfig`/`setCachedConfig`) + generic coding-credentials route patterns.

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (§3 tiered trust; §5.5 catalog + section; §9).

**Depends on Phase 3B-magi** (`toolPolicy` on `ProjectSpec.mcp`, validated + enforced in magi). Execute 3B-magi first.

**CRITICAL — concurrent WIP:** another session edits this repo (`KaneoAccessSection.*`, `docs/ux-reviews/`, and the UNRELATED orchestrator `McpSection`/`mcp_endpoints`). Every commit: `git add <exact paths>` only, NEVER `git add -A`. Do NOT touch `src/mcp/`, `McpSection.svelte`, or the other session's files. The new user section is named **"Coding MCP servers"** (component `CodingMcpSection.svelte`) — distinct from the orchestrator `McpSection`.

**Supersedes 3A's interim freeform vault:** 3A shipped user-entered `upstream_url` as a stepping stone. 3B-papai replaces it with the catalog selection. This is a pre-launch breaking change to the `mcp` vault shape (acceptable — nothing is deployed).

---

## File structure

**papai — new:**

- `src/coding-credentials/mcp-catalog.ts` — `mcpCatalogSchema`, `resolveMcpCatalog(pi)`, `setMcpCatalog(pi, entries)`, `adminMcpCatalogContextId(pi)` (mirror `guardrails.ts`).
- `src/debug/settings/admin/mcp-catalog-routes.ts` — GET/POST `/settings/api/admin/mcp-catalog` (mirror `coding-guardrails-routes.ts`).
- `client/settings/sections/admin/AdminMcpCatalogSection.svelte` — operator CRUD of catalog entries.
- `client/settings/sections/CodingMcpSection.svelte` — user picks a catalog server + supplies credential.

**papai — modified:**

- `src/coding-credentials/types.ts` — `FIELDS_BY_NAMESPACE.mcp` → `['server', 'upstream_token']`; `REQUIRED` → `['server', 'upstream_token']`.
- `src/debug/settings/coding-credentials-fields-meta.ts` — `mcp` meta: `server` (select), `upstream_token` (sensitive).
- `src/debug/settings/coding-credentials-routes.ts` — `if namespace === 'mcp'` surface the catalog (like `agent-provider` surfaces `allowedAgents`).
- `src/coding-credentials/resolve-agent-secrets.ts` — `resolveMcp` becomes catalog-driven; returns `toolPolicy`.
- `plugins/acp/tools.ts` — `projectSpec.mcp` gains `toolPolicy` (from `resolveMcp`).
- `client/settings/{admin-fetchers,fetchers,SettingsApp.svelte}` — wire the two new sections.

**magi — modified (small):**

- `plugins/acp` already sends `projectSpec.mcp`; add `toolPolicy` (papai side). magi already validates it (3B-magi). No new magi work here beyond the papai-sent field.

---

## Task 1: operator `mcp_catalog` config (papai)

**Files:** Create `src/coding-credentials/mcp-catalog.ts`; Test `tests/coding-credentials/mcp-catalog.test.ts`. READ `src/coding-credentials/guardrails.ts` (the exact `PREFIX`/`KEY`/schema/`getCachedConfig`/`setCachedConfig`/`adminContextId` idiom).

- [ ] **Step 1: Branch note** — papai commits to `master`; single-file/explicit-add commits (concurrent WIP).

- [ ] **Step 2: failing test** — `resolveMcpCatalog(pi)` returns `[]` by default; after `setMcpCatalog(pi, entries)` returns them; an invalid stored blob degrades to `[]` (fail-open to empty, like guardrails). `mcpCatalogSchema` rejects a bad entry.

```ts
import { describe, expect, it } from 'bun:test'
import { mcpCatalogSchema, resolveMcpCatalog, setMcpCatalog } from '../../src/coding-credentials/mcp-catalog.js'

describe('mcp_catalog', () => {
  it('defaults to empty', () => {
    expect(resolveMcpCatalog('pi-x')).toEqual([])
  })
  it('round-trips entries', () => {
    const entries = [
      {
        name: 'Jira',
        upstream_url: 'https://mcp.atlassian.com/v1',
        host: 'mcp.atlassian.com',
        default_tool_policy: 'allow' as const,
      },
    ]
    setMcpCatalog('pi-y', entries)
    expect(resolveMcpCatalog('pi-y')).toEqual(entries)
  })
  it('schema rejects a non-https url', () => {
    expect(mcpCatalogSchema.safeParse([{ name: 'x', upstream_url: 'http://h', host: 'h' }]).success).toBe(false)
  })
})
```

- [ ] **Step 3: verify FAIL.**

- [ ] **Step 4: implement** (mirror `guardrails.ts` exactly):

```ts
import { z } from 'zod'
import { getCachedConfig, setCachedConfig } from '../cache.js' // (confirm the real import from guardrails.ts)

const PREFIX = '__admin_mcp_catalog__:'
const KEY = 'mcp_catalog'

export const mcpCatalogEntrySchema = z.object({
  name: z.string().min(1),
  upstream_url: z
    .string()
    .url()
    .refine((u): boolean => u.startsWith('https://'), 'must be https'),
  host: z.string().min(1),
  header: z.string().optional(),
  default_tool_policy: z.enum(['allow', 'ask', 'deny']).optional(),
  tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
})
export const mcpCatalogSchema = z.array(mcpCatalogEntrySchema)
export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>

export function adminMcpCatalogContextId(pi: string): string {
  return `${PREFIX}${pi}`
}
export function resolveMcpCatalog(pi: string): McpCatalogEntry[] {
  const raw = getCachedConfig(adminMcpCatalogContextId(pi), KEY)
  const parsed = mcpCatalogSchema.safeParse(raw)
  return parsed.success ? parsed.data : []
}
export function setMcpCatalog(pi: string, entries: McpCatalogEntry[]): void {
  setCachedConfig(adminMcpCatalogContextId(pi), KEY, entries)
}
```

(Match the REAL `getCachedConfig`/`setCachedConfig` signatures + storage from `guardrails.ts`.)

- [ ] **Step 5–6:** `bun run check`; commit `src/coding-credentials/mcp-catalog.ts` + test — `git commit -m "feat(coding-mcp): operator mcp catalog config (admin-scoped)"`.

---

## Task 2: admin catalog route (papai)

**Files:** Create `src/debug/settings/admin/mcp-catalog-routes.ts`; wire into the settings router; Test `tests/debug/settings/admin/mcp-catalog-routes.test.ts`. READ `src/debug/settings/admin/coding-guardrails-routes.ts` (requireAdmin/requireCsrf, the `view(pi)` payload, the discriminated POST body, the dispatch `if (pathname === ...)`), and where routes are registered.

- [ ] **Step 1: failing test** — `GET /settings/api/admin/mcp-catalog` (as admin) returns `{ entries: [] }` by default; `POST { kind:'catalog', entries:[...] }` (admin + CSRF) persists them and GET reflects; non-admin → 403. Mirror the guardrails route test.
- [ ] **Step 2–4:** implement mirroring `coding-guardrails-routes.ts`: `handleGet` → `requireAdmin('read')` → `view(pi)` = `{ entries: resolveMcpCatalog(pi) }`; `handlePost` → `requireAdmin('write')` + `requireCsrf` + `PostBodySchema = z.object({ kind: z.literal('catalog'), entries: mcpCatalogSchema })` → `setMcpCatalog(pi, entries)` → return `view(pi)`; `log.info({ platformInstanceId: pi }, 'MCP catalog updated')`. Register the `/settings/api/admin/mcp-catalog` path in the settings router next to the guardrails route.
- [ ] **Step 5–6:** `bun run check`; commit the route + registration + test — `git commit -m "feat(coding-mcp): admin route for the mcp catalog"`.

---

## Task 3: `AdminMcpCatalogSection.svelte` (papai)

**Files:** Create `client/settings/sections/admin/AdminMcpCatalogSection.svelte`; add fetchers to `client/settings/admin-fetchers.js` (`fetchAdminMcpCatalog`/`postAdminMcpCatalog`); register in `client/settings/SettingsApp.svelte`; Test `tests/visual/settings/sections/AdminMcpCatalogSection.spec.ts` (Playwright, mirror an existing admin section spec). READ `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte` + its fetchers.

- [ ] Implement a CRUD list of catalog entries (add/edit/remove rows: `name`, `upstream_url`, `host`, `header`, `default_tool_policy` select, optional per-tool `tool_policy`), mirroring the guardrails section's `$state`/`draft*`/`load()`/`save()` + `$effect`+`untrack` mount pattern, `data-testid` on interactive elements. Register alongside `AdminCodingGuardrailsSection`.
- [ ] `bun run check` + the visual spec. Commit each new file explicitly — `git commit -m "feat(coding-mcp): admin UI to curate the mcp catalog"`.

---

## Task 4: restructure the `mcp` vault to a catalog selection (papai)

**Files:** Modify `src/coding-credentials/types.ts`, `src/debug/settings/coding-credentials-fields-meta.ts`, `src/debug/settings/coding-credentials-routes.ts`; Tests updated. READ the current `mcp` entries (from 3A) + how `agent-provider` surfaces `allowedAgents` in `handleGet`.

- [ ] **Step 1: failing test** — `FIELDS_BY_NAMESPACE.mcp` is `['server', 'upstream_token']` (was url/header/token); `FIELDS_META.mcp` has `server` as a `select` control + `upstream_token` sensitive; `GET coding-credentials?namespace=mcp` returns the field list PLUS `catalog: resolveMcpCatalog(pi)` (so the section can populate the `server` select). Update the 3A mcp tests to the new shape.
- [ ] **Step 2–4:**
  - `types.ts`: `MCP_FIELDS = ['server', 'upstream_token']`, `REQUIRED_MCP_FIELDS = ['server', 'upstream_token']`.
  - `coding-credentials-fields-meta.ts`: `mcp: [{ key:'server', label:'MCP server', required:true, control:'select' }, { key:'upstream_token', label:'Credential', required:true, sensitive:true }]` (the `select` options come from the catalog surfaced in the route, like `agent-provider`'s provider select uses `allowedAgents`).
  - `coding-credentials-routes.ts` `handleGet`: `if (namespace === 'mcp') return settingsJson(200, { ...fields, catalog: resolveMcpCatalog(pi) })` (mirror the `agent-provider`/`allowedAgents` branch).
- [ ] **Step 5–6:** `bun run check`; commit the touched files + tests — `git commit -m "feat(coding-mcp): mcp vault stores a catalog selection + credential"`.

---

## Task 5: `resolveMcp` becomes catalog-driven (papai)

**Files:** Modify `src/coding-credentials/resolve-agent-secrets.ts`; Test `tests/coding-credentials/resolve-agent-secrets.test.ts`. READ the 3A `resolveMcp` (it currently parses `upstream_url` from the vault) + `resolveMcpCatalog`.

- [ ] **Step 1: failing test** — with catalog entry `Jira {upstream_url, host, header, default_tool_policy:'deny', tool_policy:{echo:'allow'}}` and an `mcp` vault `{ server:'Jira', upstream_token:'sek' }` for an identity → `resolveMcp(...)` returns `{ url, host, header, allowedHosts:[host], toolPolicy:{ default:'deny', tools:{echo:'allow'} } }` (derived from the catalog, NOT the vault); `resolveMcpToken(...)` returns `'sek'`. A stored `server` NOT in the catalog → `resolveMcp` returns `null` (fail-closed). No `server` → `null`.
- [ ] **Step 2–4:** rewrite `resolveMcp`: read `server` (+ `upstream_token` presence) from the `mcp` vault for `identityContext(...)`; if missing → `null`. Look up `resolveMcpCatalog(pi).find(e => e.name === server)`; if not found → `null` (fail-closed — stale/removed entry). From the entry, return `{ url: entry.upstream_url, host: entry.host, header: entry.header ?? 'Authorization', allowedHosts: [entry.host], toolPolicy: catalogToolPolicy(entry) }` where `catalogToolPolicy(entry) = entry.default_tool_policy === undefined && entry.tool_policy === undefined ? undefined : { default: entry.default_tool_policy ?? 'allow', tools: entry.tool_policy }`. `resolveMcpToken` unchanged (reads `upstream_token`). Update `ResolvedMcp` to add `toolPolicy?`.
  - Note: the `pi` for `resolveMcpCatalog` comes from the identity context's platform instance — thread it the same way other per-pi lookups do (check how `resolveCodingGuardrails(pi)` is reached in this file / the facade).
- [ ] **Step 5–6:** `bun run check`; commit — `git commit -m "feat(coding-mcp): resolveMcp derives url/host/header/toolPolicy from the catalog"`.

---

## Task 6: `projectSpec.mcp.toolPolicy` + the user "Coding MCP servers" section (papai)

**Files:** Modify `plugins/acp/tools.ts` (add `toolPolicy` to `projectSpec.mcp`); Create `client/settings/sections/CodingMcpSection.svelte` + fetchers + register in `SettingsApp.svelte`; Tests. READ how `buildSessionProjectSpec` currently sets `mcp` (3A) + `CodingCredentialsSection.svelte` (the section to mirror).

- [ ] **Part A — projectSpec.toolPolicy:** in `buildSessionProjectSpec`, when `resolveMcp()` returns a config that includes `toolPolicy`, include it in `projectSpec.mcp` (it's part of the `ResolvedMcp` now). Test: with a resolved mcp carrying `toolPolicy`, the projectSpec's `mcp.toolPolicy` is present. (magi validates + enforces it — 3B-magi.)
- [ ] **Part B — CodingMcpSection.svelte:** a user section mirroring `CodingCredentialsSection.svelte` but `namespace: 'mcp'`: renders the `server` field as a `<select>` populated from the GET response's `catalog` (name → option), and `upstream_token` as a masked credential with Replace; whole-record save via `patchCodingCredentials({ contextId, namespace:'mcp', values })`; Clear + danger confirm. If `catalog` is empty, show "No MCP servers available — ask your operator." (mirror how `CodingCredentialsSection` reads `allowedAgents`). `data-testid` on interactive elements. Register in `SettingsApp.svelte` (its own section, NOT the orchestrator McpSection). Add a Playwright visual spec mirroring an existing coding-credentials section spec.
- [ ] `bun run check` + specs. Commit each new file explicitly — `git commit -m "feat(coding-mcp): Coding MCP servers settings section + projectSpec toolPolicy"`.

---

## Task 7: docs + verification

**Files:** `docs/architecture/coding-sessions.md` (papai — update; commit ONLY that file).

- [ ] Update the MCP-broker section: config is now **operator-curated catalog + user selection** — the operator publishes `mcp_catalog` (admin section), the user's "Coding MCP servers" section picks a vetted entry + supplies the credential; `resolveMcp` derives url/host/header/toolPolicy from the catalog (authoritative, no drift); the `toolPolicy` is enforced by the magi mediator (3B-magi). Note the tiered-trust model (no arbitrary self-serve). Commit — `git commit -m "docs(coding-sessions): operator catalog + user selection (Phase 3B-papai)"`.
- [ ] **Verification (runnable now):** unit/route/section tests cover the catalog config, admin route, vault restructure, catalog-driven `resolveMcp` (incl fail-closed on a removed entry), and `projectSpec.mcp.toolPolicy` population. The full docker E2E (operator catalog → user pick → worker → a denied tool blocked at the mediator) remains the **Linux handoff** (Phase-2 verification doc).

---

## Definition of done (3B-papai)

- [ ] An operator can publish/edit a vetted MCP-server catalog (`mcp_catalog` admin config + `AdminMcpCatalogSection`).
- [ ] A user picks a catalog server + supplies only their credential ("Coding MCP servers" section); the `mcp` vault stores `{ server, upstream_token }`.
- [ ] `resolveMcp` is catalog-driven + fail-closed (removed/unknown `server` → `null`); URL/host/header/toolPolicy come from the catalog (authoritative).
- [ ] `projectSpec.mcp.toolPolicy` is populated from the catalog → enforced by the magi mediator (3B-magi).
- [ ] Naming distinct from the orchestrator `McpSection`; concurrent WIP untouched; single-file commits.
- [ ] `check` green (papai) + magi still `check:full` green (the `toolPolicy` field it already validates).

## Handoff — remaining follow-ups (post-launch)

- **`'ask'` (interactive per-call permission):** a mid-session round-trip to the chat user (ACP-`request_permission`-style). The catalog + policy already carry `'ask'`; the mediator treats it as allow-with-warn until this lands.
- **Multi-server per session:** route the Phase-1 `serverId` handshake tag to per-server upstreams within one worker (or per-server worker enclosures for high-sensitivity creds). Today: single upstream per session.
- **Full-chain Linux E2E:** operator catalog → user pick → worker enclosure → upstream, with a denied tool blocked — on a same-kernel Linux host/CI.
- **`resolveMcpToken` shared-key parity:** if operators ever want a shared MCP credential (like `forceSharedKey` for agent-provider), add the override (forge/mcp are identity-only today).

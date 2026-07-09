<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-server MCP multiplexing — papai UX/resolvers Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a papai user select **multiple MCP servers** (any mix of internal plugin servers and external catalog servers) for a coding session, resolve them all-or-nothing (fail-closed, naming any culprit), send the array contract to magi, and bound the set by an operator-configurable cap.

**Architecture:** The `mcp` credential vault becomes a single `servers` JSON field holding an array of `{ server, upstream_token? }`. `resolveMcp`/`resolveMcpToken` become `resolveMcpServers` (validated list, or a structured error) and `resolveMcpTokens` (per-server token map; internal minted, external from the vault). `buildSessionProjectSpec` emits `mcp: McpUpstream[]`; `start_session`/`continue_session`/`review_pr` send `mcpTokens` and refuse the whole session (naming the bad server) if any selection doesn't resolve. The settings UI becomes an add-row list. A `maxMcpServers` operator guardrail (default 3) caps the set; magi enforces the hard ceiling (8) independently.

**Tech Stack:** Bun, strict TS (`.js` imports), Zod v4, Svelte 5 runes, oxfmt/oxlint/knip; pre-commit `bun run check` gate (no lint-disable/type-ignore).

**Repo:** All work is in **`/Users/ki/Projects/yourpapai/papai`**. Design spec: `docs/superpowers/specs/2026-07-09-multi-server-mcp-multiplexing-design.md`. **Prerequisite:** Plan 1 (magi) must be built/deployed together — this is a contract cutover with no backward compatibility.

---

## File Structure

| File                                                                                      | Change                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/coding-credentials/types.ts`                                                         | `MCP_FIELDS = ['servers']`, `REQUIRED_MCP_FIELDS = []`; add `CodingMcpSelection` + `codingMcpSelectionsSchema`                       |
| `src/coding-credentials/mcp-selections.ts` **(new)**                                      | parse/serialize the `servers` JSON array (fail-safe)                                                                                 |
| `src/coding-credentials/resolve-agent-secrets.ts`                                         | replace `resolveMcp`/`resolveMcpToken` with `resolveMcpServers`/`resolveMcpTokens` (array, all-or-nothing, per-server minting + cap) |
| `src/coding-credentials/guardrails.ts`                                                    | add `maxMcpServers` (default 3) to the schema/defaults                                                                               |
| `src/plugins/coding-secrets-facade.ts`                                                    | expose `resolveMcpServers`/`resolveMcpTokens` (gated) instead of the singular pair                                                   |
| `src/plugins/runtime-types.ts`                                                            | update the `codingSecrets` facade type                                                                                               |
| `plugins/acp/tools.ts`                                                                    | `RuntimeContext['codingSecrets']` type + `buildSessionProjectSpec` → `mcp` array (takes resolved servers)                            |
| `plugins/acp/session-tools.ts` (+ `continue-tool.ts` / review path)                       | resolve the set fail-closed; send `mcp` array + `mcpTokens` map; refuse naming the culprit                                           |
| `src/debug/settings/coding-credentials-routes.ts`                                         | `mcp` PATCH validates the `servers` array shape + count ≤ operator cap                                                               |
| `client/settings/fetcher-schemas.ts`                                                      | coding-credentials response carries `maxMcpServers`; `servers` array field                                                           |
| `client/settings/sections/CodingMcpSection.svelte`                                        | single `<select>` → add-row list (+ per-row token for external rows)                                                                 |
| `src/debug/settings/admin/coding-guardrails-routes.ts` + `CodingGuardrailsSection.svelte` | surface `maxMcpServers`                                                                                                              |

---

## Task 1: Array vault shape (`servers` JSON field)

**Files:**

- Modify: `src/coding-credentials/types.ts` (`MCP_FIELDS`/`REQUIRED_MCP_FIELDS` at ~52-54)
- Create: `src/coding-credentials/mcp-selections.ts`
- Test: `tests/coding-credentials/mcp-selections.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/coding-credentials/mcp-selections.test.ts  (add BUSL header)
import { describe, expect, test } from 'bun:test'

import {
  codingMcpSelectionsSchema,
  parseMcpSelections,
  serializeMcpSelections,
} from '../../src/coding-credentials/mcp-selections.js'

describe('mcp selections', () => {
  test('round-trips an array through the servers field', () => {
    const sels = [{ server: 'plugin:web-search' }, { server: 'github-mcp', upstream_token: 'tok' }]
    const stored = serializeMcpSelections(sels)
    expect(parseMcpSelections({ servers: stored })).toEqual(sels)
  })
  test('returns [] for missing/garbage', () => {
    expect(parseMcpSelections(null)).toEqual([])
    expect(parseMcpSelections({ servers: 'not json' })).toEqual([])
    expect(parseMcpSelections({})).toEqual([])
  })
  test('schema rejects an empty server name', () => {
    expect(codingMcpSelectionsSchema.safeParse([{ server: '' }]).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`bun test tests/coding-credentials/mcp-selections.test.ts`).

- [ ] **Step 3: Create `src/coding-credentials/mcp-selections.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { CodingCredentialConfig } from './types.js'

export const codingMcpSelectionSchema = z.object({
  server: z.string().min(1),
  upstream_token: z.string().optional(),
})
export type CodingMcpSelection = z.infer<typeof codingMcpSelectionSchema>

export const codingMcpSelectionsSchema = z.array(codingMcpSelectionSchema)

/** Serialize the selection array into the single `servers` vault field (JSON string). */
export function serializeMcpSelections(selections: CodingMcpSelection[]): string {
  return JSON.stringify(codingMcpSelectionsSchema.parse(selections))
}

/** Parse the `servers` vault field into a selection array. Fail-safe: [] on missing/invalid. */
export function parseMcpSelections(config: CodingCredentialConfig | null): CodingMcpSelection[] {
  const raw = (config as Record<string, string | undefined> | null)?.['servers']
  if (raw === undefined || raw.length === 0) return []
  try {
    const parsed = codingMcpSelectionsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Edit `src/coding-credentials/types.ts`.** Change the MCP field constants (around lines 52-54):

```ts
export const MCP_FIELDS = ['servers'] as const
export const REQUIRED_MCP_FIELDS = [] as const
export type McpField = (typeof MCP_FIELDS)[number]
```

(The store's `cleanConfig`/`FIELDS_BY_NAMESPACE`/`REQUIRED_BY_NAMESPACE` machinery keeps working — `servers` is just a string field; the array + per-row token live inside its JSON, and the whole payload stays AES-encrypted.)

- [ ] **Step 5: Run — expect PASS.** `bun run typecheck` (existing `resolveMcp` referencing `upstream_token`/`server` fields will now be red — fixed in Task 2; if the staged `check` blocks, land Tasks 1+2 in one commit).

- [ ] **Step 6: Commit**

```bash
git add src/coding-credentials/mcp-selections.ts src/coding-credentials/types.ts tests/coding-credentials/mcp-selections.test.ts
git commit -m "feat(coding-credentials): mcp vault stores a servers[] array of selections"
```

---

## Task 2: `resolveMcpServers` / `resolveMcpTokens` (all-or-nothing, array, cap)

**Files:**

- Modify: `src/coding-credentials/resolve-agent-secrets.ts` (replace `resolveMcp` 196-224, `resolveMcpToken` 230-234; the `ResolvedMcp`/`ToolPolicy` types stay)
- Test: `tests/coding-credentials/resolve-mcp-servers.test.ts`

- [ ] **Step 1: Write failing tests** (reuse the harness from `tests/coding-credentials/resolve-mcp-internal.test.ts`: registry bootstrap, `setMcpPluginServerConfigs`, `updateCodingCredentials`, `SETTINGS_PUBLIC_BASE_URL`). Cases:
  1. mixed set — one internal (`plugin:<id>`) enabled + one external (catalog entry with a token) → `resolveMcpServers` returns `{ ok: true, servers: [...] }` with both ids; `resolveMcpTokens` returns a token for each (internal minted → verifiable via `verifyPluginMcpToken`, external = the vault token).
  2. one bad selection (disabled internal, or external missing token, or unknown server) → `{ ok: false, error }` whose message names the offending server.
  3. count over `maxMcpServers` (set the guardrail to 1, select 2) → `{ ok: false, error }` mentioning the limit.
  4. empty selection → `{ ok: true, servers: [] }` and `resolveMcpTokens` → `{}`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Rewrite the resolvers.** Add imports: `parseMcpSelections` from `./mcp-selections.js`, `resolveCodingGuardrails` from `./guardrails.js` (already imported). Replace `resolveMcp`/`resolveMcpToken`:

```ts
/** A resolved MCP upstream for the projectSpec.mcp array. Never carries the token. */
export interface ResolvedMcpServer {
  id: string
  url: string
  host: string
  header: string
  allowedHosts: string[]
  toolPolicy?: ToolPolicy
}

export type ResolveMcpResult = { ok: true; servers: ResolvedMcpServer[] } | { ok: false; error: string }

function resolveOneMcpServer(
  server: string,
  upstreamToken: string | undefined,
  storageContextId: string,
  pi: string,
): ResolvedMcpServer | { error: string } {
  if (server.startsWith(INTERNAL_SERVER_PREFIX)) {
    const entry = listEnabledInternalMcpServers(pi, configContextOf(storageContextId)).find((e) => e.name === server)
    if (entry === undefined) return { error: `MCP server '${server}' is not an enabled internal server` }
    let hostname: string
    try {
      hostname = new URL(entry.upstreamUrl).hostname
    } catch {
      return { error: `MCP server '${server}' has an unparseable upstream URL` }
    }
    return {
      id: server,
      url: entry.upstreamUrl,
      host: hostname,
      header: entry.header,
      allowedHosts: [hostname],
      toolPolicy: entry.toolPolicy,
    }
  }
  const token = upstreamToken?.trim()
  if (token === undefined || token.length === 0) return { error: `MCP server '${server}' is missing its credential` }
  const entry = resolveMcpCatalog(pi).find((e) => e.name === server)
  if (entry === undefined) return { error: `MCP server '${server}' is not in the catalog` }
  const hostname = new URL(entry.upstream_url).hostname
  return {
    id: server,
    url: entry.upstream_url,
    host: hostname,
    header: entry.header ?? 'Authorization',
    allowedHosts: [hostname],
    toolPolicy: catalogToolPolicy(entry),
  }
}

/** Resolve the acting identity's full MCP set, fail-closed all-or-nothing. */
export function resolveMcpServers(storageContextId: string, chatUserId: string): ResolveMcpResult {
  const selections = parseMcpSelections(getCodingCredentials(identityContext(storageContextId, chatUserId), 'mcp'))
  if (selections.length === 0) return { ok: true, servers: [] }
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) return { ok: false, error: 'no platform instance for MCP resolution' }
  const cap = resolveCodingGuardrails(pi).maxMcpServers
  if (selections.length > cap) return { ok: false, error: `too many MCP servers selected (max ${cap})` }
  const servers: ResolvedMcpServer[] = []
  const seen = new Set<string>()
  for (const sel of selections) {
    if (seen.has(sel.server)) return { ok: false, error: `MCP server '${sel.server}' selected more than once` }
    seen.add(sel.server)
    const resolved = resolveOneMcpServer(sel.server, sel.upstream_token, storageContextId, pi)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    servers.push(resolved)
  }
  return { ok: true, servers }
}

/** Per-server credential map for the set. Internal servers mint; external use their vault token. */
export function resolveMcpTokens(storageContextId: string, chatUserId: string): Record<string, string> {
  const selections = parseMcpSelections(getCodingCredentials(identityContext(storageContextId, chatUserId), 'mcp'))
  const tokens: Record<string, string> = {}
  for (const sel of selections) {
    if (sel.server.startsWith(INTERNAL_SERVER_PREFIX)) {
      tokens[sel.server] = mintPluginMcpToken({
        storageContextId,
        chatUserId,
        pluginId: sel.server.slice(INTERNAL_SERVER_PREFIX.length),
      })
    } else {
      const token = sel.upstream_token?.trim()
      if (token !== undefined && token.length > 0) tokens[sel.server] = token
    }
  }
  return tokens
}
```

Keep `ResolvedMcp` type only if other code still needs it; otherwise remove it and `catalogToolPolicy` stays. Delete the old `resolveMcp`/`resolveMcpToken`.

- [ ] **Step 4: Run — expect PASS** (`bun test tests/coding-credentials/`).
- [ ] **Step 5: `bunx oxfmt --write` + `bun run typecheck`** (facade/acp still reference the old names — Task 3). If staged `check` blocks, land with Task 3.
- [ ] **Step 6: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts tests/coding-credentials/resolve-mcp-servers.test.ts
git commit -m "feat(coding-credentials): resolveMcpServers/resolveMcpTokens (array, fail-closed, capped)"
```

---

## Task 3: Facade + acp spec wiring

**Files:**

- Modify: `src/plugins/coding-secrets-facade.ts` (the `resolveMcp`/`resolveMcpToken` gates)
- Modify: `src/plugins/runtime-types.ts` (`codingSecrets` type)
- Modify: `plugins/acp/tools.ts` (`RuntimeContext['codingSecrets']` mirror type + `buildSessionProjectSpec` 109-136)
- Test: `tests/plugins/*` facade test if present; `tests/` for `buildSessionProjectSpec` (extend the acp tools test)

- [ ] **Step 1: Write failing tests** for `buildSessionProjectSpec` emitting `mcp` as an array from a passed-in `ResolvedMcpServer[]` (e.g. two servers → `spec.mcp` length 2, each with `id`), and omitting `mcp` when the array is empty.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit the facade** (`coding-secrets-facade.ts`): replace the two gated lines

```ts
  resolveMcp: gate(() => resolveMcp(storageContextId, chatUserId)),
  resolveMcpToken: gate(() => resolveMcpToken(storageContextId, chatUserId)),
```

with

```ts
  resolveMcpServers: gate(() => resolveMcpServers(storageContextId, chatUserId)),
  resolveMcpTokens: gate(() => resolveMcpTokens(storageContextId, chatUserId)),
```

Update the import from `resolve-agent-secrets.js`.

- [ ] **Step 4: Edit the facade types** in `src/plugins/runtime-types.ts` and the acp-local mirror in `plugins/acp/tools.ts`: replace

```ts
  resolveMcp(): { url; host; header; allowedHosts; toolPolicy? } | null
  resolveMcpToken(): string | undefined
```

with

```ts
  resolveMcpServers(): { ok: true; servers: Array<{ id: string; url: string; host: string; header: string; allowedHosts: string[]; toolPolicy?: { default: string; tools?: Record<string, string> } }> } | { ok: false; error: string }
  resolveMcpTokens(): Record<string, string>
```

(Match the exact `ToolPolicy`/`Permission` types the file already uses.)

- [ ] **Step 5: Edit `buildSessionProjectSpec`** (tools.ts:109-136) — take the resolved servers as a parameter and emit the array:

```ts
export function buildSessionProjectSpec(
  repo: RepoEntry,
  agent: string,
  codingSecrets: RuntimeContext['codingSecrets'],
  mcpServers: Array<{
    id: string
    url: string
    host: string
    header: string
    allowedHosts: string[]
    toolPolicy?: { default: string; tools?: Record<string, string> }
  }>,
): Record<string, unknown> {
  const base = buildProjectSpec(repo, agent)
  const forge = codingSecrets.resolveForge()
  const providerHost = codingSecrets.resolveProviderHost()
  const model = codingSecrets.resolveModel()
  return {
    ...base,
    ...(forge === null ? {} : { forge }),
    ...(providerHost === null ? {} : { providerHost }),
    ...(model === null ? {} : { model }),
    ...(mcpServers.length === 0 ? {} : { mcp: mcpServers }),
  }
}
```

- [ ] **Step 6: Run — expect PASS; `bunx oxfmt --write` + `bun run typecheck`** (session-tools/continue/review callers still pass the old args — Task 4).
- [ ] **Step 7: Commit**

```bash
git add src/plugins/coding-secrets-facade.ts src/plugins/runtime-types.ts plugins/acp/tools.ts tests/
git commit -m "feat(acp): facade exposes resolveMcpServers/Tokens; buildSessionProjectSpec emits mcp[]"
```

---

## Task 4: Fail-closed session start (session-tools + continue + review)

**Files:**

- Modify: `plugins/acp/session-tools.ts` (`startSessionTool` 64-107); `plugins/acp/continue-tool.ts`; the `review_pr` path (grep `buildSessionProjectSpec`/`resolveMcpToken` across `plugins/acp/`)
- Test: `tests/` acp session-tools test (extend)

- [ ] **Step 1: Write failing tests** — `start_session` with a set containing one unresolvable server returns a structured error naming it and does NOT call magi; a valid set sends a `POST /sessions` body with `projectSpec.mcp` (array) and top-level `mcpTokens` (map). Mirror the existing session-tools test's magi-fetch mock.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit `startSessionTool`.** Before building the spec (around line 91):

```ts
const mcpResult = runtimeContext.codingSecrets.resolveMcpServers()
if (!mcpResult.ok) {
  return { error: 'mcp_unavailable', message: mcpResult.error }
}
const projectSpec = buildSessionProjectSpec(repo, resolvedAgent, runtimeContext.codingSecrets, mcpResult.servers)
const mcpTokens = runtimeContext.codingSecrets.resolveMcpTokens()
```

and in the `callMagi(...)` body replace the old `...(mcpToken === undefined ? {} : { mcpToken })` (line 101) with:

```ts
        ...(Object.keys(mcpTokens).length === 0 ? {} : { mcpTokens }),
```

Apply the identical pattern to `continue_session` (`continue-tool.ts`) and `review_pr` wherever they call `buildSessionProjectSpec` + send a token (grep to find each; each must: resolve fail-closed, pass `mcpResult.servers` to `buildSessionProjectSpec`, send `mcpTokens`). If a caller currently has no MCP wiring, add the resolve+refuse+send there too (consistency: every session-launch path is fail-closed).

- [ ] **Step 4: Run — expect PASS; `bun run check`** (staged gate). `grep -rn "resolveMcp\b\|resolveMcpToken\b" src/ plugins/` should return nothing (old names fully retired).
- [ ] **Step 5: Commit**

```bash
git add plugins/acp/ tests/
git commit -m "feat(acp): fail-closed multi-MCP resolution on session start/continue/review"
```

---

## Task 5: `maxMcpServers` operator guardrail

**Files:**

- Modify: `src/coding-credentials/guardrails.ts` (schema 14-18 + DEFAULTS 25)
- Test: `tests/coding-credentials/guardrails.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — default `maxMcpServers` is 3; the schema clamps to `[1, 8]` (reject 0 and 9); round-trips via `setCodingGuardrails`/`resolveCodingGuardrails`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit `guardrails.ts`.** Add to `guardrailsSchema`:

```ts
  maxMcpServers: z.number().int().min(1).max(8).default(3),
```

and to `DEFAULTS()`:

```ts
  maxMcpServers: 3,
```

- [ ] **Step 4: Run — expect PASS; `bun run check`.** (Task 2's `resolveMcpServers` already reads `resolveCodingGuardrails(pi).maxMcpServers` — this makes it real.)
- [ ] **Step 5: Commit**

```bash
git add src/coding-credentials/guardrails.ts tests/coding-credentials/guardrails.test.ts
git commit -m "feat(coding-guardrails): maxMcpServers soft cap (default 3, clamp 1..8)"
```

---

## Task 6: Route validation for the `servers` array + cap

**Files:**

- Modify: `src/debug/settings/coding-credentials-routes.ts` (the `mcp` PATCH path; GET already returns `catalog`+`pluginServers` from the prior feature — add `maxMcpServers`)
- Test: `tests/debug/settings/coding-credentials-mcp-servers-array.test.ts`

- [ ] **Step 1: Write failing tests** — GET for `namespace=mcp` includes `maxMcpServers` (from guardrails); PATCH with a well-formed `servers` JSON (count ≤ cap) persists; PATCH exceeding the cap → 422; PATCH with malformed `servers` JSON → 422.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit the route.** In the `namespace === 'mcp'` GET branch (already returns `{ ...fields, catalog, pluginServers }`), add `maxMcpServers: resolveCodingGuardrails(authed.principal.platformInstanceId).maxMcpServers`. In `handlePatch`, for `namespace === 'mcp'` add validation before persist: parse `toPersist.servers` with `codingMcpSelectionsSchema` (422 on failure) and check `length ≤ resolveCodingGuardrails(pi).maxMcpServers` (422 `too many MCP servers`). Import `codingMcpSelectionsSchema` and `resolveCodingGuardrails`.

- [ ] **Step 4: Run — expect PASS; `bun run check`.**
- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/coding-credentials-routes.ts tests/debug/settings/coding-credentials-mcp-servers-array.test.ts
git commit -m "feat(settings): validate mcp servers[] array + cap on save; expose maxMcpServers"
```

---

## Task 7: Add-row selection UI (CodingMcpSection.svelte)

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (coding-credentials response: `maxMcpServers?: number`; keep `catalog`/`pluginServers`)
- Modify: `client/settings/sections/CodingMcpSection.svelte` (single `<select>` → row list)
- Modify: story + MSW + visual spec (mirror the prior feature's approach)
- Test: `tests/visual/settings/sections/CodingMcpSection.spec.ts`

- [ ] **Step 1: Extend the response schema** — add `maxMcpServers: z.number().optional()` next to `catalog`/`pluginServers`.

- [ ] **Step 2: Rewrite the section as an add-row list.** State: `rows: { server: string; upstream_token: string }[]` derived from the loaded `servers` JSON (parse `currentData.fields` `servers` value). Options for each row's server `<select>` = external catalog names + internal `plugin:<id>` names (reuse the prior `selectOptionsFor` union). For each row: a server dropdown; if the selected server is an internal plugin server (name starts with `plugin:`), hide the token input; else show a token input. "Add server" appends a row (disabled when `rows.length >= maxMcpServers`); each row has a remove button. Save serializes `rows` (dropping empty rows; omitting `upstream_token` for internal) to the `servers` field via `patchCodingCredentials({ contextId, namespace: 'mcp', values: { servers: JSON.stringify(cleaned) } })`. Keep the clear/refresh/status flows. Use `data-testid`s `coding-mcp-row-<i>`, `coding-mcp-add`, `coding-mcp-remove-<i>`, `coding-mcp-server-<i>`, `coding-mcp-token-<i>`.

- [ ] **Step 3: Story + MSW + spec.** Add a story/MSW variant where the GET returns `catalog: [{name:'github-mcp',...}]`, `pluginServers: [{name:'plugin:synthetic-web-search',label:'Synthetic Web Search'}]`, `maxMcpServers: 3`, and a `servers` field pre-seeding one internal + one external row. Spec assertions: two rows render; the internal row shows no token input; the external row shows a token input; "Add server" disables at the cap; removing a row updates the count. Follow the prior feature's Playwright/shoot:gen pattern.

- [ ] **Step 4: `bun run build:client` + run the visual spec** — expect PASS. `bun run check`.
- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/sections/CodingMcpSection.svelte client/settings/sections/CodingMcpSection.stories.svelte client/stories/msw/ tests/visual/settings/sections/CodingMcpSection.spec.ts
git commit -m "feat(settings-ui): add-row multi-MCP-server picker (per-row token for external)"
```

---

## Task 8: Admin guardrail control + end-to-end proof

**Files:**

- Modify: `src/debug/settings/admin/coding-guardrails-routes.ts` + `client/settings/sections/admin/CodingGuardrailsSection.svelte` (surface `maxMcpServers`)
- Test: admin route test (extend); `tests/` end-to-end resolver test

- [ ] **Step 1: Write failing tests** — the admin guardrails GET returns `maxMcpServers`; POST `{ kind: 'policy', guardrails: { ..., maxMcpServers: 5 } }` persists it (reject out-of-range via the schema → 422). Plus an end-to-end resolver test: a mixed set (one internal + one external, both valid, within cap) → `resolveMcpServers` ok with 2 servers and `resolveMcpTokens` yields a verifiable minted token for the internal and the vault token for the external; flipping the internal to disabled → `{ ok: false }` naming it.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit the admin route + section.** The guardrails POST/GET already round-trip the whole `guardrails` object through `guardrailsSchema` (Task 5 added `maxMcpServers`), so the route may already carry it — add it to the GET response shape/section if the section renders fields explicitly. In `CodingGuardrailsSection.svelte` add a number input for `maxMcpServers` (1..8) alongside the existing allowed-agents / who-may-use / force-shared-key controls, saved in the same whole-record POST.

- [ ] **Step 4: `bun run build:client` + `bun test` (full suite) + `bun run check:full`** — expect all green, knip 0.
- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/coding-guardrails-routes.ts client/settings/sections/admin/CodingGuardrailsSection.svelte tests/
git commit -m "feat(settings): admin maxMcpServers control + end-to-end multi-MCP proof"
```

---

## Self-review notes (author)

- **Spec coverage:** array vault → Task 1; array resolvers all-or-nothing + cap → Task 2; facade/spec `mcp[]` + `mcpTokens` → Task 3; fail-closed session start naming culprit → Task 4; `maxMcpServers` guardrail → Tasks 5,8; save validation → Task 6; add-row UI → Task 7. Contract cutover (no back-compat) is inherent (vault + resolvers replaced, not extended).
- **Type consistency:** `CodingMcpSelection` (1) → `resolveMcpServers`/`resolveMcpTokens` (2) → facade (3) → session-tools (4); `ResolvedMcpServer.id` is the `serverId` sent as `mcp[].id`; `mcpTokens` keyed by the same `serverId`; `maxMcpServers` read identically in resolver (2), route (6), and set by guardrails (5) — one source of truth.
- **Cross-repo join:** papai now sends `projectSpec.mcp: McpUpstream[]` + `mcpTokens` map; magi (Plan 1) consumes them. The `serverId` on each entry (`ResolvedMcpServer.id` = the vault `server` value) is the routing key magi's mediator dispatches on. Ship together (no backward compatibility).

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 2: `mcp-confluence` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-confluence` — agent-facing Confluence wiki tools (read pages/comments, resolve short links, add a comment) exposed as an MCP server for coding agents, with bridge-level response redaction.

**Architecture:** A native papai plugin of the exact shape proven by `plugins/mcp-sentry/` (Plan 1). `mcpServer: true` exposes its tools at `/mcp/plugin/mcp-confluence`; `mcpResponseRedaction: true` runs every tool response through the existing bridge redactor before it reaches the coding agent. The redaction foundation (manifest flag, `mcp_redaction` admin config, redactor, fail-closed eligibility, settings API) already exists from Plan 1 — **no core changes**. Confluence uses **HTTP Basic auth**; all REST calls go through `{base_url}/rest/api{path}`.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

---

## The reference: read `plugins/mcp-sentry/` first

This plan is a second application of the template established (and committed) in Plan 1. Before starting, read the committed reference implementation — you will mirror its shape exactly, substituting Confluence specifics:

- `plugins/mcp-sentry/plugin.json` — manifest shape (`mcpServer`, `mcpResponseRedaction`, `permissions:["http"]`, `providerAllowedHostsFromConfig`, admin-scoped `configRequirements`, `configKeys:[]`).
- `plugins/mcp-sentry/context.ts` — the plugin-agnostic context facade (copy verbatim).
- `plugins/mcp-sentry/input-schema.ts` + `tests/plugins/mcp-sentry-schema.test.ts` — JSON-Schema `as const` objects + STRUCTURAL schema tests (assert the declared contract; do NOT build a runtime validator — papai does not locally validate MCP tool inputs).
- `plugins/mcp-sentry/client.ts` + the `SentryClient` tests in `tests/plugins/mcp-sentry.test.ts` — injected-`httpFetch` client, `unknown`-narrowing via `isRecord` guards (no `as` casts), `encodeURIComponent` on every caller-supplied URL path segment.
- `plugins/mcp-sentry/index.ts` — factory: `activate` reads `providerRuntime.httpFetch`, registers tools; each `execute` does rate-limit → read admin creds at execution time → `not_configured` if missing → build client → call → structured error mapping (`timeout`/`sentry_error`). Uses `buildToolDefinitions` extracted out of `activate` to satisfy `max-lines-per-function`.
- `plugins/mcp-sentry/README.md` — README shape.
- `tests/mcp-server/mcp-sentry-listing.test.ts` — the end-to-end verification test (discover → activate → `listPluginMcpTools` returns the tools).

## CRITICAL process notes (learned in Plan 1)

- Before EVERY commit run the FULL `bun run lint` (not just `bunx oxlint <file>`) and `bun run knip`. Type-aware oxlint rules (e.g. `strict-boolean-expressions` — "unexpected any/unknown value in conditional") only surface in the full run and CI, not in the per-commit hook. No lint-disables — fix the underlying issue (e.g. never test truthiness of an `unknown` directly; use explicit comparisons).
- Every new file needs the SPDX license header (see any existing `.ts`).
- Knip: a plugin file unused until a later task consumes it needs a `knip.jsonc` ignore following the existing plugin precedent; remove it once consumed. The plugin entry `plugins/mcp-confluence/index.ts` keeps an `["exports"]` ignore like other plugins.
- `encodeURIComponent` EVERY caller-supplied URL path segment (Plan 1 review finding #3).

---

## Confluence API facts (port faithfully; source: kiss `mcp/confluence-mcp/`)

**Auth (all tools):** HTTP Basic. Header `Authorization: Basic <base64(username:password)>` built once. In Bun, `Buffer.from(`${username}:${password}`).toString('base64')`.

**Base request helper:** `GET/POST {base_url}/rest/api{path}` with headers `Authorization`, `Accept: application/json`, `Content-Type: application/json`. Non-2xx → throw `Confluence API <status> for <path>: <body slice>`. `base_url` trimmed of trailing slashes; default `https://wiki.skbkontur.ru`.

**Expand constant:** `expand=body.storage,version,space` on page/comment reads.

**Simplify (field-stripping, ~80% size cut) — port into `format.ts`:**

- `simplifyPage(page)` → `{ id, type, title, space: { key, name }, body: { storage: { value, representation } } }` (drop version/\_links/\_expandable/status/extensions/space.id/space.type).
- `simplifyComment(comment)` → same minus `space`.
- `simplifyComments(resp)` → `{ results: simplifyComment[], size, limit, start }`.
- No HTML→text conversion; storage XHTML preserved verbatim. (papai adaptation: we return the SIMPLIFIED OBJECT from each tool and let the bridge `JSON.stringify` + redact it — we do NOT reproduce kiss's plain-text `format-output.ts` line-wrapping, which only existed to dodge qwen's 10k single-line limit; papai's `sizeGuard` handles size.)

**The 5 tools:**

| Tool                            | Input (zod→JSON schema)                                        | HTTP                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confluence_get_page`           | `{ pageId: string (req) }`                                     | `GET /content/{enc(pageId)}?expand=body.storage,version,space` → `simplifyPage`                                                                                                        |
| `confluence_get_page_by_title`  | `{ spaceKey: string (req), title: string (req) }`              | `GET /content?spaceKey={enc}&title={enc}&expand=body.storage,version,space` → `results[0]` (throw "not found" if empty) → `simplifyPage`                                               |
| `confluence_get_comments`       | `{ pageId: string (req) }`                                     | `GET /content/{enc(pageId)}/child/comment?expand=body.storage,version,space&limit=100` → `simplifyComments`                                                                            |
| `confluence_add_comment`        | `{ pageId: string (req), text: string (req) — storage XHTML }` | `POST /content/{enc(pageId)}/child/comment?expand=body.storage,version,space` body `{ type:'comment', body:{ storage:{ value:text, representation:'storage' } } }` → `simplifyComment` |
| `confluence_resolve_short_link` | `{ shortLink: string (req) }`                                  | resolve tiny link → pageId, then `getPage(pageId)`; return `{ resolvedUrl, page: simplifyPage }`                                                                                       |

**`confluence_resolve_short_link` resolution (does NOT use `/rest/api`):**

1. Extract key: if `shortLink` contains `/x/`, `key = shortLink.split('/x/').pop().replace(/\/+$/,'')`; else `key = shortLink.trim()`. Throw if empty.
2. `tinyUrl = {base_url}/x/{enc(key)}`.
3. `HEAD tinyUrl` with `redirect:'manual'`, header `Authorization`. If status 300–399, read `Location`, try `extractPageId(location)`; if found → `{ pageId, resolvedUrl: location }`.
4. Else `GET tinyUrl` with `redirect:'follow'`, header `Authorization`. If not ok → throw. `finalUrl = response.url`; `pageId = extractPageId(finalUrl)`; throw if null; → `{ pageId, resolvedUrl: finalUrl }`.
5. `extractPageId(loc)`: `loc.match(/[?&]pageId=(\d+)/)?.[1] ?? loc.match(/\/pages\/(\d+)/)?.[1] ?? null`.

> **⚠ RISK to verify in Task 4 (resolve_short_link):** this relies on `providerRuntime.httpFetch` (a) passing the `init.redirect` option through to the underlying fetch, (b) exposing `response.url` (final URL after `redirect:'follow'`), and (c) exposing `response.headers.get('location')` on a 3xx with `redirect:'manual'`. papai's `httpFetch` also enforces `providerAllowedHosts` — all hops here stay on the `base_url` host (the wiki), so the allowlist is satisfied, BUT confirm httpFetch does not strip the `redirect` option or block a 3xx. **Read `src/plugins/provider-runtime.ts` (or wherever `httpFetch` is implemented) FIRST.** If httpFetch forces `redirect:'follow'` and hides intermediate `Location`, implement resolve using only the GET-follow path (step 4) + `response.url`. If httpFetch cannot expose `response.url` either, treat `resolve_short_link` as the one tool to defer — register the other 4 and report this as a DONE_WITH_CONCERNS blocker for `resolve_short_link` rather than shipping something untested.

**Redaction:** `mcpResponseRedaction: true`. The plugin does NOT call any redactor itself — the bridge redacts every tool response. (kiss's per-server `validatedAnswer` is replaced by papai's generic bridge redaction from Plan 1.) `confluence_add_comment` in kiss validated only the comment body and appended an unvalidated "added to page {id}" prefix — in papai just return the simplified comment object; the whole thing is redacted uniformly, which is strictly safer.

**Tool policy:** `confluence_add_comment` is a write — the operator should set its per-tool policy to `ask`/`deny` at enable time (not encoded in the manifest). Note this in the README.

---

## File structure

```
plugins/mcp-confluence/
  plugin.json     # mcpServer+mcpResponseRedaction, http, providerAllowedHostsFromConfig:["base_url"], admin creds
  context.ts      # verbatim copy of plugins/mcp-sentry/context.ts
  input-schema.ts # 5 JSON-Schema objects
  format.ts       # simplifyPage / simplifyComment / simplifyComments
  client.ts       # ConfluenceClient (Basic auth, 5 methods, resolve_short_link)
  index.ts        # factory registering 5 tools
  README.md
tests/plugins/mcp-confluence.test.ts         # format + client + plugin blocks
tests/plugins/mcp-confluence-schema.test.ts  # structural schema tests
tests/mcp-server/mcp-confluence-listing.test.ts  # e2e listing verification
```

---

## Task 1: Manifest + context facade

**Files:** create `plugins/mcp-confluence/plugin.json`, `plugins/mcp-confluence/context.ts`, and a minimal placeholder `plugins/mcp-confluence/index.ts` (discovery reads `main`).

- [ ] **Step 1:** Copy `plugins/mcp-sentry/context.ts` verbatim to `plugins/mcp-confluence/context.ts`.
- [ ] **Step 2:** Create `plugins/mcp-confluence/plugin.json`:

```json
{
  "id": "mcp-confluence",
  "name": "Confluence (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing Confluence wiki read/comment tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "mcpResponseRedaction": true,
  "contributes": {
    "tools": [
      "confluence_get_page",
      "confluence_get_page_by_title",
      "confluence_get_comments",
      "confluence_add_comment",
      "confluence_resolve_short_link"
    ],
    "promptFragments": [],
    "configKeys": []
  },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "Confluence Base URL", "required": true, "scope": "admin" },
    { "key": "username", "label": "Confluence Username", "required": true, "scope": "admin" },
    { "key": "password", "label": "Confluence Password/Token", "required": true, "sensitive": true, "scope": "admin" }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] **Step 3:** Create a minimal placeholder `plugins/mcp-confluence/index.ts` (license header + a factory that calls `requirePluginContext(ctx)` and logs, registering NO tools yet — mirror what `plugins/mcp-sentry` used at its scaffold step so `context.ts` is imported and knip sees the entry reachable).
- [ ] **Step 4:** Add `"plugins/mcp-confluence/index.ts": ["exports"]` to `knip.jsonc` alongside the `mcp-sentry` entry. Confirm the manifest parses: `bun -e "import {pluginManifestSchema} from './src/plugins/types.js'; pluginManifestSchema.parse(require('./plugins/mcp-confluence/plugin.json'))"` (delete any throwaway file). Run `bun test tests/plugins/discovery.test.ts` (must stay green — mc-confluence discovered, no errors). `bun run typecheck` + full `bun run lint` + `bun run knip` clean.
- [ ] **Step 5:** Commit: `git add plugins/mcp-confluence/ knip.jsonc && git commit -m "feat(mcp-confluence): plugin manifest and context facade"`

## Task 2: Input schemas

**Files:** create `plugins/mcp-confluence/input-schema.ts`, `tests/plugins/mcp-confluence-schema.test.ts`.

- [ ] **Step 1:** Write STRUCTURAL schema tests (mirror `tests/plugins/mcp-sentry-schema.test.ts` — assert `.required`, `.properties.*`, `additionalProperties:false`; NO runtime validator). Cover all 5 schemas: `confluence_get_page`→required `pageId`; `get_page_by_title`→required `spaceKey`+`title`; `get_comments`→required `pageId`; `add_comment`→required `pageId`+`text`; `resolve_short_link`→required `shortLink`. Run → FAIL.
- [ ] **Step 2:** Create `input-schema.ts` — 5 exported `as const` JSON-Schema objects:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const confluenceGetPageSchema = {
  type: 'object',
  properties: { pageId: { type: 'string', minLength: 1, description: 'Confluence page id' } },
  required: ['pageId'],
  additionalProperties: false,
} as const

export const confluenceGetPageByTitleSchema = {
  type: 'object',
  properties: {
    spaceKey: { type: 'string', minLength: 1, description: 'Space key, e.g. TEAM' },
    title: { type: 'string', minLength: 1, description: 'Exact page title' },
  },
  required: ['spaceKey', 'title'],
  additionalProperties: false,
} as const

export const confluenceGetCommentsSchema = {
  type: 'object',
  properties: { pageId: { type: 'string', minLength: 1, description: 'Confluence page id' } },
  required: ['pageId'],
  additionalProperties: false,
} as const

export const confluenceAddCommentSchema = {
  type: 'object',
  properties: {
    pageId: { type: 'string', minLength: 1, description: 'Confluence page id' },
    text: { type: 'string', minLength: 1, description: 'Comment body in Confluence storage (XHTML) format' },
  },
  required: ['pageId', 'text'],
  additionalProperties: false,
} as const

export const confluenceResolveShortLinkSchema = {
  type: 'object',
  properties: {
    shortLink: { type: 'string', minLength: 1, description: 'Confluence tiny link (full URL or /x/<key>)' },
  },
  required: ['shortLink'],
  additionalProperties: false,
} as const
```

- [ ] **Step 3:** Run schema test → PASS. `bun run typecheck` + full `bun run lint` + `bun run knip` (add a `knip.jsonc` `["files"]` ignore for `input-schema.ts` if flagged — consumed by index.ts in Task 5). Commit: `feat(mcp-confluence): tool input schemas`.

## Task 3: Simplify helpers (`format.ts`)

**Files:** create `plugins/mcp-confluence/format.ts`, extend `tests/plugins/mcp-confluence.test.ts`.

- [ ] **Step 1:** Write failing tests for `simplifyPage`/`simplifyComment`/`simplifyComments`: given a full page object with `_links`, `version`, `extensions`, `space.id`, assert only `{ id, type, title, space:{key,name}, body:{storage:{value,representation}} }` survive; `simplifyComment` drops `space`; `simplifyComments` preserves `size/limit/start` and maps results. Run → FAIL.
- [ ] **Step 2:** Create `format.ts` with `simplifyPage`, `simplifyComment`, `simplifyComments`. Inputs are `unknown` (API responses) — narrow with an `isRecord` guard (copy the pattern from `plugins/mcp-sentry/client.ts`/`format.ts`); never use `as` on `unknown`. Return plain objects with only the kept fields; tolerate missing nested fields (e.g. absent `space` → omit or `undefined`), never throw.
- [ ] **Step 3:** Run → PASS. typecheck + full lint + knip (ignore for `format.ts` if flagged, removed in Task 5). Commit: `feat(mcp-confluence): response simplify helpers`.

## Task 4: `ConfluenceClient`

**Files:** create `plugins/mcp-confluence/client.ts`, extend `tests/plugins/mcp-confluence.test.ts`.

- [ ] **Step 1 (verify the httpFetch redirect contract FIRST):** Read papai's `httpFetch` implementation (grep `httpFetch` under `src/plugins/`). Confirm whether it forwards `init.redirect` and exposes `response.url` / `response.headers.get('location')`. Decide the `resolve_short_link` implementation accordingly (see the RISK note above). Record what you found in your report.
- [ ] **Step 2:** Write failing client tests (mock `httpFetch`, capture URL + headers). Assert:
  - construct with `{ baseUrl:'https://wiki.test', username:'u', password:'p', httpFetch }`; `getPage('810922884')` → `GET https://wiki.test/rest/api/content/810922884?expand=body.storage,version,space` with header `Authorization: 'Basic ' + base64('u:p')` and `Accept: application/json`.
  - `getPageByTitle('TEAM','My Page')` → URL `.../rest/api/content` with query `spaceKey=TEAM&title=My+Page&expand=...`; empty `results` → throws "not found".
  - `getComments('810922884')` → `.../content/810922884/child/comment?...&limit=100`.
  - `addComment('810922884','<p>hi</p>')` → `POST .../content/810922884/child/comment?...` with the `{type:'comment',body:{storage:{value:'<p>hi</p>',representation:'storage'}}}` body.
  - path-injection: `getPage('../../admin')` → the `../` is percent-encoded (URL stays under `/rest/api/content/`).
  - `resolveShortLink`: per your Step-1 decision — at minimum test the GET-follow path returning a `response` whose `url` is `https://wiki.test/pages/viewpage.action?pageId=12345678` yields `{ pageId:'12345678', resolvedUrl: <that url> }`, then the tool's page fetch. If HEAD/manual is supported, also test the 3xx-Location fast path.
  - non-2xx → throws.
- [ ] **Step 3:** Implement `client.ts`. `ConfluenceClient` ctor stores `baseUrl` (trailing-slash-trimmed), the Basic `authHeader`, and `httpFetch`. Private `request(path, init?)` → `{baseUrl}/rest/api{path}` with the three headers merged. Methods return the SIMPLIFIED objects (`simplifyPage`/`simplifyComment`/`simplifyComments` from `./format.js`). `encodeURIComponent` every caller-supplied segment (`pageId`, `key`). Narrow all `unknown` with guards; no `as`. `resolveShortLink` uses raw `httpFetch(tinyUrl, {...})` (NOT `request()`), per Step 1.
- [ ] **Step 4:** Run tests → PASS. typecheck + full lint + knip (adjust ignores). Commit: `feat(mcp-confluence): Confluence client (Basic auth, short-link resolution)`.

## Task 5: Tool registration (`index.ts`)

**Files:** replace placeholder `plugins/mcp-confluence/index.ts`; extend `tests/plugins/mcp-confluence.test.ts`.

- [ ] **Step 1:** Write failing plugin tests (mirror the `mcp-sentry plugin` describe block): activate registers exactly the 5 tools; `confluence_get_page` with a mock httpFetch returns the simplified page; missing creds → `{ error:'not_configured', message:'Confluence is not configured' }`; rate-limited → `{ error:'rate_limited', retryAfterSec }`; httpFetch throws non-abort → `{ error:'confluence_error', message }`; AbortError → `{ error:'timeout', message }`. Run → FAIL.
- [ ] **Step 2:** Implement the factory (mirror `plugins/mcp-sentry/index.ts`): `activate` reads `providerRuntime.httpFetch`; `buildToolDefinitions(getHttpFetch)` (extracted to satisfy `max-lines-per-function`) returns the 5 tool defs. Each `execute`: rate-limit (actor = `chatUserId` || `storageContextId`) → read `base_url`/`username`/`password` from `runtimeContext.adminConfig.get(...)` at execution time → `not_configured` if any missing or `httpFetch` undefined → narrow `input` with `isRecord`+typed readers (no `as`) → `new ConfluenceClient({...})` → call method → return result. try/catch: `AbortError`→`timeout`, else `confluence_error`. Concise agent-facing `description` per tool.
- [ ] **Step 3:** Run tests → PASS; `bun test tests/plugins/` (discovery still green). typecheck + full lint + knip: REMOVE the now-obsolete `["files"]`/`["exports"]` ignores for `input-schema.ts`/`format.ts`/`client.ts` (reachable from index now); KEEP `plugins/mcp-confluence/index.ts": ["exports"]`. Commit: `feat(mcp-confluence): register 5 Confluence tools`.

## Task 6: README + verification + docs + gate

**Files:** create `plugins/mcp-confluence/README.md`, `tests/mcp-server/mcp-confluence-listing.test.ts`; edit `docs/architecture/coding-stack-overview.md`.

- [ ] **Step 1:** Write `README.md` (mirror `plugins/mcp-sentry/README.md`): purpose, 5 tools table, required admin config (`base_url`, `username`, `password` sensitive), Basic-auth note, `mcpResponseRedaction` (requires `mcp_redaction` or ineligible), and that `confluence_add_comment` is a write whose per-tool policy the operator should set to `ask`/`deny`.
- [ ] **Step 2:** Create `tests/mcp-server/mcp-confluence-listing.test.ts` mirroring `tests/mcp-server/mcp-sentry-listing.test.ts` exactly (discover from disk → registerDiscovered → approve → activate → `listPluginMcpTools('mcp-confluence')` resolves the 5 named tools each with an `inputSchema`; empties after deactivate). Run → PASS.
- [ ] **Step 3:** Update `docs/architecture/coding-stack-overview.md` — add `mcp-confluence` to the list of migrated first-party MCP plugins near the `mcp-sentry` mention.
- [ ] **Step 4:** Run `bun run check:full` → must be 12/12 green. Fix anything (full lint, knip, format markdown with `bunx oxfmt`). Commit: `feat(mcp-confluence): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** all 5 kiss confluence tools (get_page, get_page_by_title, get_comments, add_comment, resolve_short_link) → Tasks 2/4/5; Basic auth → Task 4; redaction via bridge (no plugin-side redactor) → manifest `mcpResponseRedaction:true` Task 1; simplify pipeline → Task 3; verification → Task 6.
- **Deviations from kiss (intentional, noted):** (a) tools return simplified OBJECTS, not kiss's plain-text `format-output.ts` rendering (papai has no 10k-line limit; the bridge `sizeGuard` handles size); (b) no per-server `validatedAnswer` call — the generic bridge redactor covers it; (c) `add_comment` returns the uniformly-redacted simplified comment rather than an unvalidated prefix + validated body.
- **Risks flagged:** `resolve_short_link` depends on `httpFetch` redirect/`response.url` behavior — Task 4 Step 1 verifies before implementing, with a defined fallback (GET-follow only) and a defer-if-impossible escape.
- **Placeholders:** none — concrete schema code + full endpoint specs + explicit test assertions provided; the index/client bodies reference the committed `mcp-sentry` files as the exact structural template (real code, not a placeholder).

## Follow-ups (carried from Plan 1, still open)

Per-plugin redaction-prompt override (context-scoped `redaction_prompt`); `mcp_redaction` settings-UI panel + unset; `abortSignal` threading in plugin HTTP clients (applies here too — the Confluence client won't thread `options.abortSignal` unless added). These remain deferred and are not blockers for this plan.

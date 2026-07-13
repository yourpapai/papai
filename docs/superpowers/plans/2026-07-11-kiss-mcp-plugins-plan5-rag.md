<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 5: `mcp-rag` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-rag` — a single agent-facing `rag_search` tool that queries a corporate RAG (retrieval) service by natural language, exposed as an MCP server for coding agents.

**Architecture:** A native papai plugin of the proven shape (`plugins/mcp-sentry/` etc.). `mcpServer: true` at `/mcp/plugin/mcp-rag`. **No redaction** (kiss rag uses plain size-guard only). Auth is a custom header **`X-Kontur-ApiKey`**. Config is admin-scoped. NEW wrinkle: the tool's **description is built at activation** from a base string + an optional operator `source_description` — so the plugin reads admin config in `activate()`, which means extending the copied `context.ts` facade to expose `adminConfig` at activation.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–4)

Read `plugins/mcp-sentry/` and `plugins/mcp-confluence/` first. Carry:

- Before EVERY commit run the FULL `bun run lint` and `bun run knip` (type-aware oxlint rules — `strict-boolean-expressions`, `require-unicode-regexp`, `no-misused-spread`, `no-conditional-in-test`, `no-unsafe-*` — only surface in the full run / CI). No lint-disables; narrow `unknown` with `isRecord` guards (no `as`); never test truthiness of `unknown`; `u` flag on regexes.
- SPDX header on every `.ts`; `.js` sibling imports; `encodeURIComponent` every caller-supplied URL path segment; encode query values.
- knip traverses only from entry points (`plugins/*/index.ts`): add a `["files"]` ignore per new-but-unconsumed plugin file, REMOVE them in the tool-registration task once `index.ts` reaches them (KEEP the `index.ts": ["exports"]` entry ignore).
- `bunx oxfmt` ONLY changed files (revert incidental CHANGELOG.md reformats).
- `check:full`'s `test` step is `bun test --parallel` and flakes under machine contention — if `test` fails but standalone `bun test` passes, it's an environment flake (`lsof -ti :9100`), not a code bug.

## The activation-time admin-config read (new in this plan)

kiss builds the `rag_search` description as `BASE + ' ' + RAG_SOURCE_DESCRIPTION` at server start. In papai the tool `description` is fixed at `registerTool` time (in `activate`). So `activate` must read the operator's `source_description` admin config. The copied `context.ts` `PluginContextLike` (activate facade) currently exposes only `log`/`registration`/`providerRuntime` — NOT `adminConfig`. Extend it:

- Add to `PluginContextLike`: `adminConfig?: { get(key: string): string | undefined }`.
- In `requirePluginContext`, thread it through: if `context['adminConfig']` is a record whose `get` is a function, include `adminConfig: { get: ... }` in the returned facade (mirror how `providerRuntime` is optionally threaded). The real papai `PluginContext` DOES expose `adminConfig.get` (verified: `docs/architecture/plugins.md` "Context facade" — `adminConfig.get`), so at runtime this is populated.
- `activate` reads `pluginContext.adminConfig?.get('source_description')` and builds the description. (Creds for the actual search are still read at EXECUTION time via `runtimeContext.adminConfig.get(...)` — the activate read is ONLY for the static description.)

## RAG API facts (source: kiss `mcp/rag-mcp/`)

- **Auth:** header `X-Kontur-ApiKey: <api_key>` (NOT Bearer). Plus `Accept: application/json`, `Content-Type: application/json`.
- **Base:** `{base_url}` (admin-scoped, required — no hardcoded default; kiss defaulted to a Kontur host but this port requires the operator to set it). Trailing-slash trimmed. `providerAllowedHostsFromConfig: ["base_url"]`.
- **Endpoint (per context code):** `POST {base_url}/v1/rag_contexts/{encodeURIComponent(contextCode)}/search-queries`, JSON body `{ query, sources }` (NOTE: `sources` is an array; `context_code` is in the URL path, NOT the body). Non-2xx → throw `RAG API <status> (context <code>): <body slice>`.
- **Multi-context:** `context_code` config may hold several codes separated by **`;`** (`parseContextCodes` splits on `;`, trims, drops empties — REQUIRED, must resolve to ≥1). Fire one POST per code IN PARALLEL, merge each response's `documents[]`, and collect per-context failures (rejected calls) rather than throwing. Use `Promise.allSettled`.
- **`sources`:** config `sources` splits on **`,`** (comma) — DIFFERENT separator from context codes. Optional; default `[]`. Same `sources` filter applied to every context query.

**Config keys (all admin-scoped):**

| key                  | required       | use                                                      |
| -------------------- | -------------- | -------------------------------------------------------- |
| `base_url`           | ✅             | RAG service base URL                                     |
| `api_key`            | ✅ (sensitive) | `X-Kontur-ApiKey` header                                 |
| `context_code`       | ✅             | `;`-separated context codes → parallel per-context POSTs |
| `sources`            | —              | `,`-separated source filter (body `sources`)             |
| `source_description` | —              | appended to the tool description at activation           |

**The 1 tool:**

| Tool         | Input                     | HTTP                                                                              | Output                                                        |
| ------------ | ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `rag_search` | `{ query: string (req) }` | per-context `POST /v1/rag_contexts/{enc(code)}/search-queries` `{query, sources}` | merged+deduped documents rendered as text (+ a failures note) |

**Response shape / formatting (port from kiss `format.ts`):**

- Upstream doc: `{ document_id?, title?, source?, source_type?, url? }`; only `documents[]` is consumed (ignore `id`/`status`/`log_id`/`langfuse_trace_id`).
- `dedupeDocuments(docs)`: dedupe key `document_id ?? url`; docs missing BOTH are kept as unique; order-preserving (first wins).
- `formatDocuments(docs)`: empty → `'No documents found.'`; else `` `Found N documents:\n\n` `` + numbered list, each: `` `${i+1}. ${title ?? '(untitled)'}\n   ${url ?? document_id ?? ''}` `` plus, only if `source`/`source_type` present, a line `` `   source: ${source ?? ''}/${source_type ?? ''}` ``.
- `formatFailures(failures)`: if any → `` `⚠️ Failed to query contexts: ${code} (${error}); ...` `` else `''`.
- Final tool return: `note !== '' ? formatDocuments(docs) + '\n\n' + note : formatDocuments(docs)` (a STRING — the bridge sends it; papai `sizeGuard` in the redactor path doesn't apply here since no redaction, but the plugin returns a plain string which the bridge passes through).
- (English strings — kiss's are Russian; translation is a deliberate, documented choice consistent with the other ports.)

## File structure

```
plugins/mcp-rag/
  plugin.json     # mcpServer:true (NO redaction), http, providerAllowedHostsFromConfig:["base_url"], 5 admin config keys
  context.ts      # mcp-sentry/context.ts copy + adminConfig on PluginContextLike (activate facade)
  input-schema.ts # 1 JSON-Schema object (rag_search)
  format.ts       # parseContextCodes(';') / parseSources(',') / dedupeDocuments / formatDocuments / formatFailures
  client.ts       # RagClient (X-Kontur-ApiKey, multi-context parallel search → { documents, failures })
  index.ts        # factory registering rag_search (description = BASE + source_description at activate)
  README.md
tests/plugins/mcp-rag.test.ts          # format + client + plugin blocks
tests/plugins/mcp-rag-schema.test.ts   # structural schema test
tests/mcp-server/mcp-rag-listing.test.ts
```

---

## Task 1: Manifest + context facade (with activate-time `adminConfig`)

**Files:** `plugins/mcp-rag/plugin.json`, `plugins/mcp-rag/context.ts`, placeholder `plugins/mcp-rag/index.ts`.

- [ ] **Step 1:** Copy `plugins/mcp-confluence/context.ts` → `plugins/mcp-rag/context.ts`. Extend the `PluginContextLike` type (the ACTIVATE facade — the one with `log`/`registration`/`providerRuntime`, NOT `PluginToolRuntimeContextLike`) to add `adminConfig?: { get(key: string): string | undefined }`. In `requirePluginContext`, after the `providerRuntime` handling, thread `adminConfig` through: read `context['adminConfig']`; if it's a record whose `['get']` is a function, include `adminConfig: { get: <that fn> }` in the returned object (mirror the optional `providerRuntime` spread pattern — keep it optional/absent otherwise). Do NOT remove the existing `PluginToolRuntimeContextLike.adminConfig` (used at execution time).
- [ ] **Step 2:** Create `plugins/mcp-rag/plugin.json`:

```json
{
  "id": "mcp-rag",
  "name": "RAG Search (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing corporate knowledge-base (RAG) search exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "contributes": { "tools": ["rag_search"], "promptFragments": [], "configKeys": [] },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "RAG Base URL", "required": true, "scope": "admin" },
    { "key": "api_key", "label": "RAG API Key", "required": true, "sensitive": true, "scope": "admin" },
    { "key": "context_code", "label": "RAG Context Code(s) (semicolon-separated)", "required": true, "scope": "admin" },
    { "key": "sources", "label": "RAG Sources filter (comma-separated)", "required": false, "scope": "admin" },
    {
      "key": "source_description",
      "label": "RAG Source Description (appended to tool description)",
      "required": false,
      "scope": "admin"
    }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] **Step 3:** Placeholder `index.ts` (license header, factory `requirePluginContext(ctx)` + logging, NO tools) — mirror the mc-confluence scaffold.
- [ ] **Step 4:** Add `"plugins/mcp-rag/index.ts": ["exports"]` to `knip.jsonc`. Validate manifest parses (throwaway `pluginManifestSchema.parse`, delete after). `bun test tests/plugins/discovery.test.ts` green. typecheck + FULL lint + knip clean.
- [ ] **Step 5:** Commit: `feat(mcp-rag): plugin manifest and context facade`.

## Task 2: Input schema

**Files:** `plugins/mcp-rag/input-schema.ts`, `tests/plugins/mcp-rag-schema.test.ts`.

- [ ] **Step 1:** Failing structural test: `ragSearchSchema.required` contains `'query'`; `additionalProperties === false`; `properties.query.type === 'string'`. Run → FAIL.
- [ ] **Step 2:** Create `input-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const ragSearchSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      description: 'Natural-language search query for the corporate knowledge base',
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const
```

- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (add `["files"]` ignore for `input-schema.ts` if flagged). Commit: `feat(mcp-rag): rag_search input schema`.

## Task 3: Formatting helpers (`format.ts`)

**Files:** `plugins/mcp-rag/format.ts`, `tests/plugins/mcp-rag.test.ts`.

- [ ] **Step 1:** Failing tests:
  - `parseContextCodes('a; b ;;c')` → `['a','b','c']`; `parseContextCodes('')` → `[]`.
  - `parseSources('x, y ,,z')` → `['x','y','z']`; `parseSources(undefined)` → `[]` (accept `string | undefined`).
  - `dedupeDocuments([{document_id:'1',title:'A'},{document_id:'1',title:'A2'},{url:'u',title:'B'},{title:'C'},{title:'D'}])` → keeps first `1`, the `u` doc, and BOTH keyless docs (`C`,`D` unique) → length 4, first-wins for `1`.
  - `formatDocuments([])` → `'No documents found.'`.
  - `formatDocuments([{title:'T',url:'http://x',source:'youtrack',source_type:'issue'}])` → contains `'Found 1 documents:'`, `'1. T'`, `'http://x'`, `'source: youtrack/issue'`.
  - a doc with neither source nor source_type → NO `source:` line; a doc missing title → `'(untitled)'`; missing url but has document_id → shows the document_id.
  - `formatFailures([])` → `''`; `formatFailures([{contextCode:'c1', error:'boom'}])` → contains `'c1'` and `'boom'`.
    Run → FAIL.
- [ ] **Step 2:** Implement `format.ts`. Types: `RagDocument = { document_id?: string; title?: string; source?: string; source_type?: string; url?: string }`; `RagFailure = { contextCode: string; error: string }`. `parseContextCodes(raw: string): string[]` splits `;`; `parseSources(raw: string | undefined): string[]` splits `,` (empty/undefined → `[]`). `dedupeDocuments(docs: RagDocument[]): RagDocument[]` — key `doc.document_id ?? doc.url`; if key is undefined keep unconditionally; else Set-based first-wins. `formatDocuments`/`formatFailures` per the spec. Narrow inputs safely; these operate on already-typed shapes (the client parses upstream JSON into `RagDocument[]` — see Task 4), so plain typed code is fine, but guard optional fields.
- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (ignore for `format.ts` if flagged). Commit: `feat(mcp-rag): result formatting + dedupe helpers`.

## Task 4: `RagClient`

**Files:** `plugins/mcp-rag/client.ts`, extend `tests/plugins/mcp-rag.test.ts`.

- [ ] **Step 1:** Failing client tests (mock httpFetch, capture calls). Construct `new RagClient({ baseUrl:'https://rag.test', apiKey:'k', contextCodes:['c1','c2'], sources:['s1'], httpFetch })`. Assert:
  - `search('hello')` fires TWO POSTs (one per context): URLs `https://rag.test/v1/rag_contexts/c1/search-queries` and `.../c2/search-queries`; each with header `X-Kontur-ApiKey:'k'`, `Content-Type:'application/json'`, method POST, body `JSON.stringify({ query:'hello', sources:['s1'] })`.
  - documents from both contexts are merged into `result.documents`; e.g. c1 → `{documents:[{document_id:'1'}]}`, c2 → `{documents:[{document_id:'2'}]}` ⇒ `result.documents` has both.
  - if c2's POST returns non-2xx (mock 500), `search` STILL resolves; `result.documents` = c1's docs; `result.failures` contains `{ contextCode:'c2', error: <string> }` (does NOT throw).
  - context-code path injection: a code `'../../x'` → URL `.../v1/rag_contexts/..%2F..%2Fx/search-queries` (encoded).
  - `result` shape is `{ documents: RagDocument[]; failures: RagFailure[] }`; documents parsed from each response's `.documents` (narrow with isRecord; non-array/absent → `[]`).
- [ ] **Step 2:** Implement `client.ts`. `RagClient` ctor `{ baseUrl, apiKey, contextCodes, sources, httpFetch }` (baseUrl trailing-slash trimmed). `async search(query): Promise<{ documents: RagDocument[]; failures: RagFailure[] }>`: `Promise.allSettled` over `contextCodes.map(code => this.searchOne(code, query))`; `searchOne` POSTs and returns `{ documents }`; on fulfilled → push docs; on rejected → push `{ contextCode, error: message }`. `searchOne(code, query)`: `httpFetch(`${baseUrl}/v1/rag_contexts/${encodeURIComponent(code)}/search-queries`, { method:'POST', headers:{ 'X-Kontur-ApiKey': apiKey, Accept:'application/json', 'Content-Type':'application/json' }, body: JSON.stringify({ query, sources }) })`; non-ok → throw `RAG API <status> (context <code>)`; else parse `.documents` via isRecord/Array guards into `RagDocument[]`. To keep the `contextCode` on a rejection, wrap each `searchOne` so the settled reason carries the code (e.g. `searchOne` catches and rethrows `Object.assign(err, {contextCode})`, or map results with the index → `contextCodes[i]`). Prefer: build results by iterating `allSettled` output with the index to recover `contextCodes[i]` for failures. No `as` on `unknown`.
- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (remove `format.ts` ignore now consumed; add `client.ts` `["files"]` ignore until Task 5 — both stay until `index.ts`). Commit: `feat(mcp-rag): RAG client (X-Kontur-ApiKey, multi-context)`.

## Task 5: Tool registration (`index.ts`) — dynamic description

**Files:** replace placeholder `plugins/mcp-rag/index.ts`; extend `tests/plugins/mcp-rag.test.ts`.

- [ ] **Step 1:** Failing plugin tests (mirror the mc-confluence plugin block; admin creds via `adminConfig.get`):
  - `activate` registers exactly 1 tool named `rag_search`; when the activate ctx's `adminConfig.get('source_description')` returns `'Covers Team X docs.'`, the registered tool's `description` ENDS WITH `'Covers Team X docs.'` (proves the dynamic append); when it returns undefined, the description equals the base string.
  - `rag_search` with mock httpFetch → returns the formatted text (contains `'Found'` or `'No documents found.'`); creds (`base_url`/`api_key`/`context_code`) read at EXECUTION via `runtimeContext.adminConfig.get`.
  - missing creds → `{ error:'not_configured', message:'RAG is not configured' }` (if `base_url`/`api_key`/`context_code` missing).
  - rate-limited → `{ error:'rate_limited', retryAfterSec }`.
  - httpFetch throws for ALL contexts → the tool still returns a formatted string that mentions the failure (NOT an unhandled throw) — OR `{ error:'rag_error', message }` if you choose to surface a hard error when there are zero documents AND all contexts failed; pick one and test it (recommend: return the formatted failures note as normal text, matching kiss).
    Run → FAIL.
- [ ] **Step 2:** Implement the factory. `activate`: read `providerRuntime.httpFetch`; build `description = BASE_TOOL_DESCRIPTION + (sourceDesc ? ' ' + sourceDesc : '')` where `sourceDesc = pluginContext.adminConfig?.get('source_description')?.trim()` (guard undefined/empty); `registerTool({ name:'rag_search', description, inputSchema: ragSearchSchema, execute })`. `execute`: rate-limit → read `base_url`/`api_key`/`context_code`/`sources` via `runtimeContext.adminConfig.get(...)` → `not_configured` if `base_url`/`api_key`/`context_code` missing or httpFetch undefined → `parseContextCodes(context_code)` (if empty → `not_configured`) + `parseSources(sources)` → narrow `input.query` (required string) → `new RagClient({ baseUrl, apiKey, contextCodes, sources, httpFetch })` → `const { documents, failures } = await client.search(query)` → `const deduped = dedupeDocuments(documents)` → `const note = formatFailures(failures)` → return `note !== '' ? formatDocuments(deduped) + '\n\n' + note : formatDocuments(deduped)` (a STRING). try/catch: `AbortError`→`{error:'timeout',message}`, ValidationError→`{error:'validation_error',message}`, else `{error:'rag_error',message}`. Define `BASE_TOOL_DESCRIPTION` as a module const (generic English, e.g. "Search a corporate knowledge base (RAG service) by natural-language query. Returns matching documents (title, link, source). Sources and context are fixed in the server config."). Extract `buildToolDefinition`/helpers if `activate` risks `max-lines-per-function`.
- [ ] **Step 3:** Test → PASS; `bun test tests/plugins/` green. typecheck + FULL lint + knip: REMOVE `input-schema.ts`/`format.ts`/`client.ts` `["files"]` ignores; KEEP `index.ts": ["exports"]`. Commit: `feat(mcp-rag): register rag_search tool (dynamic description)`.

## Task 6: README + verification + docs + gate

**Files:** `plugins/mcp-rag/README.md`, `tests/mcp-server/mcp-rag-listing.test.ts`, edit `docs/architecture/coding-stack-overview.md`.

- [ ] **Step 1:** README (mirror mc-confluence): purpose, the single `rag_search` tool, admin config table (`base_url`, `api_key` sensitive, `context_code` semicolon-separated, `sources` comma-separated optional, `source_description` optional), `X-Kontur-ApiKey` auth, multi-context behavior (parallel per-context, failures reported inline), NO redaction, and a note that the tool description is extended by `source_description` at activation.
- [ ] **Step 2:** `tests/mcp-server/mcp-rag-listing.test.ts` mirroring the mc-confluence listing test: discover → activate → `listPluginMcpTools('mcp-rag')` resolves the 1 named tool `rag_search` with an `inputSchema`; empties after deactivate. Run → PASS. (Note: activation reads `source_description` admin config; in the test harness it's unset, so the description is just the base — fine.)
- [ ] **Step 3:** Add `mcp-rag` to the migrated-plugins mention in `docs/architecture/coding-stack-overview.md` (single RAG search tool, X-Kontur-ApiKey, multi-context).
- [ ] **Step 4:** `bun run check:full` → 12/12 green (if `test` flakes, re-run standalone `bun test`; free port 9100). Commit: `feat(mcp-rag): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** the single `rag_search` tool; `X-Kontur-ApiKey` auth; multi-context parallel search + failure reporting (Task 4); dedupe/format (Task 3); dynamic description via activate-time admin config (context.ts extension, Task 1/5); verification (Task 6).
- **Deviations (documented):** (a) English output strings (kiss Russian); (b) `base_url` required (no hardcoded Kontur default); (c) result rendered as text like kiss (not structured JSON) — matches kiss's `formatDocuments`.
- **Risks:** (1) the `context.ts` activate-facade `adminConfig` extension is new — Task 1 must keep `requirePluginContext` backward-compatible (adminConfig optional/absent when the raw ctx lacks it) so the sentry/confluence-style copies are unaffected; the listing test + a unit test on the dynamic description verify it. (2) `parseContextCodes` uses `;`, `parseSources` uses `,` — do NOT swap. (3) failures must NOT throw — `search` returns `{documents, failures}`.
- **Placeholders:** none — schema, endpoints, body shape, formatting rules, and the description-assembly are all concrete; client/index reference the committed template.

## Follow-ups (this plan + carried)

- **`top_k`/result-count control** — kiss doesn't expose it; not ported.
- Carried: per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset, `abortSignal` threading in plugin clients, figma full-simplify + token pooling, teamcity config-envelope flattening, the dead `key==='key'` branch in `mcp-sentry/format.ts`.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 3: `mcp-figma` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-figma` — agent-facing Figma tools (read a file's structure, nodes, images, styles, components, comments) exposed as an MCP server for coding agents.

**Architecture:** A native papai plugin of the shape proven by `plugins/mcp-sentry/` and `plugins/mcp-confluence/`. `mcpServer: true` exposes tools at `/mcp/plugin/mcp-figma`. **No redaction** (`mcpResponseRedaction` unset — kiss figma does not redact; responses are public design metadata). Auth is the **`X-Figma-Token`** header. The Figma token is **context-scoped** (per-team), so it is read via `runtimeContext.contextConfig.get('token')` (not `adminConfig`) and declared in `contributes.configKeys`. Host is the fixed SaaS `api.figma.com`.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & process notes (from Plans 1–2)

Read `plugins/mcp-sentry/` and `plugins/mcp-confluence/` first — same shape. Carry these hard-won rules:

- Before EVERY commit run the FULL `bun run lint` and `bun run knip` (type-aware oxlint rules like `strict-boolean-expressions`, `require-unicode-regexp`, `no-misused-spread`, `no-conditional-in-test` only surface in the full run / CI). No lint-disables — fix the underlying issue (never test truthiness of an `unknown` in a conditional; add `u` to regexes; narrow `RequestInit['headers']` to `Record<string,string>` before spreading; hoist test-mock routing into a module-scope helper, not inline `if` in `test()`).
- SPDX header on every `.ts`. `.js` import extensions for sibling imports.
- `encodeURIComponent` every caller-supplied URL path segment; encode query values too.
- knip only traverses from entry points (`plugins/*/index.ts`) — a plugin file is "unused" until `index.ts` imports it. Add a `knip.jsonc` `["files"]` ignore per new-but-unconsumed file (mirroring the mc-confluence entries), and REMOVE those ignores in the tool-registration task once `index.ts` reaches them. Keep the `plugins/mcp-figma/index.ts": ["exports"]` entry ignore.
- Run `bunx oxfmt` ONLY on files you changed; if it reformats unrelated files (e.g. `CHANGELOG.md`), `git checkout -- <file>` before staging.
- `check:full`'s `test` step is `bun test --parallel` and can flake under machine contention (stray port-9100 servers, many background procs). If it fails, re-run standalone `bun test` — a clean standalone pass means the code is fine; hunt for stray processes rather than "fixing" a non-bug.

## The context-scoped-token difference (new in this plan)

Unlike sentry/confluence (admin-scoped creds via `adminConfig.get`), figma's token is **context-scoped**:

- Manifest: `contributes.configKeys: ["token"]` AND `configRequirements: [{ key:"token", scope:"context", sensitive:true, required:true }]`. (The schema refine `hasMatchingContextConfigKeys` REQUIRES every `contributes.configKeys` entry to have a matching context-scoped `configRequirements` entry — so both are needed. Verified.)
- `plugins/mcp-figma/context.ts` is the sentry/confluence copy PLUS a `contextConfig` field on the local `PluginToolRuntimeContextLike` type: `contextConfig: { get(key: string): string | undefined }` (the copied type only had `adminConfig` — add `contextConfig` so the tool `execute` can read the token type-safely). The runtime value is supplied by papai (`src/plugins/tool-runtime.ts` `buildRuntimeContextConfig` builds it for the bridge path — verified reachable from `callPluginMcpTool`).
- Tool `execute` reads the token via `runtimeContext.contextConfig.get('token')`. Unit tests mock `contextConfig: { get: () => 'tok' }` (no DB needed), exactly as sentry mocks `adminConfig`.

## Figma API facts (source: kiss `mcp/figma-mcp/`)

- **Auth:** header `X-Figma-Token: <token>` (NOT Bearer). `Accept: application/json`.
- **Base:** fixed `https://api.figma.com` (hardcode in the client; no `base_url` config). `providerAllowedHosts: ["api.figma.com"]` (static — NOT `providerAllowedHostsFromConfig`).
- **Request helper:** `httpFetch(`https://api.figma.com${path}`, { headers: { 'X-Figma-Token': token, Accept: 'application/json' } })`; non-2xx → throw `Figma API <status> for <path>`.
- **Single token** (papai simplification): kiss supports a comma-separated token pool with Fisher–Yates shuffle + 429 rotation/retry — DO NOT port that. Use the token string as-is, single request, no retry. (Documented deviation; a follow-up could add pooling.)

**The 7 tools:**

| Tool                    | Input                                                                                                                 | HTTP                                                                             | Simplify?                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| `figma_get_file`        | `{ fileKey: string (req) }`                                                                                           | `GET /v1/files/{enc(fileKey)}`                                                   | ✅ `simplifyFigmaResponse`  |
| `figma_get_file_nodes`  | `{ fileKey: string (req), ids: string (req) }`                                                                        | `GET /v1/files/{enc(fileKey)}/nodes?ids={enc,joined}`                            | ✅ `simplifyFigmaResponse`  |
| `figma_get_images`      | `{ fileKey: string (req), ids: string (req), format?: 'png'\|'svg'\|'pdf' (default png), scale?: number (png only) }` | `GET /v1/images/{enc(fileKey)}?ids={enc,joined}&format={format}[&scale={scale}]` | — pass-through `{ images }` |
| `figma_get_file_styles` | `{ fileKey: string (req) }`                                                                                           | `GET /v1/files/{enc(fileKey)}/styles` → `data.styles ?? []`                      | — pass-through              |
| `figma_get_style`       | `{ fileKey: string (req), styleKey: string (req) }`                                                                   | `GET /v1/files/{enc(fileKey)}/styles/{enc(styleKey)}`                            | — pass-through              |
| `figma_get_components`  | `{ fileKey: string (req) }`                                                                                           | `GET /v1/files/{enc(fileKey)}/components` → `data.components ?? []`              | — pass-through              |
| `figma_get_comments`    | `{ fileKey: string (req) }`                                                                                           | `GET /v1/files/{enc(fileKey)}/comments` → `data.comments ?? []`                  | — pass-through              |

**`ids` parsing** (get_file_nodes, get_images): `ids.split(/[,;]+/u).map(s => s.trim().replace(/^I/u, '')).filter(Boolean)` → then `.map(encodeURIComponent).join(',')` in the URL.

## Simplify — MODERATE port (documented deviation)

kiss's `simplify.ts` builds a compact node tree with a full CSS-layout-string extractor (`display:flex;justify-content;padding;gap`) and a `globalVars` text-style dedup table. **This plan ports a MODERATE version** — the structural + dimensional + text core — and OMITS the elaborate CSS-layout-string generation and the `globalVars` style-dedup (design-to-code niceties, not essential for agent consumption; heavy + risky to port under TDD). Flagged as a follow-up.

`simplifyFigmaResponse(apiResponse: unknown): { name: string; nodes: SimplifiedNode[] }`:

- `SimplifiedNode = { id: string; name: string; type: string; width?: number; height?: number; text?: string; textStyle?: { fontFamily?: string; fontSize?: number; fontWeight?: number }; layoutMode?: 'HORIZONTAL' | 'VERTICAL'; children?: SimplifiedNode[] }`.
- Determine root nodes (narrow with `isRecord`):
  - if `apiResponse.nodes` is a record (GetFileNodes shape `{ nodes: { <id>: { document } } }`) → take the FIRST entry's `.document` → `rawNodes = [document]` (kiss also only simplifies the first; keep parity).
  - else if `apiResponse.document` is a record (GetFile shape) → `rawNodes = document.children` (array, else `[]`).
  - `name = stringOr(apiResponse.name) ?? stringOr(document?.name) ?? ''`.
- `nodes = rawNodes.map(processNode).filter((n): n is SimplifiedNode => n !== null)`.
- `processNode(node: unknown): SimplifiedNode | null`:
  - if not `isRecord(node)` → null; if `node.visible === false` → null.
  - `result = { id: stringOr(node.id) ?? '', name: stringOr(node.name) ?? '', type: node.type === 'VECTOR' ? 'IMAGE-SVG' : (stringOr(node.type) ?? '') }`.
  - if `node.absoluteBoundingBox` is a record with numeric `width`/`height` → `result.width = round2(width)`, `result.height = round2(height)` (`round2(n) = Math.round(n*100)/100`).
  - if `result.type === 'IMAGE-SVG'`... no special handling beyond the type rename.
  - if `node.type === 'TEXT'`: `result.text = stringOr(node.characters)`; from `node.style` (if record) build `textStyle` with only the present numeric/string fields `fontFamily`/`fontSize`/`fontWeight` (omit undefined; omit `textStyle` entirely if empty).
  - if `node.layoutMode === 'HORIZONTAL' || === 'VERTICAL'` → `result.layoutMode = node.layoutMode`.
  - if `node.children` is an array → `const kids = children.map(processNode).filter(non-null)`; if `kids.length > 0` → `result.children = kids`.
  - return `result`.
- Use `isRecord`/`stringOr`/`numberOr` guards throughout — NO `as` on `unknown`. No async/`setImmediate` (kiss yielded every 100 nodes for huge trees; not needed — but guard against pathological depth is unnecessary for this port).

## File structure

```
plugins/mcp-figma/
  plugin.json     # mcpServer:true (NO mcpResponseRedaction), http, providerAllowedHosts:["api.figma.com"],
                  # configKeys:["token"], context-scoped token requirement
  context.ts      # mcp-sentry/context.ts copy + contextConfig on PluginToolRuntimeContextLike
  input-schema.ts # 7 JSON-Schema objects
  format.ts       # simplifyFigmaResponse + SimplifiedNode + parseIds helper
  client.ts       # FigmaClient (X-Figma-Token, 7 methods)
  index.ts        # factory registering 7 tools (reads token via contextConfig)
  README.md
tests/plugins/mcp-figma.test.ts          # simplify + client + plugin blocks
tests/plugins/mcp-figma-schema.test.ts   # structural schema tests
tests/mcp-server/mcp-figma-listing.test.ts
```

---

## Task 1: Manifest + context facade

**Files:** `plugins/mcp-figma/plugin.json`, `plugins/mcp-figma/context.ts`, placeholder `plugins/mcp-figma/index.ts`.

- [ ] **Step 1:** Copy `plugins/mcp-confluence/context.ts` → `plugins/mcp-figma/context.ts`, then ADD a `contextConfig` field to the `PluginToolRuntimeContextLike` type: `contextConfig: { get(key: string): string | undefined }`. (Leave `adminConfig` too — harmless.) Keep `requirePluginContext` unchanged.
- [ ] **Step 2:** Create `plugins/mcp-figma/plugin.json`:

```json
{
  "id": "mcp-figma",
  "name": "Figma (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing Figma file/node/style/component/comment tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "contributes": {
    "tools": [
      "figma_get_file",
      "figma_get_file_nodes",
      "figma_get_images",
      "figma_get_file_styles",
      "figma_get_style",
      "figma_get_components",
      "figma_get_comments"
    ],
    "promptFragments": [],
    "configKeys": ["token"]
  },
  "permissions": ["http"],
  "providerAllowedHosts": ["api.figma.com"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "token", "label": "Figma Personal Access Token", "required": true, "sensitive": true, "scope": "context" }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] **Step 3:** Placeholder `index.ts` (license header, factory calling `requirePluginContext(ctx)` + logging, NO tools) — mirror the mc-confluence scaffold.
- [ ] **Step 4:** Add `"plugins/mcp-figma/index.ts": ["exports"]` to `knip.jsonc`. Validate manifest parses via `pluginManifestSchema.parse(...)` (delete any throwaway). `bun test tests/plugins/discovery.test.ts` green. `bun run typecheck` + FULL `bun run lint` + `bun run knip` clean.
- [ ] **Step 5:** Commit: `feat(mcp-figma): plugin manifest and context facade`.

## Task 2: Input schemas

**Files:** `plugins/mcp-figma/input-schema.ts`, `tests/plugins/mcp-figma-schema.test.ts`.

- [ ] **Step 1:** Failing structural schema tests (mirror `mc-confluence-schema.test.ts`): all 7 required-field contracts; `figma_get_images` has optional `format` enum `['png','svg','pdf']` and optional `scale` number; `figma_get_file_nodes`/`figma_get_style` two required strings. Run → FAIL.
- [ ] **Step 2:** Create `input-schema.ts` — 7 `as const` JSON-Schema objects:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const fileKey = { type: 'string', minLength: 1, description: 'Figma file key (from the file URL)' } as const

export const figmaGetFileSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const

export const figmaGetFileNodesSchema = {
  type: 'object',
  properties: {
    fileKey,
    ids: { type: 'string', minLength: 1, description: 'Comma/;-separated node ids, e.g. "1:2,3:4"' },
  },
  required: ['fileKey', 'ids'],
  additionalProperties: false,
} as const

export const figmaGetImagesSchema = {
  type: 'object',
  properties: {
    fileKey,
    ids: { type: 'string', minLength: 1, description: 'Comma/;-separated node ids' },
    format: { type: 'string', enum: ['png', 'svg', 'pdf'], description: 'Image format (default png)' },
    scale: { type: 'number', minimum: 0.01, maximum: 4, description: 'Scale (png only)' },
  },
  required: ['fileKey', 'ids'],
  additionalProperties: false,
} as const

export const figmaGetFileStylesSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const

export const figmaGetStyleSchema = {
  type: 'object',
  properties: { fileKey, styleKey: { type: 'string', minLength: 1, description: 'Style key, e.g. "S:abc123"' } },
  required: ['fileKey', 'styleKey'],
  additionalProperties: false,
} as const

export const figmaGetComponentsSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const

export const figmaGetCommentsSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const
```

- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (add `["files"]` ignore for `input-schema.ts` if flagged). Commit: `feat(mcp-figma): tool input schemas`.

## Task 3: Simplify helpers (`format.ts`)

**Files:** `plugins/mcp-figma/format.ts`, extend `tests/plugins/mcp-figma.test.ts`.

- [ ] **Step 1:** Failing tests for `simplifyFigmaResponse` and `parseIds`:
  - GetFile shape `{ name:'Doc', document:{ children:[ { id:'1:1', name:'Frame', type:'FRAME', visible:true, absoluteBoundingBox:{ width:100.126, height:50 }, layoutMode:'VERTICAL', children:[ { id:'1:2', name:'Label', type:'TEXT', characters:'Hi', style:{ fontFamily:'Inter', fontSize:14, fontWeight:600 } }, { id:'1:3', name:'Hidden', type:'RECTANGLE', visible:false } ] } ] } }` → `{ name:'Doc', nodes:[ { id:'1:1', name:'Frame', type:'FRAME', width:100.13, height:50, layoutMode:'VERTICAL', children:[ { id:'1:2', name:'Label', type:'TEXT', text:'Hi', textStyle:{ fontFamily:'Inter', fontSize:14, fontWeight:600 } } ] } ] }` (hidden node dropped, width rounded to 2dp, no children key on the leaf).
  - GetFileNodes shape `{ nodes:{ '1:1':{ document:{ id:'1:1', name:'N', type:'VECTOR' } } } }` → `{ name:'', nodes:[ { id:'1:1', name:'N', type:'IMAGE-SVG' } ] }` (VECTOR renamed, first entry only).
  - non-record input → `{ name:'', nodes:[] }`.
  - `parseIds('I1:2; 3:4 ,,5:6')` → `['1:2','3:4','5:6']`.
    Run → FAIL.
- [ ] **Step 2:** Implement `format.ts` per the MODERATE simplify spec above + `export function parseIds(raw: string): string[]`. Use `isRecord`/`stringOr`/`numberOr` guards; no `as` on `unknown`; regexes carry the `u` flag. Keep `processNode` recursive (plain, synchronous).
- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (ignore for `format.ts` if flagged). Commit: `feat(mcp-figma): response simplify helpers`.

## Task 4: `FigmaClient`

**Files:** `plugins/mcp-figma/client.ts`, extend `tests/plugins/mcp-figma.test.ts`.

- [ ] **Step 1:** Failing client tests (mock httpFetch, capture URL + headers). Construct `new FigmaClient({ token:'tok', httpFetch })` (base is hardcoded `https://api.figma.com`). Assert:
  - `getFile('abc')` → `GET https://api.figma.com/v1/files/abc` with header `X-Figma-Token: 'tok'`, `Accept: 'application/json'`; returns `simplifyFigmaResponse(json)`.
  - `getFileNodes('abc','I1:2;3:4')` → URL `.../v1/files/abc/nodes?ids=1%3A2,3%3A4` (ids parsed + encodeURIComponent'd, joined by `,`); returns simplified.
  - `getImages('abc','1:2', 'png', 2)` → `.../v1/images/abc?ids=1%3A2&format=png&scale=2`; `getImages('abc','1:2','svg')` → NO `scale` param; returns raw `{ images }` passthrough.
  - `getFileStyles('abc')` → `.../v1/files/abc/styles`, returns `data.styles ?? []`.
  - `getStyle('abc','S:x')` → `.../v1/files/abc/styles/S%3Ax`.
  - `getComponents('abc')` → `.../v1/files/abc/components` → `data.components ?? []`.
  - `getComments('abc')` → `.../v1/files/abc/comments` → `data.comments ?? []`.
  - path injection: `getFile('../../admin')` → encoded (URL stays under `/v1/files/`).
  - non-2xx → throws.
- [ ] **Step 2:** Implement `client.ts`. `FigmaClient` ctor `{ token: string; httpFetch: HttpFetch; baseUrl?: string }` (default base `https://api.figma.com`, trailing-slash trimmed). Private `request(path)` with the two headers. `get_file`/`get_file_nodes` apply `simplifyFigmaResponse`; others return the thin unwrapped data. `encodeURIComponent` every segment; use `parseIds` from `./format.js`. Narrow `unknown` with guards. `getImages` appends `&scale=` only when `format === 'png' && scale !== undefined`.
- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (remove `format.ts` ignore now consumed by client; add `client.ts` `["files"]` ignore until Task 5). Commit: `feat(mcp-figma): Figma client (X-Figma-Token)`.

## Task 5: Tool registration (`index.ts`)

**Files:** replace placeholder `plugins/mcp-figma/index.ts`; extend `tests/plugins/mcp-figma.test.ts`.

- [ ] **Step 1:** Failing plugin tests (mirror the mc-confluence plugin block, but the fake runtime context provides `contextConfig: { get: (k) => k === 'token' ? 'tok' : undefined }` instead of adminConfig for creds): activate registers exactly 7 tools; `figma_get_file` with mock httpFetch returns simplified file; missing token (`contextConfig.get` → undefined) → `{ error:'not_configured', message:'Figma token is not configured' }`; rate-limited → `{ error:'rate_limited', retryAfterSec }`; httpFetch throws non-abort → `{ error:'figma_error', message }`; AbortError → `{ error:'timeout', message }`. Run → FAIL.
- [ ] **Step 2:** Implement the factory (mirror `plugins/mcp-confluence/index.ts`): `activate` reads `providerRuntime.httpFetch`; `buildToolDefinitions(getHttpFetch)` returns 7 tool defs. Each `execute`: rate-limit → read token via `runtimeContext.contextConfig.get('token')` → `not_configured` if missing or httpFetch undefined → narrow `input` (isRecord + typed readers; `format`/`scale` optional on get_images) → `new FigmaClient({ token, httpFetch })` → call → return result. try/catch: `AbortError`→`timeout`, `ValidationError`→`validation_error`, else `figma_error`. Concise descriptions. (No redaction — manifest doesn't set `mcpResponseRedaction`.)
- [ ] **Step 3:** Test → PASS; `bun test tests/plugins/` green. typecheck + FULL lint + knip: REMOVE the `input-schema.ts`/`format.ts`/`client.ts` `["files"]` ignores; KEEP `index.ts": ["exports"]`. Commit: `feat(mcp-figma): register 7 Figma tools`.

## Task 6: README + verification + docs + gate

**Files:** `plugins/mcp-figma/README.md`, `tests/mcp-server/mcp-figma-listing.test.ts`, edit `docs/architecture/coding-stack-overview.md`.

- [ ] **Step 1:** README (mirror mc-confluence): purpose, 7-tools table, the **context-scoped** `token` config (note: per-team, set via the settings UI Tools/plugin config for the context, sensitive), `X-Figma-Token` auth, `api.figma.com` host, NO redaction (public design metadata), and the moderate-simplify note (structure/dimensions/text kept; full CSS-layout extraction is a follow-up).
- [ ] **Step 2:** `tests/mcp-server/mcp-figma-listing.test.ts` mirroring the mc-confluence listing test: discover → activate → `listPluginMcpTools('mcp-figma')` resolves the 7 named tools with `inputSchema`; empties after deactivate. Run → PASS.
- [ ] **Step 3:** Add `mcp-figma` to the migrated-plugins mention in `docs/architecture/coding-stack-overview.md` (note: first CONTEXT-scoped-cred plugin, no redaction).
- [ ] **Step 4:** `bun run check:full` → 12/12 green (if `test` flakes, re-run standalone `bun test`; check for stray processes). Commit: `feat(mcp-figma): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** all 7 kiss figma tools; `X-Figma-Token` auth; context-scoped token via `contextConfig` (new path, verified reachable in the bridge); simplify for file/nodes; pass-through for the rest; verification in Task 6.
- **Deviations (intentional, documented):** (a) MODERATE simplify — omits kiss's CSS-layout-string extractor + `globalVars` style-dedup (follow-up); (b) single token, no comma-pool/429-rotation; (c) `utils.ts`/`stripNode` is dead code in kiss — not ported; (d) no redaction (matches kiss). All flagged in README + here.
- **Risks:** the context-scoped-config path is exercised for the first time — Task 1/5 verify via the `configKeys`+context-`configRequirements` manifest pairing and a `contextConfig`-mocked unit test; the listing test needs no creds. If discovery/activation rejects the context-scoped manifest, re-check `hasMatchingContextConfigKeys` (configKeys must equal the set of context-scoped requirement keys).
- **Placeholders:** none — concrete schemas, endpoints, and the full moderate-simplify algorithm are specified; client/index bodies reference the committed mc-confluence/mc-sentry files as the structural template.

## Follow-ups (this plan + carried)

- **Full figma simplify** (CSS-layout string extractor + text-style `globalVars` dedup) — deferred; the moderate port keeps structure/dimensions/text only.
- **Figma token pooling / 429 rotation** — deferred (single token).
- Carried from Plans 1–2: per-plugin redaction-prompt override, `mcp_redaction` settings-UI panel + unset, `abortSignal` threading in plugin HTTP clients, the dead `key==='key'` sanitizer branch in `mcp-sentry/format.ts`.

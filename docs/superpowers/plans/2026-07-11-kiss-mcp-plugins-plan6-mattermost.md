<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 6: `mcp-mattermost` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-mattermost` — agent-facing Mattermost tools (read a post, a thread, a channel's posts; create a post; download a text attachment) exposed as an MCP server for coding agents, with bridge-level response redaction.

**Architecture:** A native papai plugin of the proven shape. `mcpServer: true` at `/mcp/plugin/mcp-mattermost`; `mcpResponseRedaction: true` (Mattermost is one of kiss's redacting servers — chats are high-risk PII). Auth is `Authorization: Bearer <access_token>` against the Mattermost REST API v4 (`{base_url}/api/v4`). Admin-scoped creds. This is the most complex plugin so far: posts are **enriched** (user id → username, file ids → attachment metadata) via extra deduped fetches.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–5)

Read `plugins/mcp-sentry/` and `plugins/mcp-confluence/` first. Carry:

- Before EVERY commit run the FULL `bun run lint` and `bun run knip` (type-aware oxlint rules — `strict-boolean-expressions`, `require-unicode-regexp`, `no-misused-spread`, `no-conditional-in-test`, `no-negated-condition`, `no-unsafe-*` — only surface in the full run / CI). No lint-disables; narrow `unknown` with `isRecord` guards (no `as`); never test truthiness of `unknown`; `u` flag on regexes; test-mock routing at MODULE scope (not inline `if` in `test()`).
- SPDX header on every `.ts`; `.js` sibling imports; `encodeURIComponent` every caller-supplied URL path segment; encode query values.
- knip traverses only from entry points (`plugins/*/index.ts`): add a `["files"]` ignore per new-but-unconsumed plugin file, REMOVE them in the tool-registration task once `index.ts` reaches them (KEEP the `index.ts": ["exports"]` entry ignore).
- `bunx oxfmt` ONLY changed files (revert incidental CHANGELOG.md reformats). Leave the pre-existing untracked `docs/scenarios/` + `papai-nerv-local.tar` alone.
- `check:full`'s `test` step is `bun test --parallel` and flakes under machine contention — if `test` fails but standalone `bun test` passes, it's an environment flake (`lsof -ti :9100`), not a code bug.

## Mattermost API facts (source: kiss `mcp/mattermost-mcp/`, REST API v4)

- **Auth:** `Authorization: Bearer <access_token>`, `Accept: application/json`.
- **Base:** normalize `base_url`: `wss://`→`https://`, `ws://`→`http://`, strip trailing slashes; all calls go to `{base_url}/api/v4{path}`. Admin-scoped, `providerAllowedHostsFromConfig: ["base_url"]`.
- **Request helper** `request(path, init?)`: `httpFetch(`${baseUrl}/api/v4${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init?.headers } })`; non-2xx → throw `Mattermost API <status> for <path>`. (Narrow `RequestInit['headers']` to `Record<string,string>` before spreading — `no-misused-spread`.)
- **`extractPostId(linkOrId)`:** `linkOrId.match(/\/pl\/([a-zA-Z0-9]+)/u)?.[1] ?? linkOrId.trim()` (supports permalinks `.../pl/<id>`).

**The 5 tools:**

| Tool                             | Input                                                                                          | REST                                                                                    | Notes                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `mattermost_get_post`            | `{ linkOrId: string (req) }`                                                                   | `GET /posts/{enc(id)}` → enrich                                                         | id = extractPostId            |
| `mattermost_get_thread`          | `{ linkOrId: string (req) }`                                                                   | `GET /posts/{enc(id)}/thread` → `{posts,order}` → order→posts → enrich                  | returns array (thread order)  |
| `mattermost_get_channel_posts`   | `{ channelId: string (req), since?: string\|number, page?: int≥0, perPage?: int 1..200 }`      | `GET /channels/{enc(channelId)}/posts?…` → order→posts → sort by create_at asc → enrich | see paging below              |
| `mattermost_create_post`         | `{ channelId: string (req), message: string (req), rootId?: string, threadLinkOrId?: string }` | `POST /posts` body `{channel_id, message, root_id?}` → enrich                           | WRITE → operator policy `ask` |
| `mattermost_download_attachment` | `{ fileId: string (req) }`                                                                     | `GET /files/{enc(fileId)}/info`; if text+small `GET /files/{enc(fileId)}`               | text inline only; see below   |

**Channel-posts paging:** if `since` is provided → parse to epoch-ms (numeric/numeric-string pass through; else `Date.parse`, throw on NaN) and query `?since=<ms>` (no page/per_page). Else `page = page ?? 0`, `perPage = Math.min(perPage ?? 60, 200)`, query `?page=<n>&per_page=<n>`. Response `{ posts: Record<id,Post>, order: string[] }` → map `order`→posts, drop missing, **sort by `create_at` ascending**.

**Enrichment (the key complexity):**

- `shapePost(raw)`: pick only `{ id, message, user_id, channel_id, create_at, update_at, edit_at, root_id, file_ids }` from the raw post (drop `props`/`metadata`/`hashtags`/etc. — a light size simplification; documented).
- `enrichPosts(posts, userFetch, fileFetch)`: collect the UNIQUE `user_id`s and UNIQUE `file_ids` across all posts; fetch each ONCE in parallel — `GET /users/{enc(id)}` → `{ id, username, name }` (`name = [first_name,last_name].filter(Boolean).join(' ') || nickname || username`), `GET /files/{enc(id)}/info` → `{ id, name, size, mime_type, extension, create_at }`. Build id→user and id→fileInfo maps. Attach to each post: `post.user = userMap[user_id]` (if resolved), `post.attachments = (file_ids ?? []).map(id => fileMap[id]).filter(Boolean)`. Any per-id fetch error is SWALLOWED (that user/file just stays absent — never throws). Dedup keeps the fetch count small (few distinct users per thread).
- `enrichPost(post, …)` = `enrichPosts([post], …)[0]` (single-post convenience).

**`mattermost_download_attachment` — papai adaptation (documented deviation):** kiss saved files to qwen's shared tmp dir and returned a path. papai has NO shared filesystem with the sandboxed agent, so:

- `GET /files/{enc(fileId)}/info` → `info` (id, name, size, mime_type, extension, create_at).
- if `info.size > MAX_INLINE = 512_000` (bytes) → return `{ attachment: info, tooLarge: true }` (no download).
- else if `typeof info.mime_type === 'string' && info.mime_type.startsWith('text/')` → `GET /files/{enc(fileId)}` (header `Accept: '*/*'`) → `await res.text()` → return `{ attachment: info, text: <content> }` (the bridge redacts the whole return, covering the file text).
- else (binary) → return `{ attachment: info, isBinary: true, note: 'Binary attachment; content not inlined (no filesystem handoff in this MCP transport).' }` (no download).
  No filesystem writes, no base64. (kiss's separate in-place file redaction is unnecessary — papai's bridge redacts the whole tool response including inline `text`.)

**Redaction:** `mcpResponseRedaction: true`. The plugin returns plain data/objects; the bridge redactor scrubs every response before it reaches the agent (requires operator `mcp_redaction` config or the plugin is ineligible — the fail-closed eligibility from Plan 1). Do NOT call any redactor in the plugin.

## Config keys (all admin-scoped)

| key            | required       | use                                             |
| -------------- | -------------- | ----------------------------------------------- |
| `base_url`     | ✅             | Mattermost URL (normalized; `/api/v4` appended) |
| `access_token` | ✅ (sensitive) | `Authorization: Bearer`                         |

## File structure

```
plugins/mcp-mattermost/
  plugin.json     # mcpServer+mcpResponseRedaction, http, providerAllowedHostsFromConfig:["base_url"], admin base_url+access_token
  context.ts      # mcp-sentry/context.ts copy (adminConfig only)
  input-schema.ts # 5 JSON-Schema objects
  format.ts       # extractPostId / parseSince / normalizeBaseUrl / shapePost / mapOrderedPosts
  client.ts       # MattermostClient (Bearer, 5 ops + dedup enrichment + file handling)
  index.ts        # factory registering 5 tools
  README.md
tests/plugins/mcp-mattermost.test.ts          # format + client + plugin blocks
tests/plugins/mcp-mattermost-schema.test.ts   # structural schema tests
tests/mcp-server/mcp-mattermost-listing.test.ts
```

---

## Task 1: Manifest + context facade

- [ ] Copy `plugins/mcp-confluence/context.ts` → `plugins/mcp-mattermost/context.ts` VERBATIM (admin-scoped — `adminConfig`-only Like type is correct).
- [ ] Create `plugins/mcp-mattermost/plugin.json`:

```json
{
  "id": "mcp-mattermost",
  "name": "Mattermost (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing Mattermost read/post tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "mcpResponseRedaction": true,
  "contributes": {
    "tools": [
      "mattermost_get_post",
      "mattermost_get_thread",
      "mattermost_get_channel_posts",
      "mattermost_create_post",
      "mattermost_download_attachment"
    ],
    "promptFragments": [],
    "configKeys": []
  },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "Mattermost URL", "required": true, "scope": "admin" },
    { "key": "access_token", "label": "Mattermost Access Token", "required": true, "sensitive": true, "scope": "admin" }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] Placeholder `index.ts` (license header, factory + logging, NO tools). Add `"plugins/mcp-mattermost/index.ts": ["exports"]` to `knip.jsonc`. Validate manifest parses (throwaway, delete). `bun test tests/plugins/discovery.test.ts` green; typecheck + FULL lint + knip clean. Commit: `feat(mcp-mattermost): plugin manifest and context facade`.

## Task 2: Input schemas

- [ ] Failing structural schema tests (`tests/plugins/mcp-mattermost-schema.test.ts`): get_post/get_thread → required `linkOrId`; get_channel_posts → required `channelId`, optional `since`/`page`/`perPage` (assert `properties.perPage.type === 'integer'` etc.); create_post → required `channelId`+`message`, optional `rootId`/`threadLinkOrId`; download_attachment → required `fileId`. Run → FAIL.
- [ ] Create `plugins/mcp-mattermost/input-schema.ts` (5 `as const` objects):
  - `mattermostGetPostSchema` / `mattermostGetThreadSchema`: props `{ linkOrId: {type:'string',minLength:1,description:'Post permalink or id'} }`, required `['linkOrId']`.
  - `mattermostGetChannelPostsSchema`: props `{ channelId:{type:'string',minLength:1}, since:{type:['string','number'],description:'ISO string or epoch-ms'}, page:{type:'integer',minimum:0}, perPage:{type:'integer',minimum:1,maximum:200} }`, required `['channelId']`. (Note `type:['string','number']` union for `since`.)
  - `mattermostCreatePostSchema`: props `{ channelId:{type:'string',minLength:1}, message:{type:'string',minLength:1}, rootId:{type:'string'}, threadLinkOrId:{type:'string'} }`, required `['channelId','message']`.
  - `mattermostDownloadAttachmentSchema`: props `{ fileId:{type:'string',minLength:1} }`, required `['fileId']`.
    All `additionalProperties:false`, `as const`.
- [ ] Test → PASS; typecheck + FULL lint + knip (ignore for `input-schema.ts` if flagged). Commit: `feat(mcp-mattermost): tool input schemas`.

## Task 3: Pure helpers (`format.ts`)

**No fetches here** — pure functions only. `tests/plugins/mcp-mattermost.test.ts` (`describe('mcp-mattermost format', …)`).

- [ ] Failing tests then implement:
  - `normalizeBaseUrl('wss://mm.x/')` → `'https://mm.x'`; `'ws://mm.x'` → `'http://mm.x'`; `'https://mm.x///'` → `'https://mm.x'`.
  - `extractPostId('https://mm.x/_redirect/pl/AbC123')` → `'AbC123'`; `extractPostId('  bareId ')` → `'bareId'`; `extractPostId('https://mm.x/team/chan/pl/XY9')` → `'XY9'`.
  - `parseSince(1700000000000)` → `1700000000000`; `parseSince('1700000000000')` → `1700000000000`; `parseSince('2023-01-01T00:00:00Z')` → the epoch-ms of that date; `parseSince('not-a-date')` → throws; `parseSince(undefined)` → `undefined`.
  - `shapePost({ id:'p1', message:'hi', user_id:'u1', channel_id:'c1', create_at:5, update_at:6, edit_at:0, root_id:'', file_ids:['f1'], props:{x:1}, metadata:{y:2} })` → `{ id:'p1', message:'hi', user_id:'u1', channel_id:'c1', create_at:5, update_at:6, edit_at:0, root_id:'', file_ids:['f1'] }` (props/metadata dropped; missing fields omitted).
  - `mapOrderedPosts({ posts:{ p1:{id:'p1'}, p2:{id:'p2'} }, order:['p2','p1','pX'] })` → `[{id:'p2'},{id:'p1'}]` (order applied, missing `pX` dropped; each passed through `shapePost`). Guard non-record input → `[]`.
- [ ] Implement `format.ts`: `normalizeBaseUrl`, `extractPostId`, `parseSince(v: string|number|undefined): number|undefined`, `shapePost(raw: unknown): ShapedPost` (isRecord guard; pick fields with `stringOr`/`numberOr`/`stringArrayOr`), `mapOrderedPosts(raw: unknown): ShapedPost[]`. Export a `ShapedPost` type (all fields optional except none required; enrichment adds `user?`/`attachments?` later — include those optional fields on the type). No `as` on `unknown`; regexes `u` flag.
- [ ] Test → PASS; typecheck + FULL lint + knip (ignore if flagged). Commit: `feat(mcp-mattermost): pure link/paging/post-shaping helpers`.

## Task 4: `MattermostClient` (with enrichment)

**Files:** `plugins/mcp-mattermost/client.ts`, extend `tests/plugins/mcp-mattermost.test.ts`.

- [ ] Failing client tests (mock httpFetch with a MODULE-scope URL router; capture calls). Construct `{ baseUrl:'https://mm.test', token:'tok', httpFetch }`. Assert:
  - `getPost('https://mm.test/pl/P1')` → first call `GET https://mm.test/api/v4/posts/P1` (id extracted from permalink) with `Authorization: 'Bearer tok'`; then an ENRICH call `GET .../api/v4/users/{user_id}` for the post's user; result post has `user:{id,username,name}` attached and is shaped (no `props`).
  - a post with `file_ids:['F1']` → an enrich call `GET .../api/v4/files/F1/info`; result `attachments:[{id:'F1',name,…}]`.
  - enrichment failure is swallowed: if the `users/{id}` call 404s, `getPost` still resolves with the post but no `user` field (no throw).
  - `getThread('P1')` → `GET .../posts/P1/thread`; a `{posts:{a:{id:'a',user_id:'u1'},b:{id:'b',user_id:'u1'}},order:['b','a']}` → returns `[{id:'b',…},{id:'a',…}]` (order applied) and the SAME user `u1` is fetched ONCE (dedup — assert only ONE `users/u1` call).
  - `getChannelPosts('c1',{ perPage: 300 })` → URL `.../channels/c1/posts?page=0&per_page=200` (perPage capped to 200); with `{ since: '2023-01-01T00:00:00Z' }` → URL `.../channels/c1/posts?since=<epoch-ms>` (no page/per_page). Posts sorted by `create_at` ascending.
  - `createPost({channelId:'c1',message:'hi',rootId:'r1'})` → `POST .../posts` with `Content-Type: application/json`, body `{channel_id:'c1',message:'hi',root_id:'r1'}`; result enriched. With `threadLinkOrId:'https://mm.test/pl/R2'` and no `rootId` → body `root_id:'R2'`.
  - `downloadAttachment('F1')`: info `{id:'F1',size:100,mime_type:'text/plain',name:'a.txt'}` → then `GET .../files/F1` (Accept `*/*`) returns text `'hello'` → result `{attachment:{…},text:'hello'}`. info with `size: 999999` → `{attachment,tooLarge:true}` (NO file GET). info `mime_type:'image/png'` small → `{attachment,isBinary:true,note:…}` (NO file GET).
  - path injection: `getPost('../../admin')` → id `'../../admin'` percent-encoded in the URL (stays under `/api/v4/posts/`).
  - non-2xx on the primary call (mock 500 on `getPost`'s post fetch) → throws (enrichment failures don't, but the PRIMARY fetch does).
    Run → FAIL, implement, → PASS.
- [ ] Implement `client.ts`. `MattermostClient` ctor `{ baseUrl, token, httpFetch }` → `normalizeBaseUrl`. Private `request(path, init?)`. Private `getJson(path)` → parse unknown. Methods `getPost`/`getThread`/`getChannelPosts`/`createPost`/`downloadAttachment` per the spec + a private `enrichPosts(posts: ShapedPost[]): Promise<ShapedPost[]>` (dedup unique user_ids/file_ids, parallel fetch each once via `Promise.all` over the unique arrays, swallow per-id errors with try/catch, build maps, attach). `encodeURIComponent` every path segment. Return `ShapedPost`/objects (unknown-ish) — keep types honest without `as`. For `downloadAttachment`, `MAX_INLINE = 512_000`.
- [ ] Test → PASS; typecheck + FULL lint + knip (both `format.ts` + `client.ts` stay `["files"]`-ignored until Task 5). Commit: `feat(mcp-mattermost): Mattermost REST client with post enrichment`.

## Task 5: Tool registration (`index.ts`)

- [ ] Failing plugin tests (mirror mc-confluence; admin creds via `adminConfig.get('base_url')`/`get('access_token')`): activate registers exactly the 5 tools; `mattermost_get_post` with mock httpFetch → returns the enriched post; missing creds → `{error:'not_configured', message:'Mattermost is not configured'}`; rate-limited → `{error:'rate_limited', retryAfterSec}`; httpFetch throws non-abort on the primary call → `{error:'mattermost_error', message}`. Run → FAIL.
- [ ] Implement the factory (mirror `plugins/mcp-confluence/index.ts`): `buildToolDefinitions(getHttpFetch)`; each `execute`: rate-limit → read `base_url`/`access_token` via `runtimeContext.adminConfig.get` → `not_configured` if missing or httpFetch undefined → narrow `input` (per-tool: required strings + optional `since`/`page`/`perPage`/`rootId`/`threadLinkOrId`; use `readRequiredString`/`readOptionalString`/`readOptionalNumber` and a `since` reader that accepts string|number) → `new MattermostClient(...)` → call → return result. try/catch: `AbortError`→`timeout`, `ValidationError`→`validation_error`, else `mattermost_error`. Concise descriptions; note `mattermost_create_post` is a WRITE. NO redaction here (bridge does it).
- [ ] Test → PASS; `bun test tests/plugins/` green; typecheck + FULL lint + knip: REMOVE `input-schema.ts`/`format.ts`/`client.ts` ignores; KEEP `index.ts": ["exports"]`. Commit: `feat(mcp-mattermost): register 5 Mattermost tools`.

## Task 6: README + verification + docs + gate

- [ ] README (mirror mc-confluence): purpose, 5-tools table, admin config (`base_url`, `access_token` sensitive), Bearer + `/api/v4`, enrichment note (user/attachment resolution), `mcpResponseRedaction` (requires `mcp_redaction` or ineligible), `mattermost_create_post` is a WRITE (operator sets `ask`/`deny`), and the `download_attachment` adaptation (text inline only; binary/large → metadata note; no filesystem handoff).
- [ ] `tests/mcp-server/mcp-mattermost-listing.test.ts` mirroring the mc-confluence listing test: 5 named tools with `inputSchema`; empties after deactivate. Run → PASS.
- [ ] Add `mcp-mattermost` to `docs/architecture/coding-stack-overview.md` migrated-plugins mention (5 tools, Bearer, redacted, enrichment).
- [ ] `bun run check:full` → 12/12 green (flake caveat: standalone `bun test`, free port 9100). Commit: `feat(mcp-mattermost): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** all 5 kiss mattermost tools; Bearer + `/api/v4`; permalink extraction; channel paging (since vs page); post enrichment (deduped user/file resolution); create (write); attachment download adapted to papai; bridge redaction (`mcpResponseRedaction:true`); verification (Task 6).
- **Deviations (documented):** (a) `download_attachment` returns text inline / binary-metadata note instead of writing to a shared filesystem (papai has no FS handoff to the sandbox agent) and drops the kiss `linkOrId` path param (only `fileId` needed); (b) `shapePost` drops noisy raw fields (`props`/`metadata`/…) — a light size simplification; (c) redaction via the generic bridge (not per-server `validatedAnswer`); (d) English strings.
- **Risks:** enrichment is the main complexity — Task 4 must test the DEDUP (one fetch per unique user across a thread) and the SWALLOWED enrichment errors (primary post still returned). The `download_attachment` branch logic (tooLarge / text-inline / binary) must be tested for all three outcomes.
- **Placeholders:** none — endpoints, paging, enrichment algorithm, and download branches are all concrete; client/index reference the committed template.

## Follow-ups (this plan + carried)

- **Binary attachment delivery** — papai currently returns only text inline; a future mechanism could stage binaries into the sandbox (out of scope; needs magi/geofront support).
- **Attachment redaction parity** — kiss redacted file text in-place before the metadata dump; papai relies on the single bridge redaction pass over the whole response (equivalent for inline text).
- Carried: per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset, `abortSignal` threading in plugin clients, figma full-simplify + token pooling, teamcity config-envelope flattening, the dead `key==='key'` branch in `mcp-sentry/format.ts`.

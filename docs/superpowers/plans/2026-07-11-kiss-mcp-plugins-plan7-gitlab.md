<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 7: `mcp-gitlab` (read-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-gitlab` — agent-facing **read-only** GitLab tools (repository tree, file content, MR info, MR list, job + log) exposed as an MCP server for coding agents. Write tools (post comment, create discussion, update/set MR state) are deferred — they overlap magi's forge-write domain (per the design spec).

**Architecture:** A native papai plugin of the proven shape (`plugins/mcp-sentry/` etc.). `mcpServer: true` at `/mcp/plugin/mcp-gitlab`. **No redaction** (kiss gitlab uses plain size-guard only). Auth is the **`PRIVATE-TOKEN`** header (NOT Bearer) against GitLab REST API v4 (`{base_url}/api/v4`). Admin-scoped creds. Reimplemented on plain `providerRuntime.httpFetch` (kiss used `@gitbeaker/rest`, which does its own I/O and would bypass the allowlist).

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–6)

Read `plugins/mcp-sentry/` and `plugins/mcp-confluence/` first. Carry:

- Before EVERY commit run the FULL `bun run lint` and `bun run knip` (type-aware oxlint rules — `strict-boolean-expressions`, `require-unicode-regexp`, `no-misused-spread`, `no-conditional-in-test`, `no-negated-condition`, `no-unsafe-*` — only surface in the full run / CI). No lint-disables; narrow `unknown` with `isRecord` guards (no `as`); never test truthiness of `unknown`; `u` on regexes; test-mock routing at MODULE scope (not inline `if` in `test()`).
- SPDX header on every `.ts`; `.js` sibling imports; `encodeURIComponent` every caller-supplied URL path segment; encode query values.
- knip traverses only from entry points (`plugins/*/index.ts`): add a `["files"]` ignore per new-but-unconsumed plugin file, REMOVE them in the tool-registration task once `index.ts` reaches them (KEEP the `index.ts": ["exports"]` entry ignore).
- `bunx oxfmt` ONLY changed files (revert incidental CHANGELOG.md reformats). Leave the pre-existing untracked `docs/scenarios/` (+ any `papai-nerv-local.tar`) alone.
- `check:full`'s `test` step is `bun test --parallel` and flakes under machine contention — if `test` fails but standalone `bun test` passes, it's an environment flake (`lsof -ti :9100`), not a code bug.

## GitLab API facts (source: kiss `mcp/gitlab-mcp/` + gitbeaker REST v4)

- **Auth:** header `PRIVATE-TOKEN: <token>` (NOT `Authorization: Bearer`). Plus `Accept: application/json`.
- **Base:** `{base_url}/api/v4` (base_url trailing-slash trimmed; admin-scoped, self-hosted → `providerAllowedHostsFromConfig: ["base_url"]`).
- **Project id:** always the `namespace/project` STRING path, URL-encoded whole (`encodeURIComponent('talk/vcs/kiss')` → `talk%2Fvcs%2Fkiss`). Same for file paths.
- **Request helper** `request(path): Promise<Response>` (return the raw `Response` so callers can read pagination headers): `httpFetch(`${baseUrl}/api/v4${path}`, { headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' } })`; caller checks `res.ok`, else throw `GitLab API <status> for <path>`.

**The 5 read tools:**

| Tool                         | Input                                                                                                                                                                                                                        | REST v4                                                                                           | Result                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `gitlab_get_repository_tree` | `{ projectPath: string (req), path?: string, ref?: string, recursive?: boolean }`                                                                                                                                            | `GET /projects/{enc(projectPath)}/repository/tree?path=&ref=&recursive=&per_page=100`             | array of `{ id, name, type, path, mode }`           |
| `gitlab_get_file_content`    | `{ projectPath: string (req), filePath: string (req), ref?: string }`                                                                                                                                                        | `GET /projects/{enc(projectPath)}/repository/files/{enc(filePath)}/raw?ref=<ref\|HEAD>`           | raw text (truncated at 1 MB with a banner)          |
| `gitlab_get_mr_info`         | `{ projectPath: string (req), mrIid: string (req) }`                                                                                                                                                                         | `GET /projects/{enc(projectPath)}/merge_requests/{enc(mrIid)}`                                    | shaped MR object                                    |
| `gitlab_get_mrs`             | `{ projectPath: string (req), state?: 'opened'\|'closed'\|'merged'\|'all', search?, labels?, sourceBranch?, targetBranch?, orderBy?: 'created_at'\|'updated_at', sort?: 'asc'\|'desc', perPage?: int 1..100, page?: int≥1 }` | `GET /projects/{enc(projectPath)}/merge_requests?…`                                               | `{ items: MR[], total, totalPages, page, perPage }` |
| `gitlab_get_job`             | `{ projectPath: string (req), jobId: string (req) }`                                                                                                                                                                         | `GET /projects/{enc(projectPath)}/jobs/{enc(jobId)}` + `GET …/jobs/{enc(jobId)}/trace` (parallel) | shaped job object incl. `log` (truncated at 1 MB)   |

**Shaping (into `format.ts`, pure functions over `unknown`):**

- `shapeTreeEntry(raw)` → `{ id?, name?, type?, path?, mode? }` (strings via `stringOr`).
- `shapeMr(raw)` → `{ title?, description?, state?, web_url?, source_branch?, target_branch?, author?, assignee?, reviewers?, labels? }` where `author`/`assignee` = `{ id?, name?, username? }` (shaped), `reviewers` = array of same, `labels` = string[] (filter to strings). (GitLab MR JSON is snake_case: `web_url`, `source_branch`, `target_branch` — keep snake_case; do NOT camelize.)
- `shapeJob(raw, log, logTruncated)` → `{ id?, name?, status?, stage?, web_url?, ref?, created_at?, started_at?, finished_at?, duration?, queued_duration?, log, logTruncated }` (identity/status/timing fields via `stringOr`/`numberOr`; `log` is the (truncated) trace string).
- `truncateText(text, maxBytes = 1_000_000)`: if `Buffer.byteLength(text, 'utf8') <= maxBytes` → `{ text, truncated: false }`; else slice by CHARACTERS to a safe length ≤ maxBytes bytes (simple approach: `text.slice(0, maxBytes)` is acceptable — JS chars ≥ 1 byte so the byte length only shrinks; return `{ text: sliced, truncated: true }`). (kiss used a byte-exact UTF-8 backoff; a char-slice that stays UNDER the byte cap is a fine, simpler equivalent — documented.)

**Documented deviations from kiss** (all intentional, noted in README + here):

1. **Single-page pagination only** for `gitlab_get_mrs` (page/perPage; read `x-total`/`x-total-pages`/`x-page`/`x-per-page` response headers). kiss's `all=true` Link-header auto-pagination is NOT ported — the agent paginates via the `page` param. Same for the tree (single request, `per_page=100`; very large trees may be capped — scope with `path`/`recursive`).
2. **`gitlab_get_job` returns a structured object** (with a `log` field) rather than kiss's custom `[key]: value` line format.
3. **No `jobUrl` convenience** — `gitlab_get_job` requires `projectPath` + `jobId` (kiss also accepted a full job URL and parsed it; deferred).
4. **char-slice truncation** (see `truncateText`) rather than kiss's byte-exact UTF-8 backoff (equivalent, stays under the cap).
5. Write tools (comment/discussion/update/set-state) are **out of scope** (magi's domain).

## Config keys (all admin-scoped)

| key        | required       | use                                                      |
| ---------- | -------------- | -------------------------------------------------------- |
| `base_url` | ✅             | GitLab base URL (`/api/v4` appended)                     |
| `token`    | ✅ (sensitive) | `PRIVATE-TOKEN` header (scopes: `api`/`read_repository`) |

## File structure

```
plugins/mcp-gitlab/
  plugin.json     # mcpServer:true (NO redaction), http, providerAllowedHostsFromConfig:["base_url"], admin base_url+token
  context.ts      # mcp-sentry/context.ts copy (adminConfig only)
  input-schema.ts # 5 JSON-Schema objects
  format.ts       # shapeTreeEntry / shapeMr / shapeUser / shapeJob / truncateText / buildMrQuery
  client.ts       # GitLabClient (PRIVATE-TOKEN, 5 read methods)
  index.ts        # factory registering 5 tools
  README.md
tests/plugins/mcp-gitlab.test.ts          # format + client + plugin blocks
tests/plugins/mcp-gitlab-schema.test.ts   # structural schema tests
tests/mcp-server/mcp-gitlab-listing.test.ts
```

---

## Task 1: Manifest + context facade

- [ ] Copy `plugins/mcp-confluence/context.ts` → `plugins/mcp-gitlab/context.ts` VERBATIM (admin-scoped).
- [ ] Create `plugins/mcp-gitlab/plugin.json`:

```json
{
  "id": "mcp-gitlab",
  "name": "GitLab (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing read-only GitLab (repo/MR/job) tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "contributes": {
    "tools": [
      "gitlab_get_repository_tree",
      "gitlab_get_file_content",
      "gitlab_get_mr_info",
      "gitlab_get_mrs",
      "gitlab_get_job"
    ],
    "promptFragments": [],
    "configKeys": []
  },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "GitLab Base URL", "required": true, "scope": "admin" },
    { "key": "token", "label": "GitLab Token (PRIVATE-TOKEN)", "required": true, "sensitive": true, "scope": "admin" }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] Placeholder `index.ts` (license header, factory + logging, NO tools). Add `"plugins/mcp-gitlab/index.ts": ["exports"]` to `knip.jsonc`. Validate manifest parses (throwaway, delete). `bun test tests/plugins/discovery.test.ts` green; typecheck + FULL lint + knip clean. Commit: `feat(mcp-gitlab): plugin manifest and context facade`.

## Task 2: Input schemas

- [ ] Failing structural schema tests: tree → required `projectPath`, optional `path`/`ref`/`recursive`(boolean); file_content → required `projectPath`+`filePath`; mr_info → required `projectPath`+`mrIid`; get_mrs → required `projectPath`, `state` enum `['opened','closed','merged','all']`, `orderBy` enum `['created_at','updated_at']`, `sort` enum `['asc','desc']`, `perPage` integer max 100; job → required `projectPath`+`jobId`. Run → FAIL.
- [ ] Create `plugins/mcp-gitlab/input-schema.ts` (5 `as const` objects) — a shared `const projectPath = { type:'string', minLength:1, description:'Project path, e.g. "group/project"' } as const`:
  - `gitlabGetRepositoryTreeSchema`: props `{ projectPath, path:{type:'string'}, ref:{type:'string'}, recursive:{type:'boolean'} }`, required `['projectPath']`.
  - `gitlabGetFileContentSchema`: props `{ projectPath, filePath:{type:'string',minLength:1}, ref:{type:'string'} }`, required `['projectPath','filePath']`.
  - `gitlabGetMrInfoSchema`: props `{ projectPath, mrIid:{type:'string',minLength:1,description:'MR iid, e.g. "42"'} }`, required `['projectPath','mrIid']`.
  - `gitlabGetMrsSchema`: props `{ projectPath, state:{type:'string',enum:['opened','closed','merged','all']}, search:{type:'string'}, labels:{type:'string',description:'comma-separated'}, sourceBranch:{type:'string'}, targetBranch:{type:'string'}, orderBy:{type:'string',enum:['created_at','updated_at']}, sort:{type:'string',enum:['asc','desc']}, perPage:{type:'integer',minimum:1,maximum:100}, page:{type:'integer',minimum:1} }`, required `['projectPath']`.
  - `gitlabGetJobSchema`: props `{ projectPath, jobId:{type:'string',minLength:1,description:'Numeric job id'} }`, required `['projectPath','jobId']`.
    All `additionalProperties:false`, `as const`.
- [ ] Test → PASS; typecheck + FULL lint + knip (ignore for `input-schema.ts` if flagged). Commit: `feat(mcp-gitlab): tool input schemas`.

## Task 3: Shaping helpers (`format.ts`)

**Pure functions only.** `tests/plugins/mcp-gitlab.test.ts` (`describe('mcp-gitlab format', …)`).

- [ ] Failing tests then implement:
  - `shapeUser({id:1,name:'A',username:'a',extra:'x'})` → `{id:1,name:'A',username:'a'}` (id numberOr, name/username stringOr, extra dropped); non-record → `undefined`.
  - `shapeTreeEntry({id:'h',name:'f.ts',type:'blob',path:'src/f.ts',mode:'100644',x:1})` → `{id:'h',name:'f.ts',type:'blob',path:'src/f.ts',mode:'100644'}`.
  - `shapeMr({title:'T',description:'D',state:'opened',web_url:'u',source_branch:'s',target_branch:'m',author:{id:1,name:'A',username:'a'},assignee:null,reviewers:[{id:2,name:'B',username:'b'}],labels:['x','y',3]})` → `{title:'T',description:'D',state:'opened',web_url:'u',source_branch:'s',target_branch:'m',author:{id:1,name:'A',username:'a'},reviewers:[{id:2,name:'B',username:'b'}],labels:['x','y']}` (assignee null → omitted; labels filters non-strings; missing fields omitted).
  - `shapeJob({id:5,name:'build',status:'success',stage:'test',web_url:'u',ref:'main',created_at:'t1',duration:12,extra:'drop'}, 'LOG', false)` → `{id:5,name:'build',status:'success',stage:'test',web_url:'u',ref:'main',created_at:'t1',duration:12,log:'LOG',logTruncated:false}` (extra dropped; started_at/finished_at/queued_duration omitted when absent).
  - `truncateText('x'.repeat(10), 5)` → `{ text: 'xxxxx', truncated: true }`; `truncateText('abc', 100)` → `{ text:'abc', truncated:false }`.
  - `buildMrQuery({ state:'opened', perPage:150, orderBy:'updated_at' })` → a query string containing `state=opened`, `per_page=100` (capped), `order_by=updated_at` and NOTHING for unset fields; `state:'all'` → NO `state=` param (omitted); default `perPage` unset → `per_page=20`; `page` unset → `page=1`. (Return a `URLSearchParams`-built string; assert via parsing.)
- [ ] Implement `format.ts` with `isRecord`/`stringOr`/`numberOr`/`stringArrayOr` guards (no `as`). `buildMrQuery(opts)` maps camel input → snake_case params, omits `state` when `'all'`/undefined, caps `per_page` at 100 (default 20), defaults `page` to 1, includes `search`/`labels`/`source_branch`/`target_branch`/`order_by`/`sort` only when set.
- [ ] Test → PASS; typecheck + FULL lint + knip (ignore if flagged). Commit: `feat(mcp-gitlab): response shaping + query helpers`.

## Task 4: `GitLabClient`

**Files:** `plugins/mcp-gitlab/client.ts`, extend `tests/plugins/mcp-gitlab.test.ts`.

- [ ] Failing client tests (MODULE-scope routed httpFetch mock; capture URL + headers). Construct `{ baseUrl:'https://gl.test', token:'tok', httpFetch }`. Assert:
  - `getRepositoryTree('group/proj', { path:'src', ref:'main', recursive:true })` → URL `https://gl.test/api/v4/projects/group%2Fproj/repository/tree?path=src&ref=main&recursive=true&per_page=100`; header `PRIVATE-TOKEN:'tok'`, `Accept:'application/json'`; returns array of shaped tree entries.
  - `getFileContent('group/proj','src/a.ts')` → URL `.../projects/group%2Fproj/repository/files/src%2Fa.ts/raw?ref=HEAD` (filePath encoded, default ref HEAD); returns the raw text; a >1MB body → truncated with a banner containing `WARNING`.
  - `getFileContent('group/proj','a.ts',{ref:'dev'})` → `?ref=dev`.
  - `getMrInfo('group/proj','42')` → `.../projects/group%2Fproj/merge_requests/42`; returns shaped MR.
  - `getMrs('group/proj',{ state:'opened', perPage:150 })` → `.../merge_requests?state=opened&per_page=100&page=1&...`; the mocked Response has headers `x-total:'7'`, `x-total-pages:'1'`, `x-page:'1'`, `x-per-page:'100'` → returns `{ items:[...shaped], total:7, totalPages:1, page:1, perPage:100 }`. With `state:'all'` → NO `state=` in the URL.
  - `getJob('group/proj','123')` → TWO parallel GETs: `.../projects/group%2Fproj/jobs/123` and `.../jobs/123/trace`; the trace text becomes `log`; a >1MB trace → `logTruncated:true` and truncated `log`; returns the shaped job.
  - path injection: `getMrInfo('../../x','1')` → project path percent-encoded (`projects/..%2F..%2Fx/...`).
  - non-2xx on any primary GET → throws `GitLab API <status> …`.
- [ ] Implement `client.ts`. `GitLabClient` ctor `{ baseUrl, token, httpFetch }` (trailing-slash trimmed). Private `request(path): Promise<Response>` (returns raw Response; header `PRIVATE-TOKEN`). Private `getJson(path)` = `request` + ok-check + `res.json()`; `getText(path)` = `request` + ok-check + `res.text()`. Methods:
  - `getRepositoryTree(projectPath, opts)`: build query (`path`/`ref` if set, `recursive=true` if true, `per_page=100`); `getJson` → `Array.isArray(json) ? json.map(shapeTreeEntry) : []`.
  - `getFileContent(projectPath, filePath, opts?)`: `getText(`/projects/${enc}/repository/files/${enc(filePath)}/raw?ref=${enc(opts?.ref ?? 'HEAD')}`)`; `const { text, truncated } = truncateText(raw)`; if truncated prepend a `[WARNING: file truncated to ~1MB]\n\n` banner; return the string.
  - `getMrInfo(projectPath, mrIid)`: `getJson(`/projects/${enc}/merge_requests/${enc(mrIid)}`)` → `shapeMr`.
  - `getMrs(projectPath, opts)`: `const query = buildMrQuery(opts)`; `const res = await this.request(`/projects/${enc}/merge_requests?${query}`)`; ok-check; `const items = (await res.json())`; shape each via `shapeMr` (guard array); read headers `x-total`/`x-total-pages`/`x-page`/`x-per-page` (parse int, fallback to items.length / requested values); return `{ items, total, totalPages, page, perPage }`.
  - `getJob(projectPath, jobId)`: `const [jobRaw, trace] = await Promise.all([ this.getJson(`/projects/${enc}/jobs/${enc(jobId)}`), this.getText(`/projects/${enc}/jobs/${enc(jobId)}/trace`) ])`; `const { text: log, truncated } = truncateText(trace)`; return `shapeJob(jobRaw, log, truncated)`.
  - `encodeURIComponent` every segment; no `as` on `unknown`.
- [ ] Test → PASS; typecheck + FULL lint + knip (both `format.ts` + `client.ts` stay `["files"]`-ignored until Task 5). Commit: `feat(mcp-gitlab): GitLab read client (PRIVATE-TOKEN)`.

## Task 5: Tool registration (`index.ts`)

- [ ] Failing plugin tests (mirror mc-confluence; admin creds via `adminConfig.get('base_url')`/`get('token')`): activate registers exactly the 5 tools; `gitlab_get_mr_info` with mock httpFetch → returns the shaped MR; missing creds → `{error:'not_configured', message:'GitLab is not configured'}`; rate-limited → `{error:'rate_limited', retryAfterSec}`; httpFetch throws non-abort → `{error:'gitlab_error', message}`. Run → FAIL.
- [ ] Implement the factory (mirror `plugins/mcp-confluence/index.ts`): `buildToolDefinitions(getHttpFetch)`; each `execute`: rate-limit → read `base_url`/`token` via `runtimeContext.adminConfig.get` → `not_configured` if missing or httpFetch undefined → narrow `input` (required strings + optionals: `path`/`ref`/`filePath`/`state`/`search`/`labels`/`sourceBranch`/`targetBranch`/`orderBy`/`sort` strings, `recursive` boolean via a `readOptionalBoolean`, `perPage`/`page` numbers) → `new GitLabClient({ baseUrl: base_url, token, httpFetch })` → call → return. try/catch: `AbortError`→`timeout`, `ValidationError`→`validation_error`, else `gitlab_error`. Concise read-only descriptions. NO redaction. Extract helpers to satisfy `max-lines-per-function`.
- [ ] Test → PASS; `bun test tests/plugins/` green; typecheck + FULL lint + knip: REMOVE `input-schema.ts`/`format.ts`/`client.ts` ignores; KEEP `index.ts": ["exports"]`. Commit: `feat(mcp-gitlab): register 5 read-only GitLab tools`.

## Task 6: README + verification + docs + gate

- [ ] README (mirror mc-confluence): purpose (read-only), 5-tools table, admin config (`base_url`, `token` sensitive — `PRIVATE-TOKEN`), `/api/v4`, the documented deviations (single-page pagination, structured job, no jobUrl, write tools deferred to magi), NO redaction, and that project paths are `namespace/project`.
- [ ] `tests/mcp-server/mcp-gitlab-listing.test.ts` mirroring the mc-confluence listing test: 5 named tools with `inputSchema`; empties after deactivate. Run → PASS.
- [ ] Add `mcp-gitlab` to `docs/architecture/coding-stack-overview.md` migrated-plugins mention (5 read-only GitLab tools, PRIVATE-TOKEN, no redaction, writes deferred to magi).
- [ ] `bun run check:full` → 12/12 green (flake caveat: standalone `bun test`, free port 9100). Commit: `feat(mcp-gitlab): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** the 5 read tools; `PRIVATE-TOKEN` auth; project-path encoding; MR-list header-based pagination; job = metadata + trace; shaping helpers; verification (Task 6).
- **Deviations (documented):** single-page pagination; structured job object; no jobUrl parsing; char-slice truncation; write tools out of scope (magi). No redaction (matches kiss).
- **Risks:** (1) `PRIVATE-TOKEN` not Bearer — easy to get wrong; Task 4 tests assert the exact header. (2) project path must be `encodeURIComponent`'d whole (slashes → %2F) — tested. (3) `get_mrs` reads pagination from RESPONSE HEADERS (so the client's `request` must return the raw `Response`, not pre-parsed JSON) — the client design returns `Response` from `request` for exactly this.
- **Placeholders:** none — endpoints, encoding, query building, shaping, and truncation are concrete; client/index reference the committed template.

## Follow-ups (this plan + carried)

- **GitLab write tools** (post_comment, create_discussion, update_mr, set_mr_state) — deferred pending the papai/magi forge-write boundary decision.
- **Full pagination** (`all=true` Link-header following) for tree + MR list — deferred.
- **`jobUrl` convenience** parsing for `gitlab_get_job` — deferred.
- Carried: per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset, `abortSignal` threading in plugin clients, figma full-simplify + token pooling, teamcity config-envelope flattening, mattermost binary-attachment delivery, the dead `key==='key'` branch in `mcp-sentry/format.ts`.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 8: `mcp-youtrack` (read + comment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-youtrack` — agent-facing YouTrack tools for reading issues/comments/activities/attachments/fields/tags and adding a comment, exposed as an MCP server for coding agents, with bridge-level redaction.

**Scope (part 1 of 2).** kiss's youtrack-mcp has 14 tools; this plan ships **8** — the 7 read tools + `add_comment`. The 6 intricate write tools (`create_issue`, `update_fields`, `add_issue_tag`, `remove_issue_tag`, `set_tags`, `set_issue_link` — all requiring custom-field value-type resolution, tag-name resolution/diffing, or link-direction logic) are deferred to **Plan 8b** (documented in Follow-ups). This keeps part 1 tractable and high-quality.

**Architecture:** A native papai plugin of the proven shape. `mcpServer: true` at `/mcp/plugin/mcp-youtrack`; `mcpResponseRedaction: true` (YouTrack is a redacting server — issue/comment/attachment content is high-risk PII). Auth `Authorization: Bearer <token>` against the YouTrack REST API (`{base_url}/api`). **Mixed config scoping:** `base_url` is admin (shared instance), `token` is **context-scoped** (per-team personal token, like figma). Reimplemented on plain `httpFetch`.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–7)

Read `plugins/mcp-sentry/`, `plugins/mcp-confluence/`, `plugins/mcp-figma/` (for the context-scoped token pattern), and `plugins/mcp-mattermost/` (for the `download_attachment` adaptation) first. Carry:

- Before EVERY commit run the FULL `bun run lint` and `bun run knip` (type-aware oxlint rules — `strict-boolean-expressions`, `require-unicode-regexp`, `no-misused-spread`, `no-conditional-in-test`, `no-negated-condition`, `no-unsafe-*` — only surface in the full run / CI). No lint-disables; narrow `unknown` with `isRecord` guards (no `as`); never test truthiness of `unknown`; `u` on regexes; test-mock routing at MODULE scope.
- SPDX header on every `.ts`; `.js` sibling imports; `encodeURIComponent` every caller-supplied URL path segment; encode query values.
- knip traverses only from entry points; add `["files"]` ignores for unconsumed plugin files, REMOVE at tool-registration; KEEP `index.ts": ["exports"]`.
- `bunx oxfmt` ONLY changed files (revert CHANGELOG.md). Leave `docs/scenarios/` alone.
- `check:full`'s `test` step flakes under contention — standalone `bun test` + `lsof -ti :9100` on failure; not a code bug.

## Redaction decision (simplification vs kiss)

kiss redacts per-tool with two different prompts (issue-text vs attachment-content), and skips redaction on the tag tools. papai's redaction is a UNIFORM plugin-level manifest flag applied at the bridge with the single `DEFAULT_REDACTION_PROMPT` (from Plan 1). So this plugin sets `mcpResponseRedaction: true` and **every** tool response is bridge-redacted with the default prompt — which covers both issue PII and attachment secrets, and is strictly SAFER than kiss (kiss skipped tag redaction for perf). The per-tool/per-plugin prompt override remains a documented follow-up; it is NOT needed here. The plugin calls NO redactor itself. (Fail-closed eligibility from Plan 1 applies: requires operator `mcp_redaction` config or the plugin is ineligible.)

## YouTrack API facts (source: kiss `mcp/youtrack-mcp/`, YouTrack REST API)

- **Auth:** `Authorization: Bearer <token>`, `Accept: application/json`, `Content-Type: application/json`.
- **Base:** `{base_url}/api` (base_url trailing-slash trimmed).
- **Request helper** `request(path, init?): Promise<unknown>`: `httpFetch(`${baseUrl}/api${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers } })`; on `!res.ok` throw `YouTrack API <status> for <path>`; on `204` → undefined; else parse text→JSON (empty body → undefined). (Narrow headers to `Record<string,string>` before spreading.)
- **`fields=` constants** (module consts in `format.ts` or `client.ts`):
  - `ISSUE_FIELDS = 'idReadable,summary,description,reporter(login,fullName),tags(id,name),customFields(name,value(name,login,fullName,text)),links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))'`
  - `COMMENT_READ_FIELDS = 'id,text,created,updated,deleted,author(login,fullName),attachments(id,name,size,mimeType)'`
  - `COMMENT_WRITE_FIELDS = 'id,text,author(login,fullName),created'`
  - `ACTIVITY_FIELDS = 'timestamp,field(name),added(name),removed(name),target(idReadable)'`
  - `ATTACHMENT_FIELDS = 'id,name,size,mimeType,url,author(login,fullName),created'`

**The 8 tools:**

| Tool                            | Input                                                   | REST                                                                                                                   | Notes                                            |
| ------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `youtrack_get_issue`            | `{ issueId: string (req) }`                             | `GET /issues/{enc(id)}?fields={ISSUE_FIELDS}`                                                                          | shape issue                                      |
| `youtrack_get_state_activities` | `{ issueId: string (req) }`                             | `GET /issues/{enc(id)}/activities?categories=CustomFieldCategory&fields={ACTIVITY_FIELDS}&$top=500&$orderby=timestamp` | filter client-side to `field.name==='State'`     |
| `youtrack_get_comments`         | `{ issueId: string (req) }`                             | `GET /issues/{enc(id)}/comments?fields={COMMENT_READ_FIELDS}&$top=500`                                                 | drop `deleted:true`, strip `deleted` key         |
| `youtrack_get_issue_tags`       | `{ issueId: string (req) }`                             | `GET /issues/{enc(id)}/tags?fields=id,name`                                                                            | array of `{id,name}`                             |
| `youtrack_get_field_options`    | `{ issueId: string (req), fieldName?: string }`         | `GET /issues/{enc(id)}?fields=customFields(name,$type,projectCustomField(bundle(values(name))))`                       | shape field options, filter by fieldName         |
| `youtrack_get_attachments`      | `{ issueId: string (req) }`                             | `GET /issues/{enc(id)}/attachments?fields={ATTACHMENT_FIELDS}`                                                         | array of attachment metadata                     |
| `youtrack_read_attachment`      | `{ issueId: string (req), attachmentId: string (req) }` | metadata + pre-signed content GET (see below)                                                                          | text inline / binary metadata (papai adaptation) |
| `youtrack_add_comment`          | `{ issueId: string (req), text: string (req) }`         | `POST /issues/{enc(id)}/comments?fields={COMMENT_WRITE_FIELDS}` body `{text}`                                          | WRITE → operator policy `ask`                    |

**`youtrack_read_attachment` — papai adaptation (like mattermost, documented deviation):** no filesystem handoff.

1. `GET /issues/{enc(issueId)}/attachments/{enc(attachmentId)}?fields={ATTACHMENT_FIELDS}` → `attachment` (has `url`, a YouTrack pre-signed RELATIVE url like `/api/files/<id>?sign=…`).
2. if `attachment.size > MAX_INLINE = 512_000` → `{ attachment, tooLarge: true }`.
3. else if `typeof attachment.mime_type... ` — use `attachment.mimeType` — `typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('text/')` → fetch content at the PRE-SIGNED url: `this.httpFetch(`${baseUrl}${attachment.url}`, { headers: { Authorization: `Bearer ${token}`, Accept: '*/*' } })` (NOTE: `attachment.url` already includes `/api`, so use `${baseUrl}${url}`, NOT the `/api`-prefixing `request()`helper); on ok →`await res.text()`→`{ attachment, text }`.
4. else → `{ attachment, isBinary: true, note: 'Binary attachment; content not inlined (no filesystem handoff in this MCP transport).' }`.
   No filesystem, no base64. Bridge redaction covers the inline `text` (with Plan 1's input-size cap → oversize text blocks fail-closed).

**Shaping (into `format.ts`, pure over `unknown`):**

- `shapeUser(raw)` → `{ login?, fullName? }`.
- `shapeIssue(raw)` → `{ idReadable?, summary?, description?, reporter?: user, tags?: {id?,name?}[], customFields?: {name?, value?: unknown}[], links?: {id?,direction?,linkType?,issues?}[] }`. For `customFields`, keep `{ name, value }` where `value` is passed through `shapeFieldValue` (see below). For `links`, keep `{ id, direction, linkType: { name?, sourceToTarget?, targetToSource? }, issues: {id?,idReadable?,summary?}[] }`. (Do NOT port kiss's `subtaskOf`/`parentOf` derivation — deferred; the raw shaped `links` suffice.)
- `shapeFieldValue(v)`: if `v` is null → null; if array → map `shapeFieldValue`; if record → pick `name`/`login`/`fullName`/`text` (whichever present); else (primitive) → the primitive.
- `shapeComment(raw)` → `{ id?, text?, created?, updated?, author?: user, attachments?: {id?,name?,size?,mimeType?}[] }`.
- `shapeActivity(raw)` → `{ timestamp?, field?: {name?}, added?: {name?}[], removed?: {name?}[], target?: {idReadable?} }`.
- `shapeAttachment(raw)` → `{ id?, name?, size?, mimeType?, url?, author?: user, created? }`.
- `shapeFieldOptions(issueRaw, fieldName?)`: from `issueRaw.customFields[]`, for each `{ name, $type, projectCustomField: { bundle: { values: [{name}] } } }` → if a bundle with values exists `{ name, type: $type, values: string[] }`, else `{ name, type: $type, free: true }`; filter to `fieldName` (case-insensitive) when provided (return `[]` or all).

## Config keys

| key        | scope       | required       | use                                               |
| ---------- | ----------- | -------------- | ------------------------------------------------- |
| `base_url` | admin       | ✅             | YouTrack base URL (`/api` appended)               |
| `token`    | **context** | ✅ (sensitive) | `Authorization: Bearer` (per-team personal token) |

## File structure

```
plugins/mcp-youtrack/
  plugin.json     # mcpServer+mcpResponseRedaction, http, providerAllowedHostsFromConfig:["base_url"],
                  # admin base_url + CONTEXT-scoped token, configKeys:["token"]
  context.ts      # COPY of plugins/mcp-figma/context.ts (has BOTH adminConfig + contextConfig on the exec Like type)
  input-schema.ts # 8 JSON-Schema objects
  format.ts       # field constants + shapeUser/shapeIssue/shapeFieldValue/shapeComment/shapeActivity/shapeAttachment/shapeFieldOptions
  client.ts       # YouTrackClient (Bearer, 8 methods)
  index.ts        # factory registering 8 tools (base_url via adminConfig, token via contextConfig)
  README.md
tests/plugins/mcp-youtrack.test.ts          # format + client + plugin blocks
tests/plugins/mcp-youtrack-schema.test.ts   # structural schema tests
tests/mcp-server/mcp-youtrack-listing.test.ts
```

---

## Task 1: Manifest + context facade (mixed-scope creds)

- [ ] Copy `plugins/mcp-figma/context.ts` → `plugins/mcp-youtrack/context.ts` VERBATIM (it has BOTH `adminConfig` and `contextConfig` on `PluginToolRuntimeContextLike` — youtrack reads `base_url` via admin and `token` via context).
- [ ] Create `plugins/mcp-youtrack/plugin.json`:

```json
{
  "id": "mcp-youtrack",
  "name": "YouTrack (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing YouTrack issue/comment/attachment tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "mcpResponseRedaction": true,
  "contributes": {
    "tools": [
      "youtrack_get_issue",
      "youtrack_get_state_activities",
      "youtrack_get_comments",
      "youtrack_get_issue_tags",
      "youtrack_get_field_options",
      "youtrack_get_attachments",
      "youtrack_read_attachment",
      "youtrack_add_comment"
    ],
    "promptFragments": [],
    "configKeys": ["token"]
  },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "YouTrack Base URL", "required": true, "scope": "admin" },
    { "key": "token", "label": "YouTrack Permanent Token", "required": true, "sensitive": true, "scope": "context" }
  ],
  "activationTimeoutMs": 3000
}
```

NOTE the mixed scoping: `base_url` admin + `token` context; `contributes.configKeys: ["token"]` lists ONLY the context-scoped key (the `hasMatchingContextConfigKeys` refine requires configKeys ⊆ context-scoped requirement keys); `providerAllowedHostsFromConfig: ["base_url"]` references the admin key (allowed by the refine). `mcpResponseRedaction: true`.

- [ ] Placeholder `index.ts` (license header, factory + logging, NO tools). Add `"plugins/mcp-youtrack/index.ts": ["exports"]` to `knip.jsonc`. Validate manifest parses (throwaway test importing `pluginManifestSchema` + parse — CONFIRM the mixed-scope + configKeys pairing is accepted; if it throws, read `hasMatchingContextConfigKeys`/`hasProviderAllowedHostsFromConfig` and report — do NOT hack; delete the throwaway). `bun test tests/plugins/discovery.test.ts` green; typecheck + FULL lint + knip clean. Commit: `feat(mcp-youtrack): plugin manifest and context facade`.

## Task 2: Input schemas

- [ ] Failing structural schema tests: get_issue/get_state_activities/get_comments/get_issue_tags/get_attachments → required `issueId`; get_field_options → required `issueId`, optional `fieldName`; read_attachment → required `issueId`+`attachmentId`; add_comment → required `issueId`+`text`. Run → FAIL.
- [ ] Create `plugins/mcp-youtrack/input-schema.ts` (8 `as const` objects) — shared `const issueId = { type:'string', minLength:1, description:'YouTrack issue id, e.g. "PROJ-123"' } as const`:
  - `youtrackGetIssueSchema` / `youtrackGetStateActivitiesSchema` / `youtrackGetCommentsSchema` / `youtrackGetIssueTagsSchema` / `youtrackGetAttachmentsSchema`: props `{ issueId }`, required `['issueId']`.
  - `youtrackGetFieldOptionsSchema`: props `{ issueId, fieldName:{type:'string',description:'Custom field name to filter to'} }`, required `['issueId']`.
  - `youtrackReadAttachmentSchema`: props `{ issueId, attachmentId:{type:'string',minLength:1,description:'Attachment id from get_attachments'} }`, required `['issueId','attachmentId']`.
  - `youtrackAddCommentSchema`: props `{ issueId, text:{type:'string',minLength:1,description:'Comment text'} }`, required `['issueId','text']`.
    All `additionalProperties:false`, `as const`.
- [ ] Test → PASS; typecheck + FULL lint + knip (ignore if flagged). Commit: `feat(mcp-youtrack): tool input schemas`.

## Task 3: Shaping helpers (`format.ts`)

**Pure functions only.** Field-selection constants + the shape\* helpers per the "Shaping" section above. `tests/plugins/mcp-youtrack.test.ts` (`describe('mcp-youtrack format', …)`).

- [ ] Failing tests then implement (cover: `shapeUser` picks login/fullName; `shapeIssue` shapes reporter/tags/customFields(value via shapeFieldValue)/links; `shapeFieldValue` handles null/array/record{name}/record{login,fullName}/record{text}/primitive; `shapeComment` shapes author/attachments; `shapeActivity`; `shapeAttachment`; `shapeFieldOptions` — a field with a bundle → `{name,type,values}`, a field without → `{name,type,free:true}`, filter by fieldName case-insensitive; non-record inputs → safe empties). Use `isRecord`/`stringOr`/`numberOr` guards, no `as`.
- [ ] Test → PASS; typecheck + FULL lint + knip (ignore if flagged). Commit: `feat(mcp-youtrack): response shaping helpers`.

## Task 4: `YouTrackClient`

**Files:** `plugins/mcp-youtrack/client.ts`, extend `tests/plugins/mcp-youtrack.test.ts`.

- [ ] Failing client tests (MODULE-scope routed httpFetch mock; capture URL + headers + bodies). Construct `{ baseUrl:'https://yt.test', token:'tok', httpFetch }`. Assert:
  - `getIssue('P-1')` → `GET https://yt.test/api/issues/P-1?fields=...` with header `Authorization:'Bearer tok'`; returns shaped issue.
  - `getStateActivities('P-1')` → URL `.../api/issues/P-1/activities?categories=CustomFieldCategory&fields=...&$top=500&$orderby=timestamp`; a mixed activities array → only `field.name==='State'` entries returned (shaped).
  - `getComments('P-1')` → `.../issues/P-1/comments?fields=...&$top=500`; a `deleted:true` comment is dropped and no result has a `deleted` key.
  - `getIssueTags('P-1')` → `.../issues/P-1/tags?fields=id,name` → array.
  - `getFieldOptions('P-1','Priority')` → `.../issues/P-1?fields=customFields(name,$type,projectCustomField(bundle(values(name))))`; returns the shaped options filtered to Priority.
  - `getAttachments('P-1')` → `.../issues/P-1/attachments?fields=...` → shaped array.
  - `readAttachment('P-1','A9')`: metadata `{id:'A9',size:100,mimeType:'text/plain',url:'/api/files/A9?sign=x'}` → then a content GET to `https://yt.test/api/files/A9?sign=x` (Accept `*/*`, Bearer) → `'hello'` → `{attachment:{...},text:'hello'}`. metadata `size:999999` → `{attachment,tooLarge:true}` (NO content GET). metadata `mimeType:'image/png',size:100` → `{attachment,isBinary:true,note:...}` (NO content GET).
  - `addComment('P-1','hi')` → `POST .../issues/P-1/comments?fields=...`, `Content-Type: application/json`, body `{"text":"hi"}` → returns the shaped created comment.
  - path injection: `getIssue('../../x')` → `issues/..%2F..%2Fx` in URL.
  - non-2xx on a primary GET → throws; a `204` on `addComment`... (addComment returns a comment body, so 200; but ensure 204→undefined handling exists in `request`).
- [ ] Implement `client.ts`. `YouTrackClient` ctor `{ baseUrl, token, httpFetch }` (trailing-slash trimmed). Private `request(path, init?)` per the "Request helper" spec (Bearer, `/api` prefix, 204→undefined, text→JSON). Methods per the table; `readAttachment` fetches the pre-signed content at `${baseUrl}${attachment.url}` DIRECTLY (not via `request`'s `/api` prefix) with Bearer + `Accept:'*/*'`. `getStateActivities` filters `field.name==='State'`. `getComments` drops `deleted`. `MAX_INLINE = 512_000`. Shape all responses via `format.ts` helpers. `encodeURIComponent` path segments; no `as` on `unknown`.
- [ ] Test → PASS; typecheck + FULL lint + knip (both `format.ts` + `client.ts` stay ignored until Task 5). Commit: `feat(mcp-youtrack): YouTrack client (read + comment)`.

## Task 5: Tool registration (`index.ts`) — mixed-scope creds

- [ ] Failing plugin tests (mirror mc-figma for the context token, but ALSO read admin base_url): the fake runtime context provides `adminConfig: { get: (k) => k==='base_url' ? 'https://yt.test' : undefined }` AND `contextConfig: { get: (k) => k==='token' ? 'tok' : undefined }`. Assert: activate registers exactly the 8 tools; `youtrack_get_issue` with mock httpFetch → returns the shaped issue; missing token (contextConfig → undefined) OR missing base_url (adminConfig → undefined) → `{error:'not_configured', message:'YouTrack is not configured'}`; rate-limited → `{error:'rate_limited', retryAfterSec}`; httpFetch throws non-abort → `{error:'youtrack_error', message}`. Run → FAIL.
- [ ] Implement the factory (mirror `plugins/mcp-figma/index.ts` for the context token; add the admin base_url read): `buildToolDefinitions(getHttpFetch)`; each `execute`: rate-limit → `const baseUrl = runtimeContext.adminConfig.get('base_url')`, `const token = runtimeContext.contextConfig.get('token')` → if `baseUrl`/`token` undefined OR httpFetch undefined → `not_configured` → narrow `input` → `new YouTrackClient({ baseUrl, token, httpFetch })` → call → return. try/catch: `AbortError`→`timeout`, `ValidationError`→`validation_error`, else `youtrack_error`. Concise descriptions; note `youtrack_add_comment` is a WRITE. NO redaction here (bridge does it, mcpResponseRedaction:true).
- [ ] Test → PASS; `bun test tests/plugins/` green; typecheck + FULL lint + knip: REMOVE `input-schema.ts`/`format.ts`/`client.ts` ignores; KEEP `index.ts": ["exports"]`. Commit: `feat(mcp-youtrack): register 8 read + comment tools`.

## Task 6: README + verification + docs + gate

- [ ] README (mirror mc-confluence): purpose, 8-tools table, MIXED config (admin `base_url`, context-scoped `token` sensitive), Bearer + `/api`, `mcpResponseRedaction` (bridge redacts; requires `mcp_redaction` or ineligible), `youtrack_add_comment` is a WRITE (operator sets `ask`/`deny`), `youtrack_read_attachment` adaptation (text inline / binary metadata / no filesystem), AND a prominent "Scope: part 1" note listing the 6 deferred write tools (create_issue, update_fields, add/remove/set tags, set_issue_link) as a planned Plan 8b.
- [ ] `tests/mcp-server/mcp-youtrack-listing.test.ts` mirroring the mc-confluence listing test: 8 named tools with `inputSchema`; empties after deactivate. Run → PASS.
- [ ] Add `mcp-youtrack` to `docs/architecture/coding-stack-overview.md` migrated-plugins mention (8 read+comment YouTrack tools, Bearer, redacted, context-scoped token; note it's part 1 with writes deferred).
- [ ] `bun run check:full` → 12/12 green (flake caveat: standalone `bun test`, free port 9100). Commit: `feat(mcp-youtrack): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** 7 reads + add_comment; Bearer + `/api`; MIXED-scope creds (admin base_url + context token — exercises reading both facades in one execute); uniform bridge redaction; read_attachment adapted to papai; shaping helpers; verification (Task 6).
- **Deviations (documented):** (a) 6 write tools deferred to Plan 8b; (b) uniform bridge redaction (default prompt) instead of kiss's per-tool prompts — safer, and the per-plugin prompt override stays deferred; (c) read_attachment text-inline/binary-metadata (no FS); (d) `subtaskOf`/`parentOf` link-derivation not ported (raw shaped links suffice); (e) single-page `$top=500` (no multi-page activity/comment loop) — matches kiss's caps, documented.
- **Risks:** (1) mixed-scope manifest is new — Task 1 verifies the `configKeys`/`providerAllowedHostsFromConfig` refines accept admin base_url + context token. (2) `read_attachment`'s pre-signed `url` must be fetched at `${baseUrl}${url}` (already `/api`-prefixed) — NOT via the `/api`-prefixing `request()` helper; Task 4 tests the exact content URL. (3) both creds must be read (admin AND context) — Task 5 tests both-missing paths.
- **Placeholders:** none — endpoints, `fields=`, shaping, and the attachment adaptation are concrete; client/index reference the committed mc-figma/mc-mattermost templates.

## Follow-ups

- **Plan 8b — YouTrack write tools:** `create_issue` (project resolution + `buildCustomFieldValue` type mapping + summary-fixup), `update_fields` (custom-field type resolution + `buildCustomFieldValue`), `add_issue_tag`/`remove_issue_tag` (tag-name resolution via `GET /tags?query=`), `set_tags` (add/remove diff), `set_issue_link` (link-type + direction resolution). These carry the intricate value-shaping logic and deserve their own plan.
- Carried: per-plugin/per-tool redaction-prompt override (youtrack's attachment prompt would use it), `mcp_redaction` settings-UI + unset, `abortSignal` threading, figma full-simplify + token pooling, teamcity config-envelope flattening, mattermost binary-attachment delivery, gitlab write tools + full pagination, the dead `key==='key'` branch in `mcp-sentry/format.ts`.

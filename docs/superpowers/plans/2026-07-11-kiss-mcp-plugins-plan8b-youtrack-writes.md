<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 8b: `mcp-youtrack` write tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the existing `mcp-youtrack` plugin (Plan 8 part 1 shipped 8 read+comment tools) with the 6 deferred WRITE tools: `youtrack_create_issue`, `youtrack_update_fields`, `youtrack_add_issue_tag`, `youtrack_remove_issue_tag`, `youtrack_set_tags`, `youtrack_set_issue_link`. This brings the plugin to the full 14-tool parity with kiss.

**Architecture:** Extends `plugins/mcp-youtrack/` in place. These are WRITE tools (operators set per-tool policy `ask`/`deny`; `set_issue_link` → default `deny`). The plugin already has `mcpResponseRedaction: true`, so their responses are bridge-redacted. The crux is the **custom-field value-shaping** (`buildCustomFieldValue`) and **link-slot resolution** (`findIssueLink`) — intricate pure logic that gets its own heavily-tested task. Write client methods do GET-resolve-then-POST/DELETE sequences.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–9)

Read the existing `plugins/mcp-youtrack/` (context, input-schema, format, client, index) first — you are extending it. Carry: FULL `bun run lint` + `bun run knip` before every commit; SPDX headers; `.js` imports; `encodeURIComponent` every path segment; narrow `unknown` with `isRecord` (no `as`); no truthiness-of-unknown; `u` on regexes; test-mock routing at MODULE scope; `max-lines` 300/file + `max-lines-per-function` 50 (split, don't game); `bunx oxfmt` only changed files; jscpd `duplicates` check dislikes copy-pasted blocks (extract shared helpers). `check:full`'s `test` step flakes under contention (standalone `bun test` + free `lsof -ti :9100`).

## YouTrack write API facts (source: kiss `mcp/youtrack-mcp/`)

Reuses the existing client's request core (Bearer, `{base_url}/api`, `Content-Type: application/json`, 204→undefined). New field constants (add to `format.ts` or a new module):

- `ISSUE_LINK_FIELDS = 'id,links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))'`
- `COMMENT_WRITE_FIELDS` already exists; `ISSUE_FIELDS` already exists.

**The 6 write tools:**

| Tool                        | Input                                                                                                                                       | REST sequence                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `youtrack_create_issue`     | `{ project: string (req), summary: string (req), description?: string, customFields?: Record<FieldValue>, referenceIssueId?: string }`      | resolve project id → `POST /issues?fields={ISSUE_FIELDS}` → optional summary-fixup           |
| `youtrack_update_fields`    | `{ issueId: string (req), fields: Record<FieldValue> (req, non-empty) }`                                                                    | GET types → `POST /issues/{enc(id)}?fields={ISSUE_FIELDS}`                                   |
| `youtrack_add_issue_tag`    | `{ issueId: string (req), tagName: string (req) }`                                                                                          | resolve tag → `POST /issues/{enc(id)}/tags?fields=id,name`                                   |
| `youtrack_remove_issue_tag` | `{ issueId: string (req), tagName: string (req) }`                                                                                          | resolve tag → `DELETE /issues/{enc(id)}/tags/{enc(tagId)}`                                   |
| `youtrack_set_tags`         | `{ issueId: string (req), tags: string[] (req) }`                                                                                           | GET current → add missing / delete extra                                                     |
| `youtrack_set_issue_link`   | `{ sourceIssueId: string (req), targetIssueId: string (req), linkType: string (req), direction: 'sourceToTarget'\|'targetToSource' (req) }` | GET owning issue links → find slot → `POST /issues/{enc(owning)}/links/{enc(slotId)}/issues` |

`FieldValue = string | number | boolean | null | (string|number)[]`.

**`buildCustomFieldValue(type, value)` — THE crux (pure; port faithfully):**

- `fieldTypeToValueType(type)`: `type.includes('User')`→`'User'`; else `includes('Group')`→`'UserGroup'`; else `includes('State')`→`'StateBundleElement'`; else `includes('Version')`→`'VersionBundleElement'`; else `includes('Build')`→`'BuildBundleElement'`; else `includes('Owned')`→`'OwnedBundleElement'`; else `'EnumBundleElement'`.
- `buildCustomFieldValue(type, value)`:
  - `value === null` → `null`.
  - `if (/Enum|State|Version|Build|Owned|Group|User/u.test(type))`: `const vt = fieldTypeToValueType(type)`; `const single = (v) => type.includes('User') ? { $type: vt, login: String(v) } : { $type: vt, name: String(v) }`; if `type.startsWith('Multi')` → `Array.isArray(value) ? value.map(single) : [single(value)]`; else → `single(Array.isArray(value) ? value[0] : value)`.
  - else `if (type.includes('Period'))` → `typeof value === 'number' ? { minutes: value } : { presentation: String(value) }`.
  - else `if (type.includes('Text'))` → `{ text: String(value) }`.
  - else → `value` (Simple*/Date* passthrough).

**`findIssueLink(links, linkType, direction)` — link-slot resolution (pure):**

- `linkMatches(link, linkType, direction)`: `link` is a record with `linkType` (record `{ name?, sourceToTarget?, targetToSource? }`); normalize compare = lowercased/trimmed. Match if `linkType` equals ANY of: `link.linkType[direction]` (direction is `'sourceToTarget'` or `'targetToSource'`), `link.linkType.name`, `link.linkType.sourceToTarget`, `link.linkType.targetToSource`.
- `findIssueLink(links: unknown, linkType, direction): { id: string } | undefined` — if `links` is an array, return the first record where `linkMatches` and it has a string `id` → `{ id }`; else undefined. (The caller throws a helpful error listing available link-type names when undefined.)

**Project resolution (create_issue):** if `project` matches `/^\d+(-\d+)?$/u` → use as id; else `GET /admin/projects/{enc(project)}?fields=id` → read `.id`.

## File structure (extends existing plugin)

```
plugins/mcp-youtrack/
  plugin.json         # add 6 tool names to contributes.tools (now 14)
  format-writes.ts    # NEW: fieldTypeToValueType / buildCustomFieldValue / linkMatches / findIssueLink + ISSUE_LINK_FIELDS
  http.ts             # NEW: extracted shared requester (createYouTrackRequester → { request, getJson, getText })
  client.ts           # refactor to use http.ts (read client, unchanged behavior)
  write-client.ts     # NEW: YouTrackWriteClient (6 write methods) using the shared requester
  input-schema.ts     # add 6 schemas
  index.ts            # register the 6 new tools (now 14)
tests/plugins/mcp-youtrack-writes.test.ts   # write helpers + write-client + plugin-write blocks (keep the existing mcp-youtrack.test.ts)
```

---

## Task 1: Manifest + input schemas for the 6 write tools

- [ ] Add the 6 tool names to `plugins/mcp-youtrack/plugin.json` `contributes.tools` (append `youtrack_create_issue`, `youtrack_update_fields`, `youtrack_add_issue_tag`, `youtrack_remove_issue_tag`, `youtrack_set_tags`, `youtrack_set_issue_link` — now 14 total). Confirm the manifest still parses (throwaway, delete).
- [ ] Add 6 `as const` schemas to `plugins/mcp-youtrack/input-schema.ts`. A `FieldValue` JSON schema fragment `const fieldValue = { anyOf: [{type:'string'},{type:'number'},{type:'boolean'},{type:'null'},{type:'array',items:{anyOf:[{type:'string'},{type:'number'}]}}] } as const`:
  - `youtrackCreateIssueSchema`: props `{ project:{type:'string',minLength:1}, summary:{type:'string',minLength:1}, description:{type:'string'}, customFields:{type:'object',additionalProperties:fieldValue}, referenceIssueId:{type:'string'} }`, required `['project','summary']`.
  - `youtrackUpdateFieldsSchema`: props `{ issueId:{type:'string',minLength:1}, fields:{type:'object',additionalProperties:fieldValue,minProperties:1} }`, required `['issueId','fields']`.
  - `youtrackAddIssueTagSchema`: props `{ issueId, tagName:{type:'string',minLength:1} }`, required `['issueId','tagName']`.
  - `youtrackRemoveIssueTagSchema`: props `{ issueId, tagName:{type:'string',minLength:1} }`, required `['issueId','tagName']`.
  - `youtrackSetTagsSchema`: props `{ issueId, tags:{type:'array',items:{type:'string',minLength:1}} }`, required `['issueId','tags']`.
  - `youtrackSetIssueLinkSchema`: props `{ sourceIssueId:{type:'string',minLength:1}, targetIssueId:{type:'string',minLength:1}, linkType:{type:'string',minLength:1}, direction:{type:'string',enum:['sourceToTarget','targetToSource']} }`, required `['sourceIssueId','targetIssueId','linkType','direction']`.
    (Reuse the existing `issueId` shared const.)
- [ ] Extend `tests/plugins/mcp-youtrack-schema.test.ts` with structural assertions for the 6 new schemas (required fields; `direction` enum; `customFields`/`fields` are objects). Run → PASS. typecheck + FULL lint + knip (the schemas are consumed by index.ts only after Task 6 — but they're already imported by the EXISTING input-schema.ts file which IS reached from index.ts, so no new ignore needed; verify). Commit: `feat(mcp-youtrack): add write-tool manifest entries and input schemas`.

## Task 2: Pure write helpers (`format-writes.ts`) — heavily tested

**Files:** `plugins/mcp-youtrack/format-writes.ts`, `tests/plugins/mcp-youtrack-writes.test.ts`.

- [ ] Write failing tests (`describe('mcp-youtrack write helpers', …)`) covering `fieldTypeToValueType`, `buildCustomFieldValue`, `linkMatches`, `findIssueLink`:
  - `fieldTypeToValueType('SingleUserIssueCustomField')`→`'User'`; `'MultiEnumIssueCustomField'`→`'EnumBundleElement'`; `'StateIssueCustomField'`→`'StateBundleElement'`; `'SingleVersionIssueCustomField'`→`'VersionBundleElement'`; `'SingleGroupIssueCustomField'`→`'UserGroup'`; `'SimpleIssueCustomField'`→`'EnumBundleElement'` (fallback).
  - `buildCustomFieldValue('SingleEnumIssueCustomField','High')`→`{$type:'EnumBundleElement',name:'High'}`; `buildCustomFieldValue('SingleUserIssueCustomField','jdoe')`→`{$type:'User',login:'jdoe'}`; `buildCustomFieldValue('MultiEnumIssueCustomField',['a','b'])`→`[{$type:'EnumBundleElement',name:'a'},{$type:'EnumBundleElement',name:'b'}]`; `buildCustomFieldValue('MultiEnumIssueCustomField','a')`→`[{$type:'EnumBundleElement',name:'a'}]` (non-array wrapped); `buildCustomFieldValue('StateIssueCustomField',null)`→`null`; `buildCustomFieldValue('PeriodIssueCustomField',90)`→`{minutes:90}`; `buildCustomFieldValue('PeriodIssueCustomField','1h 30m')`→`{presentation:'1h 30m'}`; `buildCustomFieldValue('TextIssueCustomField','hi')`→`{text:'hi'}`; `buildCustomFieldValue('SimpleIssueCustomField',42)`→`42`; `buildCustomFieldValue('DateIssueCustomField','2026-01-01')`→`'2026-01-01'`.
  - `findIssueLink([{id:'s1',linkType:{name:'relates',sourceToTarget:'relates to',targetToSource:'relates to'}}],'relates','sourceToTarget')`→`{id:'s1'}`; match by directional label `'relates to'` also works; `findIssueLink([...],'nonexistent','sourceToTarget')`→`undefined`; non-array → undefined; `linkMatches` is case-insensitive/trimmed.
    Run → FAIL, implement `format-writes.ts` (with `isRecord`/`stringOr` guards; no `as`), → PASS.
- [ ] typecheck + FULL lint + knip (add `"plugins/mcp-youtrack/format-writes.ts": ["files"]` ignore — consumed by write-client in Task 4). Commit: `feat(mcp-youtrack): custom-field value + link-slot write helpers`.

## Task 3: Extract shared HTTP requester (`http.ts`) + refactor `client.ts`

**Files:** `plugins/mcp-youtrack/http.ts` (new), `plugins/mcp-youtrack/client.ts` (refactor). Behavior-preserving.

- [ ] Create `plugins/mcp-youtrack/http.ts` exporting `createYouTrackRequester({ baseUrl, token, httpFetch }): { request(path, init?): Promise<unknown>; getJson(path): Promise<unknown>; getText(path): Promise<string>; baseUrl: string }` — move the EXACT request logic currently private in `client.ts` (Bearer, `${baseUrl}/api${path}`, header narrowing, non-2xx throw `YouTrack API <status> for <path>`, 204→undefined, text→JSON). `baseUrl` is exposed for `readAttachment`'s pre-signed-url fetch.
- [ ] Refactor `client.ts` (`YouTrackClient`) to construct `this.http = createYouTrackRequester(opts)` and call `this.http.request/getJson/getText` (and `this.http.baseUrl` for readAttachment's `${baseUrl}${url}` fetch — the raw httpFetch is still needed there; keep `this.httpFetch`/`this.token` on the class for that direct call, OR add a `requestAbsolute(url, init)` to the requester and use it). ALL EXISTING `tests/plugins/mcp-youtrack.test.ts` MUST stay green (behavior unchanged) — run them.
- [ ] typecheck + FULL lint + knip (`http.ts` is consumed by client.ts → reachable; no ignore needed) + duplicates. `bun test tests/plugins/mcp-youtrack.test.ts` → still all pass. Commit: `refactor(mcp-youtrack): extract shared HTTP requester`.

## Task 4: `YouTrackWriteClient` — tag + link writes

**Files:** `plugins/mcp-youtrack/write-client.ts` (new), extend `tests/plugins/mcp-youtrack-writes.test.ts`.

- [ ] Failing tests (MODULE-scope routed httpFetch mock). `YouTrackWriteClient` ctor `{ baseUrl, token, httpFetch }` → uses `createYouTrackRequester`. Methods:
  - `private async resolveTagByName(tagName): Promise<string>` — `GET /tags?fields=id,name&query={enc(tagName)}`; filter to records with EXACT `name === tagName`; throw `Tag not found: <name>` if 0 (list near names), throw `Ambiguous tag: <name>` if >1; else return the id.
  - `addIssueTag(issueId, tagName)` → `const id = await resolveTagByName(tagName)`; `POST /issues/{enc(issueId)}/tags?fields=id,name` body `{ id }`; return a confirmation string `Tag "<tagName>" added to <issueId>`.
  - `removeIssueTag(issueId, tagName)` → `const id = await resolveTagByName(tagName)`; `DELETE /issues/{enc(issueId)}/tags/{enc(id)}`; return `Tag "<tagName>" removed from <issueId>`.
  - `setTags(issueId, tags: string[])` → dedupe/trim desired into a Set; `GET /issues/{enc(issueId)}/tags?fields=id,name` for current (array of {id,name}); for each desired name not in current names → `resolveTagByName` + POST (as addIssueTag); for each current tag whose name ∉ desired → DELETE; return `Tags set on <issueId>: <sorted desired list>`.
  - `setIssueLink(sourceIssueId, targetIssueId, linkType, direction)` → owning = `direction==='targetToSource' ? targetIssueId : sourceIssueId`; linkedId = `direction==='targetToSource' ? sourceIssueId : targetIssueId`; `const owningIssue = await getJson(/issues/{enc(owning)}?fields=${ISSUE_LINK_FIELDS})`; `const slot = findIssueLink(owningIssue.links, linkType, direction)`; throw `Link type not found: <linkType>` (list available) if undefined; `POST /issues/{enc(owning)}/links/{enc(slot.id)}/issues` body `{ id: linkedId }`; return `Link "<linkType>" set between <sourceIssueId> and <targetIssueId>`.
    Assert exact URLs, methods, bodies for each; assert `resolveTagByName` throws on 0/ambiguous; assert `setTags` computes the add/delete diff (e.g. current `[{id:'t1',name:'a'}]`, desired `['a','b']` → resolves+POSTs `b`, no DELETE; desired `[]` → DELETEs `t1`). Run → FAIL, implement `write-client.ts`, → PASS.
- [ ] typecheck + FULL lint + knip (add `"plugins/mcp-youtrack/write-client.ts": ["files"]` ignore — consumed by index in Task 6) + duplicates. Commit: `feat(mcp-youtrack): write client tag + link operations`.

## Task 5: `YouTrackWriteClient` — issue create + update

**Files:** extend `plugins/mcp-youtrack/write-client.ts`, extend `tests/plugins/mcp-youtrack-writes.test.ts`.

- [ ] Failing tests. Add methods:
  - `private async resolveProjectId(project): Promise<string>` — if `/^\d+(-\d+)?$/u.test(project)` → project; else `const p = await getJson(/admin/projects/{enc(project)}?fields=id)`; return `stringOr(p.id)` (throw `Project not found: <project>` if absent).
  - `private async resolveFieldTypes(issueId): Promise<Map<string,{name:string;type:string}>>` — `GET /issues/{enc(issueId)}?fields=customFields(name,$type)`; build `Map<lowercased name, { name, type: $type }>`.
  - `createIssue({ project, summary, description?, customFields?, referenceIssueId? })` → `const projectId = await resolveProjectId(project)`; `const body = { project: { id: projectId }, summary }`; if description → `body.description = description`; if customFields present → if referenceIssueId → `const types = await resolveFieldTypes(referenceIssueId)`; build `body.customFields = Object.entries(customFields).map(([name,value]) => { const t = types.get(name.toLowerCase()); return t ? { name: t.name, $type: t.type, value: buildCustomFieldValue(t.type, value) } : { name, value } })`; else `body.customFields = Object.entries(customFields).map(([name,value]) => ({ name, value }))`; `POST /issues?fields=${ISSUE_FIELDS}` body → shaped issue; if `shaped.summary !== summary` → `POST /issues/{enc(shaped.idReadable)}` body `{ summary }` (force), set `shaped.summary = summary`; return the shaped issue.
  - `updateFields(issueId, fields)` → throw `No fields to update` if empty; `const types = await resolveFieldTypes(issueId)`; for each `[name, value]`: `const t = types.get(name.toLowerCase())`; throw `Unknown field: <name>` (list available names) if absent; build `{ name: t.name, $type: t.type, value: buildCustomFieldValue(t.type, value) }`; `POST /issues/{enc(issueId)}?fields=${ISSUE_FIELDS}` body `{ customFields: [...] }` → shaped issue.
    Assert: project short-name resolution vs numeric id; `updateFields` throws on unknown field name; the POST body's customFields entries use the resolved `$type` + `buildCustomFieldValue` output; the create summary-fixup fires when the server returns a different summary. Run → FAIL, implement, → PASS.
- [ ] typecheck + FULL lint + knip + duplicates. If `write-client.ts` exceeds `max-lines` (300), split the issue methods into a helper module (e.g. `write-client-issues.ts`) that the class delegates to, or split the class — do NOT game the limit. Commit: `feat(mcp-youtrack): write client issue create + update`.

## Task 6: Register the 6 write tools in `index.ts`

- [ ] Failing tests (extend `tests/plugins/mcp-youtrack-writes.test.ts` with a `describe('mcp-youtrack write plugin', …)`): activate now registers 14 tools (assert the 6 new names present); `youtrack_add_issue_tag` with mock httpFetch → returns the confirmation; `youtrack_create_issue` → returns shaped issue; missing creds → `not_configured`; a write tool with rate-limit → `rate_limited`. Update the EXISTING `tests/plugins/mcp-youtrack.test.ts` "registers exactly 8 tools" assertion to 14 (or move it — keep one authoritative count).
- [ ] Implement: in `index.ts`, add a `buildWriteToolDefinitions(getHttpFetch)` (new function, to respect `max-lines-per-function`) that constructs a `YouTrackWriteClient` per execute and registers the 6 write tools, each with: rate-limit → read `base_url` via `adminConfig.get`, `token` via `contextConfig.get` → `not_configured` if missing → narrow input (create_issue: project/summary required, description/referenceIssueId optional strings, customFields optional record; update_fields: issueId required + fields required record; tags: issueId + tagName/tags; link: 4 required + direction) → call the write client → return. try/catch mapping as the read tools. Concise WRITE descriptions (note these mutate YouTrack). NO redaction (bridge handles it). Merge the read + write tool definition arrays in `activate`.
  - Input narrowing for `customFields`/`fields` (a `Record<string, FieldValue>`) and `tags` (`string[]`): add `readRecord(input, key)` and `readStringArray(input, key)` helpers with `isRecord`/`Array.isArray` guards (no `as`); values inside customFields/fields are `unknown` and passed to the client which passes them to `buildCustomFieldValue` (which `String()`s / guards them) — keep the plugin-side type honest as `Record<string, unknown>` → the client method accepts `Record<string, unknown>`.
- [ ] Test → PASS; `bun test tests/plugins/` green; typecheck + FULL lint + knip: REMOVE the `format-writes.ts` + `write-client.ts` `["files"]` ignores (now reached from index). Must be clean. Commit: `feat(mcp-youtrack): register 6 write tools (14 total)`.

## Task 7: Docs + verification + gate

- [ ] Update `plugins/mcp-youtrack/README.md`: move the 6 tools out of the "part 2 deferred" section into the tools table (now 14); note each write tool's operator policy guidance (`ask` default; `set_issue_link` → consider `deny`); remove/soften the "part 1 of 2" framing (now complete).
- [ ] Update `tests/mcp-server/mcp-youtrack-listing.test.ts` to assert all **14** tools are listed (was 8). Run → PASS.
- [ ] Update `docs/architecture/coding-stack-overview.md`'s `mcp-youtrack` mention (now full 14 tools; drop the "part 1" note).
- [ ] `bun run check:full` → 12/12 green (flake caveat: standalone `bun test`, free port 9100). Commit: `feat(mcp-youtrack): complete 14-tool parity — docs + verification`.

---

## Self-review (plan author)

- **Coverage:** all 6 write tools; the pure crux logic (`buildCustomFieldValue`/`fieldTypeToValueType`/`findIssueLink`) isolated + heavily tested (Task 2); shared HTTP requester extracted to avoid `max-lines`/duplication (Task 3); tag+link writes (Task 4) and issue create/update (Task 5) split for tractability; registration (Task 6) + verification (Task 7).
- **Deviations (documented):** confirmation strings are English; `set_tags` re-fetch of the full issue (kiss did, then discarded) is skipped — return the confirmation directly; the `referenceIssueId`-less `create_issue` custom-field path uses the simplified `{name,value}` (matches kiss).
- **Risks:** (1) `buildCustomFieldValue` is the highest-risk logic — Task 2's tests must cover every branch (single/multi enum, user login, period number vs string, text, simple passthrough, null). (2) The `http.ts` refactor (Task 3) must preserve behavior — existing read tests are the safety net. (3) `max-lines` on `write-client.ts` (Task 5) — split if needed. (4) The listing + unit tool-count assertions change 8→14 (Tasks 6/7).
- **Placeholders:** none — every endpoint, body, and helper is specified; extends the committed Plan 8 plugin.

## Follow-ups (carried)

per-plugin/per-tool redaction-prompt override (youtrack's attachment prompt), `mcp_redaction` settings-UI + unset, `abortSignal` threading, figma full-simplify + token pooling, teamcity envelope flattening, mattermost binary attachments, gitlab write tools + full pagination, the dead `key==='key'` branch in `mcp-sentry/format.ts`; magi-side `npm_publish` + the `ask` fail-open fix.

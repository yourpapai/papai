<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 4: `mcp-teamcity` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `mcp-teamcity` — agent-facing TeamCity CI tools (list projects, read project config, list a project's pipelines/build-types, read a build-type config) exposed as an MCP server for coding agents.

**Architecture:** A native papai plugin of the shape proven by `plugins/mcp-sentry/` (closest match: Bearer auth, admin-scoped creds, GET-only reads). `mcpServer: true` at `/mcp/plugin/mcp-teamcity`. **No AI redaction** (`mcpResponseRedaction` unset — matches kiss). Instead a **security-critical static sanitizer** redacts secret-bearing config properties (see below). Auth is `Authorization: Bearer <token>`; base is `{base_url}/app/rest`.

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies.

## Reference & carried process rules (Plans 1–3)

Read `plugins/mcp-sentry/` and `plugins/mcp-confluence/` first. Carry:

- Before EVERY commit run the FULL `bun run lint` and `bun run knip` (type-aware oxlint rules — `strict-boolean-expressions`, `require-unicode-regexp`, `no-misused-spread`, `no-conditional-in-test`, `no-unsafe-*` — only surface in the full run / CI). No lint-disables. Narrow `unknown` with `isRecord` guards, never `as`; never test truthiness of `unknown`; `u` flag on regexes.
- SPDX header on every `.ts`; `.js` sibling imports; `encodeURIComponent` every caller-supplied URL path segment; encode query values.
- knip traverses only from entry points (`plugins/*/index.ts`): add a `["files"]` ignore per new-but-unconsumed plugin file, and REMOVE those in the tool-registration task once `index.ts` reaches them (KEEP the `index.ts": ["exports"]` entry ignore).
- `bunx oxfmt` ONLY changed files (revert incidental CHANGELOG.md reformats).
- `check:full`'s `test` step is `bun test --parallel` and flakes under machine contention — if `test` fails but standalone `bun test` passes, it's an environment flake (check `lsof -ti :9100`), not a code bug.

## SECURITY: the static property sanitizer (this plan's crux)

TeamCity build/VCS/step/parameter configs routinely embed secrets as `{ name, value }` properties (e.g. `env.DEPLOY_TOKEN`, `secure:password`). kiss redacts these at the mapping layer; since this plugin has **no** bridge AI redaction, the sanitizer is the ONLY secret protection and MUST be correct. Port it as a RECURSIVE walk (catches secrets at any depth, more robust than kiss's per-array mapping):

`sanitizeTeamCityConfig(value: unknown): unknown` (in `format.ts`):

- `SECRET_PROP = /password|token|secret|key|credential/iu`.
- Recurse: arrays → map recurse; records → for each entry recurse; PLUS a special case — if a record has a string `name` matching `SECRET_PROP` AND owns a `value` key whose value is truthy, replace that `value` with `'[REDACTED]'` (keep `name`; still recurse siblings). Primitives → returned as-is. Use `isRecord`/`Array.isArray`; no `as` on `unknown`; return a NEW structure (don't mutate input).
- Applied by the client to the two CONFIG tools' responses (project config, build-type config). The two LIST tools (`projects`, `buildTypes`) return only id/name/url/description/paused/archived — no secret fields — so they need no sanitization, but applying the sanitizer to them is harmless if simpler; the plan applies it ONLY to the two config tools to match kiss.

Tests MUST cover: a secret property nested deep inside `steps[].properties.property[]` / `vcs-root-entries[...]/properties/property[]` / top-level `parameters.property[]` gets `'[REDACTED]'`; a non-secret property (`name: 'system.teamcity.buildType'`) is untouched; a falsy `value` under a secret name is left as-is; `name`/other fields are preserved.

## TeamCity API facts (source: kiss `mcp/teamcity-mcp/`)

- **Auth:** `Authorization: Bearer <token>`, `Accept: application/json`.
- **Base:** `{base_url}/app/rest` (base_url trailing-slash trimmed; admin-scoped config, self-hosted → `providerAllowedHostsFromConfig: ["base_url"]`).
- **Request helper** `request(path): Promise<unknown>`: `httpFetch(`${baseUrl}/app/rest${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })`; non-2xx → throw `TeamCity API <status> for <path>`.
- **Locators:** `id:<value>` form; `fields=` uses TeamCity partial-response syntax (comma-separated, nested via parens). `encodeURIComponent` the locator value AND the `fields` string.

Field constants (copy verbatim):

- `PROJECTS_LIST_FIELDS = 'project(id,name,parentProjectId,archived,webUrl,description)'`
- `PROJECT_FIELDS = 'id,name,parentProjectId,archived,webUrl,description,projects(project(id,name,parentProjectId,archived,webUrl,description)),buildTypes(buildType(id,name,projectId,webUrl,paused,description)),parameters(property(name,value))'`
- `BUILD_TYPES_LIST_FIELDS = 'buildType(id,name,projectId,webUrl,paused,description)'`
- `BUILD_TYPE_FIELDS = 'id,name,projectId,projectName,webUrl,paused,description,templates(buildType(id,name,projectId,webUrl)),vcs-root-entries(vcs-root-entry(id,checkout-rules,vcs-root(id,name,href,projectId,properties(property(name,value))))),steps(step(id,name,type,disabled,properties(property(name,value)))),triggers(trigger(id,type,disabled,properties(property(name,value)))),features(feature(id,type,disabled,properties(property(name,value)))),artifact-dependencies(artifact-dependency(id,type,disabled,properties(property(name,value)))),snapshot-dependencies(snapshot-dependency(id,type,disabled,source-buildType(id,name,projectId,webUrl),properties(property(name,value)))),parameters(property(name,value))'`

**The 4 tools:**

| Tool                             | Input                           | HTTP                                                                                 | Result                               |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `teamcity_get_projects`          | `{}` (none)                     | `GET /projects?fields={enc(PROJECTS_LIST_FIELDS)}`                                   | `data.project ?? []` (no sanitize)   |
| `teamcity_get_project_config`    | `{ projectId: string (req) }`   | `GET /projects/id:{enc(projectId)}?fields={enc(PROJECT_FIELDS)}`                     | `sanitizeTeamCityConfig(data)`       |
| `teamcity_get_project_pipelines` | `{ projectId: string (req) }`   | `GET /projects/id:{enc(projectId)}/buildTypes?fields={enc(BUILD_TYPES_LIST_FIELDS)}` | `data.buildType ?? []` (no sanitize) |
| `teamcity_get_pipeline_config`   | `{ buildTypeId: string (req) }` | `GET /buildTypes/id:{enc(buildTypeId)}?fields={enc(BUILD_TYPE_FIELDS)}`              | `sanitizeTeamCityConfig(data)`       |

**Deviation from kiss (documented):** we do NOT reproduce kiss's camelCase envelope-flattening (`vcs-root-entries` → `vcsRootEntries`, `{project:[]}` unwrapping inside configs, etc.). The `fields=` param already trims the response to the useful subset; the agent receives the (sanitized) TeamCity JSON as-is. The list tools DO unwrap the top-level `{project:[]}`/`{buildType:[]}` envelope to a flat array (cheap, matches kiss). Flattening the config envelopes is a cosmetic follow-up.

## File structure

```
plugins/mcp-teamcity/
  plugin.json     # mcpServer:true (NO mcpResponseRedaction), http, providerAllowedHostsFromConfig:["base_url"], admin base_url+token
  context.ts      # mcp-sentry/context.ts copy (adminConfig only — teamcity is admin-scoped)
  input-schema.ts # 4 JSON-Schema objects
  format.ts       # sanitizeTeamCityConfig + arrayOr/unwrap helper
  client.ts       # TeamCityClient (Bearer, 4 methods, fields params)
  index.ts        # factory registering 4 tools
  README.md
tests/plugins/mcp-teamcity.test.ts          # sanitizer + client + plugin blocks
tests/plugins/mcp-teamcity-schema.test.ts   # structural schema tests
tests/mcp-server/mcp-teamcity-listing.test.ts
```

---

## Task 1: Manifest + context facade

**Files:** `plugins/mcp-teamcity/plugin.json`, `plugins/mcp-teamcity/context.ts`, placeholder `plugins/mcp-teamcity/index.ts`.

- [ ] **Step 1:** Copy `plugins/mcp-confluence/context.ts` → `plugins/mcp-teamcity/context.ts` VERBATIM (admin-scoped — the `adminConfig`-only Like type is correct; do NOT add `contextConfig`).
- [ ] **Step 2:** Create `plugins/mcp-teamcity/plugin.json`:

```json
{
  "id": "mcp-teamcity",
  "name": "TeamCity (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing TeamCity project/pipeline config tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "contributes": {
    "tools": [
      "teamcity_get_projects",
      "teamcity_get_project_config",
      "teamcity_get_project_pipelines",
      "teamcity_get_pipeline_config"
    ],
    "promptFragments": [],
    "configKeys": []
  },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "TeamCity Base URL", "required": true, "scope": "admin" },
    { "key": "token", "label": "TeamCity API Token", "required": true, "sensitive": true, "scope": "admin" }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] **Step 3:** Placeholder `index.ts` (license header, factory `requirePluginContext(ctx)` + logging, NO tools) — mirror the mc-confluence scaffold.
- [ ] **Step 4:** Add `"plugins/mcp-teamcity/index.ts": ["exports"]` to `knip.jsonc`. Validate manifest parses (throwaway `pluginManifestSchema.parse`, then delete). `bun test tests/plugins/discovery.test.ts` green. typecheck + FULL lint + knip clean.
- [ ] **Step 5:** Commit: `feat(mcp-teamcity): plugin manifest and context facade`.

## Task 2: Input schemas

**Files:** `plugins/mcp-teamcity/input-schema.ts`, `tests/plugins/mcp-teamcity-schema.test.ts`.

- [ ] **Step 1:** Failing structural schema tests: `teamcityGetProjectsSchema` has NO required (empty object, `additionalProperties:false`); the other three each require one string (`projectId`, `projectId`, `buildTypeId`). Run → FAIL.
- [ ] **Step 2:** Create `input-schema.ts` — 4 `as const` objects:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const teamcityGetProjectsSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

export const teamcityGetProjectConfigSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', minLength: 1, description: 'TeamCity project id, e.g. "MyProject" or "_Root"' },
  },
  required: ['projectId'],
  additionalProperties: false,
} as const

export const teamcityGetProjectPipelinesSchema = {
  type: 'object',
  properties: { projectId: { type: 'string', minLength: 1, description: 'TeamCity project id' } },
  required: ['projectId'],
  additionalProperties: false,
} as const

export const teamcityGetPipelineConfigSchema = {
  type: 'object',
  properties: {
    buildTypeId: { type: 'string', minLength: 1, description: 'TeamCity build configuration (pipeline) id' },
  },
  required: ['buildTypeId'],
  additionalProperties: false,
} as const
```

- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (add `["files"]` ignore for `input-schema.ts` if flagged). Commit: `feat(mcp-teamcity): tool input schemas`.

## Task 3: Static sanitizer (`format.ts`) — SECURITY-CRITICAL

**Files:** `plugins/mcp-teamcity/format.ts`, `tests/plugins/mcp-teamcity.test.ts`.

- [ ] **Step 1:** Failing tests for `sanitizeTeamCityConfig`:
  - Deep-nested secret: `{ steps: { step: [ { properties: { property: [ { name:'env.SECRET_TOKEN', value:'abc' }, { name:'system.foo', value:'ok' } ] } } ] } }` → the `env.SECRET_TOKEN` value becomes `'[REDACTED]'`; `system.foo` value stays `'ok'`; `name`s preserved.
  - Secret regex hits: `name` = `password`, `apiToken`, `db.secret`, `ssh_key`, `credential` → redacted; `name` = `buildNumber`, `system.teamcity.version` → untouched.
  - Falsy secret value: `{ name:'token', value:'' }` → left `''` (not redacted). `{ name:'token' }` (no value) → untouched.
  - Top-level `{ parameters: { property: [ {name:'secret.x', value:'y'} ] } }` → redacted.
  - Input NOT mutated (assert the original object still has the plaintext).
  - Non-record input (`null`, `'x'`, `42`, arrays of primitives) → returned equal, no throw.
    Run → FAIL.
- [ ] **Step 2:** Implement `format.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1 ... (header)

const SECRET_PROP = /password|token|secret|key|credential/iu

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeTeamCityConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeTeamCityConfig(item))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  const name = value['name']
  const isSecret = typeof name === 'string' && SECRET_PROP.test(name)
  for (const [key, v] of Object.entries(value)) {
    if (isSecret && key === 'value' && v !== undefined && v !== null && v !== false && v !== '' && v !== 0) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = sanitizeTeamCityConfig(v)
    }
  }
  return out
}
```

- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (ignore for `format.ts` if flagged). Commit: `feat(mcp-teamcity): security-critical config property sanitizer`.

## Task 4: `TeamCityClient`

**Files:** `plugins/mcp-teamcity/client.ts`, extend `tests/plugins/mcp-teamcity.test.ts`.

- [ ] **Step 1:** Failing client tests (mock httpFetch, capture URL + headers). Construct `{ baseUrl:'https://tc.test', token:'tok', httpFetch }`. Assert:
  - `getProjects()` → `GET https://tc.test/app/rest/projects?fields=project(id%2Cname...)` (fields encoded); header `Authorization:'Bearer tok'`, `Accept:'application/json'`; returns `data.project ?? []` (mock `{project:[{id:'A'}]}` → `[{id:'A'}]`; `{}` → `[]`).
  - `getProjectConfig('MyProj')` → URL `.../app/rest/projects/id:MyProj?fields=...`; a mocked response with a secret property `{name:'secret.x',value:'zzz'}` comes back `'[REDACTED]'` (sanitizer applied).
  - `getProjectBuildTypes('MyProj')` → `.../projects/id:MyProj/buildTypes?fields=...` → `data.buildType ?? []`.
  - `getBuildTypeConfig('Bt_1')` → `.../buildTypes/id:Bt_1?fields=...`; secret in `steps.step[].properties.property[]` redacted.
  - locator/path injection: `getProjectConfig('../../x')` → `id:` value encoded (URL stays under `/app/rest/projects/`).
  - non-2xx → throws.
- [ ] **Step 2:** Implement `client.ts`. `TeamCityClient` ctor `{ baseUrl, token, httpFetch }` (baseUrl trailing-slash trimmed). Private `request(path)` with the two headers, throws `TeamCity API <status> for <path>` on non-ok. The 4 field constants as module consts. Methods per the table; config tools return `sanitizeTeamCityConfig(json)`; list tools return the unwrapped array (`isRecord(json) && Array.isArray(json.project) ? json.project : []`, etc.). `encodeURIComponent` locator values + `fields` strings. Narrow `unknown` with guards.
- [ ] **Step 3:** Test → PASS. typecheck + FULL lint + knip (remove `format.ts` ignore now consumed; add `client.ts` `["files"]` ignore until Task 5 — note knip only reaches files from `index.ts`, so BOTH `format.ts` and `client.ts` stay ignored until Task 5). Commit: `feat(mcp-teamcity): TeamCity client (Bearer, field selection)`.

## Task 5: Tool registration (`index.ts`)

**Files:** replace placeholder `plugins/mcp-teamcity/index.ts`; extend `tests/plugins/mcp-teamcity.test.ts`.

- [ ] **Step 1:** Failing plugin tests (mirror the mc-confluence plugin block; admin creds via `adminConfig.get`): activate registers exactly 4 tools; `teamcity_get_projects` with mock httpFetch returns the project array; missing creds (`adminConfig.get` → undefined for `base_url`/`token`) → `{ error:'not_configured', message:'TeamCity is not configured' }`; rate-limited → `{ error:'rate_limited', retryAfterSec }`; httpFetch throws non-abort → `{ error:'teamcity_error', message }`. Run → FAIL.
- [ ] **Step 2:** Implement the factory (mirror `plugins/mcp-confluence/index.ts`): `activate` reads `providerRuntime.httpFetch`; `buildToolDefinitions(getHttpFetch)`; each `execute`: rate-limit → read `base_url`/`token` via `runtimeContext.adminConfig.get(...)` → `not_configured` if missing or httpFetch undefined → narrow `input` (get_projects has NO input; others one required string via `readRequiredString`) → `new TeamCityClient({ baseUrl: base_url, token, httpFetch })` → call → return. try/catch: `AbortError`→`timeout`, `ValidationError`→`validation_error`, else `teamcity_error`. Concise descriptions. NO redaction here (no manifest flag).
- [ ] **Step 3:** Test → PASS; `bun test tests/plugins/` green. typecheck + FULL lint + knip: REMOVE `input-schema.ts`/`format.ts`/`client.ts` `["files"]` ignores; KEEP `index.ts": ["exports"]`. Commit: `feat(mcp-teamcity): register 4 TeamCity tools`.

## Task 6: README + verification + docs + gate

**Files:** `plugins/mcp-teamcity/README.md`, `tests/mcp-server/mcp-teamcity-listing.test.ts`, edit `docs/architecture/coding-stack-overview.md`.

- [ ] **Step 1:** README (mirror mc-confluence): purpose, 4-tools table, admin config (`base_url`, `token` sensitive), Bearer auth, and a prominent **"Secret handling"** section: no AI redaction; a static property sanitizer redacts `{name,value}` config properties whose name matches `password|token|secret|key|credential` — note this is the only secret protection and covers TeamCity's structured secret fields.
- [ ] **Step 2:** `tests/mcp-server/mcp-teamcity-listing.test.ts` mirroring the mc-confluence listing test: discover → activate → `listPluginMcpTools('mcp-teamcity')` resolves the 4 named tools each with `inputSchema`; empties after deactivate. Run → PASS.
- [ ] **Step 3:** Add `mcp-teamcity` to the migrated-plugins mention in `docs/architecture/coding-stack-overview.md` (4 TeamCity tools, Bearer, static-sanitizer-only).
- [ ] **Step 4:** `bun run check:full` → 12/12 green (if `test` flakes, re-run standalone `bun test`; free port 9100). Commit: `feat(mcp-teamcity): README, listing verification, docs`.

---

## Self-review (plan author)

- **Coverage:** all 4 kiss teamcity tools; Bearer + admin creds; the security-critical recursive sanitizer (Task 3) applied to the two config tools (Task 4); verification (Task 6).
- **Deviations (documented):** (a) recursive sanitizer instead of kiss's per-array mapping — strictly safer (any-depth); (b) config envelopes NOT flattened to camelCase (cosmetic; `fields=` already trims); (c) list tools unwrap the top-level array (matches kiss); (d) no AI redaction (matches kiss — static sanitizer only).
- **Risk:** the sanitizer is the ONLY secret protection — Task 3's tests must prove deep-nesting coverage and non-mutation; Task 4 must prove the client actually applies it to BOTH config tools. Emphasized.
- **Placeholders:** none — full sanitizer code, exact field constants, endpoints, and test assertions provided; client/index reference the committed mc-confluence/mc-sentry template.

## Follow-ups (this plan + carried)

- **Config envelope flattening** (camelCase, unwrap nested `{property:[]}`) — deferred cosmetic.
- Carried: per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset, `abortSignal` threading in plugin clients, figma full-simplify + token pooling, the dead `key==='key'` branch in `mcp-sentry/format.ts`.

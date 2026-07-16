<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Feature Parity — Plan F3: `mcp-teamcity` Config-Envelope Flattening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Flatten TeamCity's nested single-child envelopes (`parameters:{property:[…]}`, `steps:{step:[…]}`, `vcs-root-entries:{vcs-root-entry:[…]}`, …) into flat camelCase arrays in the shaped output of `getProjectConfig`/`getBuildTypeConfig`, matching kiss's cleaner shape — **without weakening the security-critical secret redaction**.

**Architecture:** Add a pure, recursive `flattenTeamCity(value)` to `plugins/mcp-teamcity/format.ts` driven by two small lookup tables (envelope-key → inner-array-key, and hyphenated-key → camelCase rename). The client applies it **after** the existing `sanitizeTeamCityConfig` — `flattenTeamCity(sanitizeTeamCityConfig(json))` — so the redactor still runs over the exact raw nested shape it was designed for, and flattening is a pure structural transform over already-redacted data. The leaf `{name,value}` pairs are preserved through flattening, so `[REDACTED]` values survive.

**Tech Stack:** Bun + `bun:test`; TypeScript strict, `.js` imports; no new dependencies. Cosmetic output improvement; no magi/geofront changes; no schema/tool changes.

**Source of truth:** kiss `mcp/teamcity-mcp/client.ts` `mapProject`/`mapBuildType` (lines 187–249) for the exact envelope→field mapping and camelCase renames. Reference only — the generic papai port below is authoritative.

> **RAG `top_k` is dropped (YAGNI).** The roadmap flagged RAG result-count control as a _new_ feature (not kiss parity); no concrete demand exists, so F3 is TeamCity-only. If demand appears later, it's a separate small plan.

---

## Reference & carried process rules

Read `plugins/mcp-teamcity/` for the current shape. Carry the fleet's rules:

- FULL `bun run lint` + `bun run knip` before EVERY commit.
- SPDX headers; `.js` import extensions; no lint-disable / type-ignore.
- **No `as` on `unknown`** — use the `isRecord` guard (already in `format.ts`).
- **`strict-boolean-expressions`:** compare explicitly (`inner !== undefined`); `noUncheckedIndexedAccess` — `TC_ENVELOPES[key]` is `string | undefined`, `TC_RENAMES[key] ?? key`.
- **`no-inline-comments`:** comments on their own line.
- **No bare-module imports in plugin code** (they break plugin discovery — this bit F2). This plan adds none; keep it that way.
- `max-lines` 300/file, 50/function.
- `bunx oxfmt` changed files before each commit. Free port 9100 before test runs: `lsof -ti :9100 | xargs kill -9` (ignore "no such process").

## Security invariant (do NOT regress)

`plugins/mcp-teamcity/format.ts` `sanitizeTeamCityConfig` is the ONLY secret protection for this plugin (no AI redaction). It recursively redacts the `value` of any `{ name, value }` pair whose `name` matches `/password|token|secret|key|credential/iu`. F3 MUST keep it running and its `[REDACTED]` output MUST survive flattening. The pipeline order is fixed: **sanitize first, then flatten** (`flattenTeamCity(sanitizeTeamCityConfig(json))`). Task 1 includes an explicit end-to-end regression test proving a secret param comes out both flattened AND redacted.

## Contract change (cosmetic, intentional)

`getProjectConfig` / `getBuildTypeConfig` now return flattened camelCase shapes:

- `parameters: { property: [{name,value}] }` → `parameters: [{name,value}]`
- `projects: { project: [...] }` → `projects: [...]`; `buildTypes: { buildType: [...] }` → `buildTypes: [...]`; `templates: { buildType: [...] }` → `templates: [...]`; `steps`/`triggers`/`features` likewise
- `vcs-root-entries: { vcs-root-entry: [...] }` → `vcsRootEntries: [...]`; inner `checkout-rules` → `checkoutRules`, `vcs-root` → `vcsRoot`
- `artifact-dependencies` → `artifactDependencies`; `snapshot-dependencies` → `snapshotDependencies`; inner `source-buildType` → `sourceBuildType`

`getProjects`/`getProjectBuildTypes` are UNCHANGED (they already return flat summary arrays via `arrayOr`, with no nested envelopes). Existing config-shape tests are updated in Task 2.

## File structure

```
plugins/mcp-teamcity/
  format.ts   # ADD flattenTeamCity + TC_ENVELOPES/TC_RENAMES tables; sanitizeTeamCityConfig UNCHANGED
  client.ts   # getProjectConfig/getBuildTypeConfig: wrap sanitize result in flattenTeamCity
  README.md   # note the flattened output shape
tests/plugins/
  mcp-teamcity-flatten.test.ts   # NEW: flatten unit tests + redaction-survives-flatten regression
  mcp-teamcity.test.ts           # MODIFY: config assertions → flattened shape
docs/architecture/coding-stack-overview.md  # note teamcity output flattening
```

---

## Task 1: `flattenTeamCity` (pure) + unit tests incl. security regression

**Files:** `plugins/mcp-teamcity/format.ts`, `tests/plugins/mcp-teamcity-flatten.test.ts` (new).

- [ ] **Step 1: Write failing tests** — `tests/plugins/mcp-teamcity-flatten.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flattenTeamCity, sanitizeTeamCityConfig } from '../../plugins/mcp-teamcity/format.js'

describe('flattenTeamCity', () => {
  test('unwraps parameters {property:[…]} into a flat array', () => {
    const raw = { id: 'P', parameters: { count: 2, property: [{ name: 'a', value: '1' }] } }
    expect(flattenTeamCity(raw)).toEqual({ id: 'P', parameters: [{ name: 'a', value: '1' }] })
  })

  test('unwraps projects/buildTypes/templates envelopes', () => {
    const raw = {
      id: 'P',
      projects: { project: [{ id: 'c1' }] },
      buildTypes: { buildType: [{ id: 'b1' }] },
    }
    expect(flattenTeamCity(raw)).toEqual({ id: 'P', projects: [{ id: 'c1' }], buildTypes: [{ id: 'b1' }] })
  })

  test('renames + flattens vcs-root-entries with nested vcs-root properties', () => {
    const raw = {
      'vcs-root-entries': {
        'vcs-root-entry': [
          {
            id: 'e1',
            'checkout-rules': '+:.',
            'vcs-root': { id: 'r1', properties: { property: [{ name: 'url', value: 'git@x' }] } },
          },
        ],
      },
    }
    expect(flattenTeamCity(raw)).toEqual({
      vcsRootEntries: [
        { id: 'e1', checkoutRules: '+:.', vcsRoot: { id: 'r1', properties: [{ name: 'url', value: 'git@x' }] } },
      ],
    })
  })

  test('renames artifact/snapshot dependencies + inner source-buildType', () => {
    const raw = {
      'artifact-dependencies': { 'artifact-dependency': [{ id: 'a1', properties: { property: [] } }] },
      'snapshot-dependencies': {
        'snapshot-dependency': [{ id: 's1', 'source-buildType': { id: 'b0' }, properties: { property: [] } }],
      },
    }
    expect(flattenTeamCity(raw)).toEqual({
      artifactDependencies: [{ id: 'a1', properties: [] }],
      snapshotDependencies: [{ id: 's1', sourceBuildType: { id: 'b0' }, properties: [] }],
    })
  })

  test('empty/missing envelope becomes an empty array', () => {
    expect(flattenTeamCity({ parameters: { count: 0 } })).toEqual({ parameters: [] })
    expect(flattenTeamCity({ steps: {} })).toEqual({ steps: [] })
  })

  test('passes through scalars, non-envelope objects, and arrays', () => {
    expect(flattenTeamCity({ id: 'P', name: 'n', archived: false })).toEqual({ id: 'P', name: 'n', archived: false })
    expect(flattenTeamCity('x')).toBe('x')
    expect(flattenTeamCity([{ id: 'a' }])).toEqual([{ id: 'a' }])
  })

  test('SECURITY: redaction survives flattening (sanitize then flatten)', () => {
    const raw = {
      id: 'P',
      parameters: {
        property: [
          { name: 'env.DEPLOY_TOKEN', value: 'sekret' },
          { name: 'harmless', value: 'ok' },
        ],
      },
    }
    const out = flattenTeamCity(sanitizeTeamCityConfig(raw))
    expect(out).toEqual({
      id: 'P',
      parameters: [
        { name: 'env.DEPLOY_TOKEN', value: '[REDACTED]' },
        { name: 'harmless', value: 'ok' },
      ],
    })
  })
})
```

- [ ] **Step 2: Run** `bun test tests/plugins/mcp-teamcity-flatten.test.ts` → FAIL (`flattenTeamCity` missing).

- [ ] **Step 3: Add `flattenTeamCity` to `plugins/mcp-teamcity/format.ts`** (append after `sanitizeTeamCityConfig`; do NOT modify `sanitizeTeamCityConfig` or `SECRET_PROP` or the existing `isRecord`). Reuse the existing module-level `isRecord`.

```typescript
// TeamCity's REST API wraps every collection in a single-child envelope
// (e.g. parameters -> { property: [...] }) and uses hyphenated keys. These
// tables drive flattenTeamCity: envelope key -> inner array key, and
// hyphenated key -> camelCase rename. Purely cosmetic; runs AFTER redaction.
const TC_ENVELOPES: Record<string, string> = {
  parameters: 'property',
  properties: 'property',
  projects: 'project',
  buildTypes: 'buildType',
  templates: 'buildType',
  steps: 'step',
  triggers: 'trigger',
  features: 'feature',
  'vcs-root-entries': 'vcs-root-entry',
  'artifact-dependencies': 'artifact-dependency',
  'snapshot-dependencies': 'snapshot-dependency',
}

const TC_RENAMES: Record<string, string> = {
  'vcs-root-entries': 'vcsRootEntries',
  'vcs-root': 'vcsRoot',
  'checkout-rules': 'checkoutRules',
  'artifact-dependencies': 'artifactDependencies',
  'snapshot-dependencies': 'snapshotDependencies',
  'source-buildType': 'sourceBuildType',
}

function unwrapTeamCityEnvelope(key: string, value: unknown): unknown {
  const inner = TC_ENVELOPES[key]
  if (inner === undefined || !isRecord(value)) return flattenTeamCity(value)
  const arr = value[inner]
  if (Array.isArray(arr)) return arr.map((item) => flattenTeamCity(item))
  return []
}

export function flattenTeamCity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => flattenTeamCity(item))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    const outKey = TC_RENAMES[key] ?? key
    out[outKey] = unwrapTeamCityEnvelope(key, v)
  }
  return out
}
```

> Note the mutual reference: `unwrapTeamCityEnvelope` calls `flattenTeamCity` and vice-versa. Because `flattenTeamCity` is a hoisted `function` declaration, ordering doesn't matter — but keep both as `function` declarations (not `const` arrows) so hoisting applies.

- [ ] **Step 4: Run** `bun test tests/plugins/mcp-teamcity-flatten.test.ts` → all PASS (7 tests). The SECURITY test is the key gate — confirm it passes.
- [ ] **Step 5: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` (new test imports `flattenTeamCity`/`sanitizeTeamCityConfig` from `format.ts`; both are now exported and consumed by the test + client in Task 2 — if knip flags `flattenTeamCity` as unused at THIS point because the client doesn't call it yet, add a temporary `"plugins/mcp-teamcity/format.ts": ["exports"]` ignore to `knip.jsonc` with a `// TEMP F3 T1: consumed by client.ts in Task 2` comment, removed in Task 2). `bunx oxfmt` changed files.
- [ ] **Step 6: Commit.**

```bash
git add plugins/mcp-teamcity/format.ts tests/plugins/mcp-teamcity-flatten.test.ts knip.jsonc
git commit -m "feat(mcp-teamcity): flattenTeamCity envelope-flattening transform"
```

---

## Task 2: wire into client + update config tests + README + docs + gate

**Files:** `plugins/mcp-teamcity/client.ts`, `tests/plugins/mcp-teamcity.test.ts`, `plugins/mcp-teamcity/README.md`, `docs/architecture/coding-stack-overview.md`, `knip.jsonc` (remove temp ignore if added).

- [ ] **Step 1: Update `plugins/mcp-teamcity/client.ts`.** Add `flattenTeamCity` to the `./format.js` import (currently `import { sanitizeTeamCityConfig } from './format.js'`). Change the two config methods so flattening runs AFTER sanitizing:

```typescript
  async getProjectConfig(projectId: string): Promise<unknown> {
    const json = await this.request(
      `/projects/id:${encodeURIComponent(projectId)}?fields=${encodeURIComponent(PROJECT_FIELDS)}`,
    )
    return flattenTeamCity(sanitizeTeamCityConfig(json))
  }
```

```typescript
  async getBuildTypeConfig(buildTypeId: string): Promise<unknown> {
    const json = await this.request(
      `/buildTypes/id:${encodeURIComponent(buildTypeId)}?fields=${encodeURIComponent(BUILD_TYPE_FIELDS)}`,
    )
    return flattenTeamCity(sanitizeTeamCityConfig(json))
  }
```

Leave `getProjects` and `getProjectBuildTypes` UNCHANGED (they use `arrayOr`, no envelopes to flatten).

- [ ] **Step 2: Remove the temporary knip ignore** for `plugins/mcp-teamcity/format.ts` if Task 1 added one (the client now consumes `flattenTeamCity`). Keep `"plugins/mcp-teamcity/index.ts": ["exports"]`.

- [ ] **Step 3: Update `tests/plugins/mcp-teamcity.test.ts`.** Any test that asserts the output of `getProjectConfig`/`getBuildTypeConfig` (client-level) or the `teamcity_get_project_config`/`teamcity_get_build_type_config` tools now expects the FLATTENED shape (`parameters: [...]`, `vcsRootEntries: [...]`, camelCase keys) instead of the nested-envelope shape. Method: run the file, read the actual flattened output from each failure diff, and lock it in as a full-object assertion (do NOT weaken to partial matches). **Verify at least one of these updated assertions still shows a secret value as `[REDACTED]`** — if none of the existing fixtures include a secret-named parameter, add a small fixture/case that does, so the plugin's redaction remains covered at the client/tool level (not only in the Task 1 unit test).

- [ ] **Step 4: Run** `lsof -ti :9100 | xargs kill -9` (ignore errors), then `bun test tests/plugins/mcp-teamcity.test.ts tests/plugins/mcp-teamcity-flatten.test.ts` → PASS.

- [ ] **Step 5: Update `plugins/mcp-teamcity/README.md`.** Add a short "Output shape" note: `teamcity_get_project_config` / `teamcity_get_build_type_config` return TeamCity's config with its single-child envelopes flattened into plain camelCase arrays (`parameters`, `steps`, `triggers`, `features`, `vcsRootEntries`, `artifactDependencies`, `snapshotDependencies`, …); secret-named parameters remain `[REDACTED]`. Match the README's existing tone.

- [ ] **Step 6: Update `docs/architecture/coding-stack-overview.md`** — find the `mcp-teamcity` mention and note the config output now flattens TeamCity's nested envelopes into camelCase (redaction preserved). Small, consistent edit.

- [ ] **Step 7: Full gate.** `lsof -ti :9100 | xargs kill -9`, then `bun run check:full` → 12/12 (if the `test` step flakes under contention, re-run standalone `bun test` to confirm environmental — do NOT run multiple `check:full`/`bun test --parallel` concurrently, that self-contends on port 9100). Listing/schema unchanged (`tests/mcp-server/mcp-teamcity-listing.test.ts`, `tests/plugins/mcp-teamcity-schema.test.ts` — tool set + schemas unchanged; only response bodies flattened). Commit:

```bash
git add plugins/mcp-teamcity/client.ts tests/plugins/mcp-teamcity.test.ts plugins/mcp-teamcity/README.md docs/architecture/coding-stack-overview.md knip.jsonc
git commit -m "feat(mcp-teamcity): flatten config envelopes in client output; docs"
```

---

## Self-review (plan author)

- **Spec coverage (F3):** envelope flattening + camelCase → Task 1 (`flattenTeamCity`) wired in Task 2. RAG `top_k` deliberately dropped (YAGNI), stated up front.
- **Security invariant:** pipeline is `flattenTeamCity(sanitizeTeamCityConfig(json))` — sanitize runs first over the proven raw shape; Task 1's SECURITY test and Task 2 Step 3's client/tool-level redaction check both guard that `[REDACTED]` survives flattening. `sanitizeTeamCityConfig` itself is untouched.
- **Type consistency:** `flattenTeamCity(value: unknown): unknown` and `unwrapTeamCityEnvelope(key: string, value: unknown): unknown`; both `function` declarations (mutual recursion via hoisting). Tables typed `Record<string, string>`; `noUncheckedIndexedAccess`-safe via `inner === undefined` / `TC_RENAMES[key] ?? key`.
- **Deliberate divergence from kiss:** kiss uses hand-written typed `mapProject`/`mapBuildType`; papai uses one generic table-driven `flattenTeamCity` (guard-based, no `as`) — same output shape, less code, and it degrades gracefully on unexpected shapes (unknown keys pass through, missing envelopes → `[]`).
- **Placeholders:** none — flatten code + tests are inline. Task 2 Step 3's "read the failure diff" applies only to updating existing config assertions to the flattened shape; the transform is fully unit-tested (incl. the security case) in Task 1.

## Follow-ups (this plan + carried)

- Carried (roadmap §5, deferred): per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset/DELETE, `abortSignal` threading, figma follow-ons, mattermost binary delivery (F5), gitlab write tools (F4), the dead `key === 'key'` branch in `mcp-sentry/format.ts`, and the magi-side `npm_publish` + `ask` fail-open fix.
- **Next in sequence:** F4 (GitLab write tools — gated on the papai/magi forge-write boundary decision, already recorded in the roadmap spec) or F5 (Mattermost binary delivery).

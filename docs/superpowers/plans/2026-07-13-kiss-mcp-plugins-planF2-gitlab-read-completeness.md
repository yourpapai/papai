<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Feature Parity — Plan F2: `mcp-gitlab` Read Completeness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the two GitLab read-side gaps: (1) the repository tree and MR list currently return only the FIRST page — add full multi-page fetching; (2) `gitlab_get_job` cannot take a full job URL — add `jobUrl` parsing.

**Architecture:** kiss delegates pagination to the `@gitbeaker` library (`all: true` auto-paginates). papai uses raw `providerRuntime.httpFetch`, so we implement page-following ourselves against GitLab's offset-pagination `x-total-pages` response header: fetch page 1, read `x-total-pages`, then fetch the remaining pages concurrently with a `p-limit`-bounded pool, hard-capped at `MAX_PAGES`. Truncation is surfaced **in-band** via a `capped: boolean` on the result (agent-visible — better than an operator-only log the agent can't see). `jobUrl` parsing is a pure function in `format.ts` ported from kiss's `parseJobUrl` regex.

**Tech Stack:** Bun + `bun:test`; TypeScript strict, `.js` imports; `p-limit@7.3.0` (already a dependency). Runs on the injected SSRF-validated `httpFetch`; no magi/geofront changes.

**Source of truth:** kiss `mcp/gitlab-mcp/client.ts` `parseJobUrl` (lines 162–176) for the URL regex; kiss `src/services/GitlabService.ts` `getMergeRequests`/`getRepositoryTree` for the `all`-pagination intent. Reference only — the papai port below is authoritative.

---

## Reference & carried process rules (Plans 1–9, F1)

Read `plugins/mcp-gitlab/` for the current shape. Carry the fleet's rules:

- FULL `bun run lint` + `bun run knip` before EVERY commit (per-commit hook does NOT run knip; type-aware lint only surfaces in the full run).
- SPDX headers; `.js` import extensions; no lint-disable / type-ignore.
- **`strict-boolean-expressions`:** never a `number`/`unknown` in boolean position — compare explicitly.
- **`no-await-in-loop` is `error` for `src`/`plugins`:** do NOT `await` inside a `for`/`while`. The pagination design below uses `await Promise.all(map(...))` (no loop-await) precisely to satisfy this — keep it that way.
- **`no-inline-comments`:** comments on their own line.
- No `as` on `unknown`; use `isRecord`/`stringOr`/`numberOr` guards (already in `format.ts`).
- `encodeURIComponent` every caller-supplied path segment (already done in `client.ts`).
- `max-lines` 300/file, 50/function.
- `bunx oxfmt` changed files before each commit. Free port 9100 before test runs: `lsof -ti :9100 | xargs kill -9` (ignore "no such process").

## Contract changes (breaking, intentional)

1. `GitLabClient.getRepositoryTree` returns `{ entries: ShapedTreeEntry[]; capped: boolean }` (was `ShapedTreeEntry[]`). The `gitlab_get_repository_tree` tool body changes correspondingly.
2. `MrListResult` gains `capped: boolean` (always present).
3. `gitlab_get_job` accepts EITHER `jobUrl` OR `projectPath`+`jobId` (schema: all three optional, validated in `execute`).

Existing shape-asserting tests are updated in the task that makes each change.

## File structure

```
plugins/mcp-gitlab/
  format.ts        # ADD parseJobUrl; refactor buildMrQuery to reuse a new buildMrFilterParams; add `all` to MrQueryOptions
  client.ts        # ADD getAllPages (p-limit paging); getRepositoryTree → {entries,capped}; getMrs → `all` mode + capped
  input-schema.ts  # gitlabGetJobSchema: jobId optional + jobUrl; gitlabGetMrsSchema: add `all`
  index.ts         # executeGetJob: jobUrl branch; executeGetMrs: pass `all`; tree tool returns {entries,capped}
  README.md        # document pagination cap + jobUrl
tests/plugins/
  mcp-gitlab-pagination.test.ts  # NEW: getAllPages / tree / MR all-mode (client-level)
  mcp-gitlab.test.ts             # MODIFY: jobUrl exec, tree {entries,capped} shape, getMrs capped:false
docs/architecture/coding-stack-overview.md  # note gitlab read completeness
```

---

## Task 1: `jobUrl` parsing

**Files:** `plugins/mcp-gitlab/format.ts`, `plugins/mcp-gitlab/input-schema.ts`, `plugins/mcp-gitlab/index.ts`, `tests/plugins/mcp-gitlab.test.ts`.

- [ ] **Step 1: Write failing tests** — append to `tests/plugins/mcp-gitlab.test.ts`. First add the import (near the existing `format.js` import): `import { parseJobUrl } from '../../plugins/mcp-gitlab/format.js'`. Then:

```typescript
describe('parseJobUrl', () => {
  test('extracts projectPath + jobId from a job URL', () => {
    expect(parseJobUrl('https://gitlab.example.com/group/proj/-/jobs/123')).toEqual({
      projectPath: 'group/proj',
      jobId: '123',
    })
  })

  test('handles nested subgroups', () => {
    expect(parseJobUrl('https://gitlab.example.com/group/subgroup/proj/-/jobs/456')).toEqual({
      projectPath: 'group/subgroup/proj',
      jobId: '456',
    })
  })

  test('ignores trailing path segments after the job id', () => {
    expect(parseJobUrl('https://gitlab.example.com/group/proj/-/jobs/123/artifacts')).toEqual({
      projectPath: 'group/proj',
      jobId: '123',
    })
  })

  test('rejects a non-job URL', () => {
    expect(() => parseJobUrl('https://gitlab.example.com/group/proj/-/pipelines/9')).toThrow(/job URL/u)
  })

  test('rejects a malformed URL', () => {
    expect(() => parseJobUrl('not a url')).toThrow(/Invalid GitLab job URL/u)
  })
})
```

- [ ] **Step 2: Run** `bun test tests/plugins/mcp-gitlab.test.ts` → FAIL (`parseJobUrl` missing).

- [ ] **Step 3: Add `parseJobUrl` to `plugins/mcp-gitlab/format.ts`** (append at end):

```typescript
export function parseJobUrl(jobUrl: string): { projectPath: string; jobId: string } {
  let url: URL
  try {
    url = new URL(jobUrl)
  } catch {
    throw new Error('Invalid GitLab job URL')
  }
  const match = /^\/(.+)\/-\/jobs\/(\d+)(?:\/.*)?$/u.exec(url.pathname)
  if (match === null) {
    throw new Error('GitLab job URL must look like https://gitlab.example.com/group/project/-/jobs/123')
  }
  return { projectPath: decodeURIComponent(match[1] ?? ''), jobId: match[2] ?? '' }
}
```

- [ ] **Step 4: Update `plugins/mcp-gitlab/input-schema.ts`** — replace `gitlabGetJobSchema` with (job id now optional; add `jobUrl`; drop `required`):

```typescript
export const gitlabGetJobSchema = {
  type: 'object',
  properties: {
    projectPath: { type: 'string', minLength: 1, description: 'Project path, e.g. "group/project" (with jobId)' },
    jobId: { type: 'string', minLength: 1, description: 'Numeric job id (with projectPath)' },
    jobUrl: {
      type: 'string',
      minLength: 1,
      description:
        'Full job URL, e.g. https://gitlab.example.com/group/project/-/jobs/123 (alternative to projectPath+jobId)',
    },
  },
  additionalProperties: false,
} as const
```

- [ ] **Step 5: Update `executeGetJob` in `plugins/mcp-gitlab/index.ts`** — add the `jobUrl` import and branch. Add `parseJobUrl` to the `./format.js` import list at the top (currently `index.ts` imports schemas from `./input-schema.js`; add a new import line `import { parseJobUrl } from './format.js'`). Replace `executeGetJob`:

```typescript
function executeGetJob(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const jobUrl = readOptionalString(record, 'jobUrl')
    if (jobUrl !== undefined && jobUrl !== '') {
      const parsed = parseJobUrl(jobUrl)
      return client.getJob(parsed.projectPath, parsed.jobId)
    }
    const projectPath = readOptionalString(record, 'projectPath')
    const jobId = readOptionalString(record, 'jobId')
    if (projectPath === undefined || projectPath === '' || jobId === undefined || jobId === '') {
      throw new ValidationError('provide either jobUrl, or both projectPath and jobId')
    }
    return client.getJob(projectPath, jobId)
  })
}
```

> `ValidationError` already exists in `index.ts`. A malformed `jobUrl` throws from `parseJobUrl` (plain `Error`) and surfaces as the `gitlab_error` shape via `buildExecutionError` — acceptable and carries the helpful message; a missing-identifier case throws `ValidationError` → `validation_error` shape.

- [ ] **Step 6: Add a tool-level test** to `tests/plugins/mcp-gitlab.test.ts` mirroring the existing `gitlab_get_job` execution test (find how that test builds the mock runtime context + mock httpFetch returning a job + trace). Assert that executing `gitlab_get_job` with `{ jobUrl: 'https://gitlab.example.com/group/proj/-/jobs/123' }` (and NO projectPath/jobId) hits the job endpoints for `group/proj` job `123` and returns the shaped job; and that `{}` (no identifiers) returns `{ error: 'validation_error', ... }`.

- [ ] **Step 7: Run** `bun test tests/plugins/mcp-gitlab.test.ts` → PASS.
- [ ] **Step 8: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` (no new files → no ignore change). `bunx oxfmt` changed files.
- [ ] **Step 9: Commit.**

```bash
git add plugins/mcp-gitlab/format.ts plugins/mcp-gitlab/input-schema.ts plugins/mcp-gitlab/index.ts tests/plugins/mcp-gitlab.test.ts
git commit -m "feat(mcp-gitlab): accept a full job URL in gitlab_get_job"
```

---

## Task 2: pagination helper + repository-tree full pagination

**Files:** `plugins/mcp-gitlab/client.ts`, `plugins/mcp-gitlab/index.ts`, `tests/plugins/mcp-gitlab-pagination.test.ts` (new), `tests/plugins/mcp-gitlab.test.ts` (tree shape).

- [ ] **Step 1: Write failing client tests** — `tests/plugins/mcp-gitlab-pagination.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitLabClient } from '../../plugins/mcp-gitlab/client.js'

interface Captured {
  url: string
}

function pagedTreeFetch(totalPages: number): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, _init: RequestInit | undefined): Promise<Response> => {
    captured.push({ url })
    const page = new URL(url).searchParams.get('page') ?? '1'
    const body = JSON.stringify([{ id: `e${page}`, path: `p${page}`, type: 'blob' }])
    return Promise.resolve(new Response(body, { status: 200, headers: { 'x-total-pages': String(totalPages) } }))
  }
  return { httpFetch, captured }
}

describe('GitLabClient.getRepositoryTree pagination', () => {
  test('follows all pages via x-total-pages and concatenates in order', async () => {
    const { httpFetch, captured } = pagedTreeFetch(3)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getRepositoryTree('group/proj', { recursive: true })
    expect(out.entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(out.capped).toBe(false)
    expect(captured).toHaveLength(3)
    expect(new URL(captured[0]?.url ?? '').searchParams.get('per_page')).toBe('100')
  })

  test('single page (x-total-pages: 1) fetches exactly once', async () => {
    const { httpFetch, captured } = pagedTreeFetch(1)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getRepositoryTree('group/proj', {})
    expect(out.entries.map((e) => e.id)).toEqual(['e1'])
    expect(out.capped).toBe(false)
    expect(captured).toHaveLength(1)
  })

  test('caps at MAX_PAGES (50) and reports capped: true', async () => {
    const { httpFetch, captured } = pagedTreeFetch(999)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getRepositoryTree('group/proj', {})
    expect(out.capped).toBe(true)
    expect(captured).toHaveLength(50)
  })
})
```

- [ ] **Step 2: Run** `bun test tests/plugins/mcp-gitlab-pagination.test.ts` → FAIL (`getRepositoryTree` still returns an array; no `getAllPages`).

- [ ] **Step 3: Modify `plugins/mcp-gitlab/client.ts`.** Add the `p-limit` import at the top (with the other imports): `import pLimit from 'p-limit'`. Add constants below the imports:

```typescript
const PER_PAGE = 100
const MAX_PAGES = 50
const PAGE_CONCURRENCY = 5
```

Add a `RepositoryTreeResult` type near `MrListResult`:

```typescript
export interface RepositoryTreeResult {
  entries: ShapedTreeEntry[]
  capped: boolean
}
```

Add two private methods to the class (place them above `getRepositoryTree`):

```typescript
  private async fetchPage(basePath: string, params: URLSearchParams, page: number): Promise<{ items: unknown[]; res: Response }> {
    const p = new URLSearchParams(params)
    p.set('per_page', String(PER_PAGE))
    p.set('page', String(page))
    const res = await this.request(`${basePath}?${p.toString()}`)
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status} for ${basePath}`)
    }
    const json: unknown = await res.json()
    return { items: Array.isArray(json) ? json : [], res }
  }

  private async getAllPages(basePath: string, params: URLSearchParams): Promise<{ items: unknown[]; capped: boolean }> {
    const first = await this.fetchPage(basePath, params, 1)
    const totalPages = readIntHeader(first.res, 'x-total-pages', 1)
    const capped = totalPages > MAX_PAGES
    const lastPage = Math.min(totalPages, MAX_PAGES)
    if (lastPage <= 1) {
      return { items: first.items, capped }
    }
    const limit = pLimit(PAGE_CONCURRENCY)
    const restPages = Array.from({ length: lastPage - 1 }, (_unused, i) => i + 2)
    const rest = await Promise.all(restPages.map((page) => limit(() => this.fetchPage(basePath, params, page))))
    return { items: [...first.items, ...rest.flatMap((r) => r.items)], capped }
  }
```

Replace `getRepositoryTree` with:

```typescript
  async getRepositoryTree(projectPath: string, opts: RepositoryTreeOptions): Promise<RepositoryTreeResult> {
    const params = new URLSearchParams()
    if (opts.path !== undefined) params.set('path', opts.path)
    if (opts.ref !== undefined) params.set('ref', opts.ref)
    if (opts.recursive === true) params.set('recursive', 'true')
    const { items, capped } = await this.getAllPages(
      `/projects/${encodeURIComponent(projectPath)}/repository/tree`,
      params,
    )
    return { entries: items.map(shapeTreeEntry), capped }
  }
```

> `readIntHeader` already exists in `client.ts`. The `no-await-in-loop` rule is satisfied: `getAllPages` awaits `first` then a single `Promise.all` — no `await` inside a loop. `p-limit` bounds concurrency to 5.

- [ ] **Step 4: Update the tree tool body in `plugins/mcp-gitlab/index.ts`.** `executeGetRepositoryTree` already returns `client.getRepositoryTree(...)` directly — no change needed there since it forwards the client result verbatim (now `{entries,capped}`). Verify that is the case; if the function does any post-processing of the array, update it to pass through the object.

- [ ] **Step 5: Update the existing tree tests in `tests/plugins/mcp-gitlab.test.ts`.** Any test that calls `client.getRepositoryTree(...)` or executes `gitlab_get_repository_tree` and asserts an ARRAY must now assert `{ entries: [...], capped: false }`. For single-page fixtures (no `x-total-pages` header, or `x-total-pages: 1`), `capped` is `false` and `entries` is the same array as before. Method: run the file, read the actual `{entries,capped}` output from each failure diff, and lock it in as a full-object assertion (do not weaken to partial matches). Note: the existing single-page tree mock likely returns a bare array with no pagination header — `readIntHeader` falls back to `1`, so it fetches exactly once and `capped:false`; confirm the mock returns `status: 200` with a JSON array body.

- [ ] **Step 6: Run** `lsof -ti :9100 | xargs kill -9` (ignore errors), then `bun test tests/plugins/mcp-gitlab.test.ts tests/plugins/mcp-gitlab-pagination.test.ts` → PASS.
- [ ] **Step 7: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` (new test imports `GitLabClient`; no new source files → no ignore change). `bunx oxfmt` changed files.
- [ ] **Step 8: Commit.**

```bash
git add plugins/mcp-gitlab/client.ts plugins/mcp-gitlab/index.ts tests/plugins/mcp-gitlab-pagination.test.ts tests/plugins/mcp-gitlab.test.ts
git commit -m "feat(mcp-gitlab): full repository-tree pagination with capped flag"
```

---

## Task 3: MR list `all` mode + `capped`; README + docs + gate

**Files:** `plugins/mcp-gitlab/format.ts`, `plugins/mcp-gitlab/client.ts`, `plugins/mcp-gitlab/input-schema.ts`, `plugins/mcp-gitlab/index.ts`, `tests/plugins/mcp-gitlab-pagination.test.ts`, `tests/plugins/mcp-gitlab.test.ts`, `plugins/mcp-gitlab/README.md`, `docs/architecture/coding-stack-overview.md`.

- [ ] **Step 1: Write failing tests** — append to `tests/plugins/mcp-gitlab-pagination.test.ts`:

```typescript
function pagedMrFetch(totalPages: number): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, _init: RequestInit | undefined): Promise<Response> => {
    captured.push({ url })
    const page = new URL(url).searchParams.get('page') ?? '1'
    const body = JSON.stringify([{ title: `mr${page}`, state: 'opened' }])
    return Promise.resolve(new Response(body, { status: 200, headers: { 'x-total-pages': String(totalPages) } }))
  }
  return { httpFetch, captured }
}

describe('GitLabClient.getMrs all mode', () => {
  test('all:true fetches every page and concatenates, capped:false', async () => {
    const { httpFetch, captured } = pagedMrFetch(2)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getMrs('group/proj', { all: true })
    expect(out.items.map((m) => m.title)).toEqual(['mr1', 'mr2'])
    expect(out.capped).toBe(false)
    expect(out.total).toBe(2)
    expect(captured).toHaveLength(2)
  })

  test('all:true ignores caller page and starts at page 1', async () => {
    const { httpFetch, captured } = pagedMrFetch(1)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    await client.getMrs('group/proj', { all: true, page: 7 })
    expect(new URL(captured[0]?.url ?? '').searchParams.get('page')).toBe('1')
  })
})
```

- [ ] **Step 2: Run** → FAIL (`getMrs` has no `all` handling; `all` not on `MrQueryOptions`).

- [ ] **Step 3: Refactor `plugins/mcp-gitlab/format.ts`.** Add `all?: boolean` to `MrQueryOptions`. Extract the filter params so `all` mode can reuse them:

```typescript
export function buildMrFilterParams(opts: MrQueryOptions): URLSearchParams {
  const params = new URLSearchParams()
  if (opts.state !== undefined && opts.state !== 'all') params.set('state', opts.state)
  if (opts.search !== undefined) params.set('search', opts.search)
  if (opts.labels !== undefined) params.set('labels', opts.labels)
  if (opts.sourceBranch !== undefined) params.set('source_branch', opts.sourceBranch)
  if (opts.targetBranch !== undefined) params.set('target_branch', opts.targetBranch)
  if (opts.orderBy !== undefined) params.set('order_by', opts.orderBy)
  if (opts.sort !== undefined) params.set('sort', opts.sort)
  return params
}

export function buildMrQuery(opts: MrQueryOptions): string {
  const params = buildMrFilterParams(opts)
  params.set('per_page', String(Math.min(opts.perPage ?? 20, 100)))
  params.set('page', String(opts.page ?? 1))
  return params.toString()
}
```

(`buildMrQuery`'s output is unchanged for existing single-page callers; existing `buildMrQuery` tests stay green.)

- [ ] **Step 4: Update `plugins/mcp-gitlab/client.ts`.** Add `capped: boolean` to `MrListResult`. Replace `getMrs`:

```typescript
  async getMrs(projectPath: string, opts: MrQueryOptions): Promise<MrListResult> {
    const basePath = `/projects/${encodeURIComponent(projectPath)}/merge_requests`
    if (opts.all === true) {
      const { items: raw, capped } = await this.getAllPages(basePath, buildMrFilterParams(opts))
      const items = raw.map(shapeMr)
      return { items, total: items.length, totalPages: 1, page: 1, perPage: PER_PAGE, capped }
    }
    const res = await this.request(`${basePath}?${buildMrQuery(opts)}`)
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status} for merge_requests`)
    }
    const json: unknown = await res.json()
    const items = Array.isArray(json) ? json.map(shapeMr) : []
    return {
      items,
      total: readIntHeader(res, 'x-total', items.length),
      totalPages: readIntHeader(res, 'x-total-pages', 1),
      page: readIntHeader(res, 'x-page', opts.page ?? 1),
      perPage: readIntHeader(res, 'x-per-page', Math.min(opts.perPage ?? 20, 100)),
      capped: false,
    }
  }
```

Add `buildMrFilterParams` to the `./format.js` import list at the top of `client.ts`.

- [ ] **Step 5: Update `plugins/mcp-gitlab/input-schema.ts`** — add to `gitlabGetMrsSchema.properties`:

```typescript
    all: { type: 'boolean', description: 'Fetch ALL pages (ignores page/perPage; capped at 50 pages)' },
```

- [ ] **Step 6: Update `executeGetMrs` in `plugins/mcp-gitlab/index.ts`** — add `all: readOptionalBoolean(record, 'all'),` to the options object passed to `client.getMrs(...)`.

- [ ] **Step 7: Update existing `getMrs` assertions in `tests/plugins/mcp-gitlab.test.ts`.** Every `MrListResult` expectation (client-level and tool-level) must now include `capped: false`. Run the file, read the actual output, lock in the full object (do not weaken).

- [ ] **Step 8: Run** `lsof -ti :9100 | xargs kill -9`, then `bun test tests/plugins/mcp-gitlab.test.ts tests/plugins/mcp-gitlab-pagination.test.ts` → PASS.

- [ ] **Step 9: Update `plugins/mcp-gitlab/README.md`.** Add a "Pagination" note: `gitlab_get_repository_tree` always returns the full tree (`{ entries, capped }`); `gitlab_get_mrs` fetches all matching MRs when `all: true` (otherwise a single page with pagination metadata); both follow GitLab's `x-total-pages` with bounded (5-wide) concurrency, hard-capped at 50 pages (5000 items) — when the cap is hit, `capped: true` flags the truncation in the response. Add a "Job by URL" note: `gitlab_get_job` accepts either `projectPath`+`jobId` or a full `jobUrl`.

- [ ] **Step 10: Update `docs/architecture/coding-stack-overview.md`** — find the `mcp-gitlab` mention and note read completeness now: full tree/MR pagination (capped-flagged) + `jobUrl` support.

- [ ] **Step 11: Full gate.** `lsof -ti :9100 | xargs kill -9`, then `bun run check:full` → 12/12 (if the `test` step flakes under contention, re-run standalone `bun test` to confirm environmental). Verify listing/schema unchanged as part of the suite (`tests/mcp-server/mcp-gitlab-listing.test.ts`, `tests/plugins/mcp-gitlab-schema.test.ts` — the 5-tool set is unchanged; `gitlab_get_job` and `gitlab_get_mrs` gained optional schema properties, so if `mcp-gitlab-schema.test.ts` asserts those schemas it must be updated to include `jobUrl`/`all`). Commit:

```bash
git add plugins/mcp-gitlab/format.ts plugins/mcp-gitlab/client.ts plugins/mcp-gitlab/input-schema.ts plugins/mcp-gitlab/index.ts tests/plugins/mcp-gitlab-pagination.test.ts tests/plugins/mcp-gitlab.test.ts plugins/mcp-gitlab/README.md docs/architecture/coding-stack-overview.md
git commit -m "feat(mcp-gitlab): all-pages MR listing with capped flag; docs"
```

---

## Self-review (plan author)

- **Spec coverage (F2):** Link/offset pagination for repo tree → Task 2 (`getAllPages` + tree); MR list `all=true` → Task 3; `jobUrl` parsing → Task 1. `p-limit`-bounded fetches + hard page cap surfaced (in-band `capped`, not silent) → Tasks 2–3.
- **Type consistency:** `getAllPages` returns `{items,capped}`; `RepositoryTreeResult{entries,capped}` and `MrListResult{…,capped}` both carry `capped`. `buildMrFilterParams` is the single filter-param builder reused by `buildMrQuery` (single-page) and `getMrs` all-mode. `parseJobUrl` returns `{projectPath, jobId}` (both `string`), consumed by `executeGetJob`.
- **Deliberate divergences from kiss (documented):** kiss delegates paging to `@gitbeaker`; papai follows `x-total-pages` with a `p-limit(5)` parallel fan-out after page 1, hard-capped at `MAX_PAGES=50`. Truncation is reported **in-band** (`capped`) rather than via a logger (the agent can't see operator logs; in-band is the honest "no silent truncation"). Pagination via `x-total-pages`; if GitLab omits it (keyset), we return page 1 with `capped:false` (documented limitation). `no-await-in-loop` is respected via `Promise.all(map())`.
- **`strict-boolean` / lint pre-emption:** explicit `!== undefined`/`!== ''` comparisons; `opts.recursive === true`, `opts.all === true`; no `number`/`unknown` in boolean position; no `await` in a loop; comments on their own lines.
- **Placeholders:** none — all code inline. The two "read the failure diff and lock in the full object" steps (Task 2 Step 5, Task 3 Step 7) apply only to updating existing assertions to the additive `capped`/`{entries,capped}` shape; the new behavior is directly asserted by the new pagination tests.

## Follow-ups (this plan + carried)

- **GitLab write tools (F4)** — `post_comment`/`create_discussion`/`update_mr`/`set_mr_state` remain deferred (gated on the papai/magi forge-write boundary decision recorded in the roadmap spec).
- **F2 does NOT thread `abortSignal`** into the paged fetches — carried cross-cutting item (roadmap §5).
- Carried (roadmap §5): per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset/DELETE, `abortSignal` threading, figma follow-ons, teamcity envelope flattening (F3), mattermost binary delivery (F5), the dead `key === 'key'` branch in `mcp-sentry/format.ts`, and the magi-side `npm_publish` + `ask` fail-open fix.
- **Next in sequence:** F3 (TeamCity envelope flattening; optional RAG `top_k`).

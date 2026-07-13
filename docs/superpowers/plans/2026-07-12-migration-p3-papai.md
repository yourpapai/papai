<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — Migration Phase 3 (Rollout & Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kiss→papai migration operable end-to-end: a shadow-run runbook, a standalone kiss→nerv/papai config importer, and a working live-transcript layer (papai mints a signed capability token and proxies it to magi's real `/sessions/:id/transcript`+`/stream`, surfaced from both ACP tool replies and nerv's notify payload).

**Architecture:** Three independent components, each landable and testable on its own. (1) A pure documentation deliverable — no code. (2) A standalone `tools/import-kiss-projects.ts` Bun script split into a pure mapping module (unit-tested), a DI'd orchestration module (unit-tested against fakes), and a thin Mongo-wiring CLI entrypoint (not unit-tested — a dry-run against real staging URIs is the verification path, per this plan's Component 1 runbook). (3) A transcript-token capability layer: `mintTranscriptToken`/`verifyTranscriptToken` added to the existing `src/mcp-server/token.ts` signing primitive, a repointed `src/debug/transcript-viewer.ts` proxy, a new `transcript` facade threaded through the plugin runtime context (`src/plugins/tool-runtime.ts`), consumed by `plugins/acp/`'s `start_session`/`continue_session` tools, and a `magiSessionId`-aware `src/debug/notify-route.ts`.

**Tech Stack:** Bun runtime, TypeScript strict mode, Zod v4, `mongodb` driver (new devDependency — the importer talks to nerv's/kiss's raw Mongo collections without depending on either repo's Mongoose models), `bun:test`.

**Repo:** /Users/ki/Projects/yourpapai/papai

**Cross-repo note:** The companion `nerv` plan is tiny — it only adds an optional `magiSessionId` field to `PapaiTaskNotifier`'s `/api/notify` call (`nerv/src/services/PapaiTaskNotifier.ts:71-75`, `nerv/src/services/PapaiNotifier.ts`). Since `NotifyBodySchema.magiSessionId` (Task 10 below) is optional and a notify without it behaves exactly as before, the two plans can land in either order.

---

## File Structure

- `docs/deployment/kiss-to-papai-shadow-migration.md` — new shadow-run runbook (Component 1).
- `src/coding-credentials/guardrails.ts` — add `hasCodingGuardrails()` so the importer can detect "unset" without duplicating the private storage key.
- `tools/import-kiss-projects-mapping.ts` — new. Pure kiss-doc→nerv-doc types + `mapKissProjectToNervProject()` + raw-BSON→typed-doc parsing helpers (`toKissProjectDoc`). No I/O.
- `tools/import-kiss-projects-run.ts` — new. DI'd orchestration (`runImport()`): per-project idempotent-upsert decision, guardrails-default decision, `/nerv bind` command list. Takes async "ports" so it's fully unit-testable with in-memory fakes, no real Mongo needed.
- `tools/import-kiss-projects.ts` — new. Thin CLI entrypoint: arg parsing, real `MongoClient` connections, wires `runImport()`'s ports to real collections, prints the dry-run manifest or apply summary. Not unit-tested (documented manual dry-run instead).
- `src/mcp-server/token.ts` — add `mintTranscriptToken()`/`verifyTranscriptToken()`, reusing the existing private `sign`/`signaturesMatch`/`getMcpTokenSigningSecret`.
- `src/debug/transcript-viewer.ts` — repoint `proxyTranscriptHistory`/`proxyTranscriptStream` to target magi's real `/sessions/:id/transcript`+`/stream`; `routeTranscriptPaths` now verifies the token before proxying.
- `src/plugins/transcript-facade.ts` — new. `buildTranscriptFacade()`, gated on the existing `coding.secrets` permission (mirrors `src/plugins/coding-secrets-facade.ts`).
- `src/plugins/runtime-types.ts` — add `transcript` to `PluginToolRuntimeContext`.
- `src/plugins/tool-runtime.ts` — wire `buildTranscriptFacade()` into `buildPluginToolRuntimeContext()`.
- `plugins/acp/tools.ts` — add `transcript` to the plugin-local `RuntimeContext` type.
- `plugins/acp/session-tools.ts` — `startSessionTool` mints a transcript URL for the new session and merges it into the result/record.
- `plugins/acp/continue-tool.ts` — `continueSessionTool` does the same for the follow-up session.
- `tests/plugins/acp/support.ts` — add a `transcript: { mintUrl: () => null }` default to `runtimeCtx`/`runtimeCtxWithKv`.
- `src/debug/notify-route.ts` — `NotifyBodySchema` accepts optional `magiSessionId`; when present, mint a transcript token and append the link to the delivered markdown.
- Test files: `tests/coding-credentials/guardrails.test.ts`, `tests/tools/import-kiss-projects-mapping.test.ts` (new), `tests/tools/import-kiss-projects-run.test.ts` (new), `tests/mcp-server/token.test.ts`, `tests/debug/transcript-viewer.test.ts`, `tests/debug/transcript-viewer-e2e.test.ts`, `tests/plugins/transcript-facade.test.ts` (new), `tests/plugins/tool-runtime.test.ts`, `tests/plugins/acp/start-session.test.ts`, `tests/plugins/acp/continue-session.test.ts`, `tests/debug/notify-route.test.ts`.

---

### Task 1: Shadow-run runbook (Component 1, doc-only)

**Files:**

- Create: `docs/deployment/kiss-to-papai-shadow-migration.md`

- [ ] **Step 1: Write the runbook**

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai shadow migration

This runbook covers running papai+nerv **alongside** an existing kiss deployment on the same
GitLab repos, comparing outputs, and cutting projects over one at a time. It assumes nerv is
already deployed and the `nerv` plugin is enabled per `docs/deployment/nerv-enablement.md`.

## 1. Run against the same repos kiss serves

Point nerv's `Project.repositories[].projectPath`/`repoUrl` at the exact same GitLab projects
kiss is currently configured for (either by hand, or via the importer in
`tools/import-kiss-projects.ts` — see `docs/superpowers/plans/2026-07-12-migration-p3-papai.md`
Task 3-5). Do **not** disable kiss on these projects yet — both bots run in parallel during the
shadow phase.

## 2. Shadow by assigning the bot to kiss-created MRs

papai's P1 assignee-watch sweep adopts MRs it's assigned to, even ones kiss opened first (see
`docs/superpowers/specs/2026-07-12-migration-p1-assign-the-bot-design.md`). To shadow a specific
kiss-driven MR:

1. Add the papai/nerv bot as an assignee on the MR (in addition to kiss's bot, if kiss also
   assigns itself).
2. The assignee-watch sweep picks it up on its next poll and starts a nerv task against the same
   branch/MR.
3. Let both bots run their review/CI-fix loop independently. **Do not merge** until you've
   compared outputs (see the parity checklist below).

This exercises the exact same code path production traffic will use post-cutover, without
requiring kiss to be turned off first.

## 3. Parity checklist

Before trusting nerv's output on a project, compare it against kiss's on at least 3-5 shadowed
MRs:

- [ ] **Review-fix parity** — same review comments addressed, no regressions introduced that
      kiss's pass didn't also introduce.
- [ ] **CI-fix parity** — nerv's CI-fix loop reaches a green pipeline in a comparable number of
      iterations; no CI jobs left permanently red that kiss would have fixed.
- [ ] **Cost parity** — compare `costBudgetUsd`-bounded spend per task against kiss's
      `maxTaskCost`-bounded spend for equivalent prompts; nerv should not be materially more
      expensive for the same class of task.
- [ ] **Output language/tone parity** — nerv's PR descriptions, commit messages, and chat replies
      read consistently with what users are used to from kiss (no jarring format/tone shift).

Run the checklist per-project, not globally — different repos exercise different agent
behaviors (monorepo vs. single-repo, heavier vs. lighter CI, etc.).

## 4. Per-project cutover

Once a project passes the parity checklist:

1. In the target chat channel/group, run `/nerv bind <projectPath>` (see
   `plugins/nerv/bind-command.ts`) to bind that channel to the nerv project. This sets
   `notifyContextId` so nerv's task notifications land in the right place.
2. Disable kiss on that project (stop assigning its bot to new MRs on this repo, or disable the
   project in kiss's own config — kiss-side operation, outside papai's scope).
3. Announce the cutover in the channel so users know which bot now owns new work on that repo.

Repeat per-project until every kiss-served project has been cut over.

## 5. Rollback

If a cut-over project regresses:

1. Un-assign the papai/nerv bot from new MRs on that repo (or unbind via nerv's project config —
   there is currently no `/nerv unbind` command; clear `notifyContextId` via direct nerv Mongo
   access or a future unbind command).
2. Re-enable kiss on that project.
3. File the regression before retrying cutover — a rollback should always leave a paper trail of
   what broke.

No papai-side code changes are required for rollback; it's purely an assignment/config change on
already-shipped functionality.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment/kiss-to-papai-shadow-migration.md
git commit -m "docs: add kiss-to-papai shadow migration runbook"
```

---

### Task 2: `hasCodingGuardrails` helper

**Files:**

- Modify: `src/coding-credentials/guardrails.ts`
- Test: `tests/coding-credentials/guardrails.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/coding-credentials/guardrails.test.ts` (extend the existing `import` and `describe` block):

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import {
  adminCodingGuardrailsContextId,
  guardrailsSchema,
  hasCodingGuardrails,
  resolveCodingGuardrails,
  setCodingGuardrails,
} from '../../src/coding-credentials/guardrails.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('guardrails', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  // ... existing tests unchanged ...

  test('hasCodingGuardrails is false when unset and true after set', () => {
    expect(hasCodingGuardrails('pi-1')).toBe(false)
    setCodingGuardrails('pi-1', {
      allowedAgents: ['claude'],
      whoMayUse: 'members',
      forceSharedKey: false,
      maxMcpServers: 3,
    })
    expect(hasCodingGuardrails('pi-1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/coding-credentials/guardrails.test.ts`
Expected: FAIL — `hasCodingGuardrails is not a function` (or a TS error if run through `bun test`, which typechecks on the fly: `Export named 'hasCodingGuardrails' not found`).

- [ ] **Step 3: Implement `hasCodingGuardrails`**

In `src/coding-credentials/guardrails.ts`, add after `setCodingGuardrails`:

```typescript
export function hasCodingGuardrails(platformInstanceId: string): boolean {
  return getCachedConfig(adminCodingGuardrailsContextId(platformInstanceId), KEY) !== null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/coding-credentials/guardrails.test.ts`
Expected: PASS (5 tests, all green)

- [ ] **Step 5: Commit**

```bash
git add src/coding-credentials/guardrails.ts tests/coding-credentials/guardrails.test.ts
git commit -m "feat(guardrails): add hasCodingGuardrails for unset-detection"
```

---

### Task 3: Importer mapping module (pure, unit-tested)

**Files:**

- Create: `tools/import-kiss-projects-mapping.ts`
- Test: `tests/tools/import-kiss-projects-mapping.test.ts`
- Modify: `package.json` (new devDependency)

- [ ] **Step 1: Add the `mongodb` devDependency**

```bash
bun add -D mongodb
```

Expected: `package.json`'s `devDependencies` gains `"mongodb": "^7.5.0"` (or whatever is current at install time), `bun.lock` updates.

- [ ] **Step 2: Write the failing test**

Create `tests/tools/import-kiss-projects-mapping.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  kissProjectLabel,
  mapKissProjectToNervProject,
  toKissProjectDoc,
} from '../../tools/import-kiss-projects-mapping.js'
import type { KissProjectDoc } from '../../tools/import-kiss-projects-mapping.js'

const OPTS = { gitlabBaseUrl: 'https://gitlab.corp.example' }

describe('mapKissProjectToNervProject', () => {
  test('maps repositories, deriving repoUrl from the gitlab base URL', () => {
    const kiss: KissProjectDoc = {
      _id: 'p1',
      title: 'Demo',
      repositories: [
        { projectPath: 'team/demo', description: 'Demo repo', defaultBranch: 'main', worktreeSubdir: 'app' },
      ],
    }
    const { doc, warnings } = mapKissProjectToNervProject(kiss, OPTS)
    expect(doc.repositories).toEqual([
      {
        projectPath: 'team/demo',
        repoUrl: 'https://gitlab.corp.example/team/demo.git',
        description: 'Demo repo',
        baseBranch: 'main',
        worktreeSubdir: 'app',
      },
    ])
    expect(warnings).toEqual([])
  })

  test('maps maxTaskCost to costBudgetUsd, defaults null when absent', () => {
    const withCost = mapKissProjectToNervProject({ _id: 'p1', maxTaskCost: 12.5 }, OPTS)
    expect(withCost.doc.costBudgetUsd).toBe(12.5)
    const withoutCost = mapKissProjectToNervProject({ _id: 'p2' }, OPTS)
    expect(withoutCost.doc.costBudgetUsd).toBeNull()
  })

  test('maps autoReview/selfReviewEnabled with nerv-matching defaults', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, OPTS)
    expect(doc.autoReview).toBe(false)
    expect(doc.selfReviewEnabled).toBe(true)
  })

  test('carries mcpServers through untouched when present', () => {
    const mcpServers = [{ id: 'jira', url: 'https://mcp.example.com' }]
    const { doc } = mapKissProjectToNervProject({ _id: 'p1', mcpServers }, OPTS)
    expect(doc.mcpServers).toEqual(mcpServers)
  })

  test('omits mcpServers when absent', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, OPTS)
    expect(doc.mcpServers).toBeUndefined()
  })

  test('derives forge from the gitlab base URL, trimming a trailing slash', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, { gitlabBaseUrl: 'https://gitlab.corp.example/' })
    expect(doc.forge).toEqual({ kind: 'gitlab', apiBaseUrl: 'https://gitlab.corp.example/api/v4' })
  })

  test('warns and drops proxy/ignoreFiles/ephemeralSessionsEnabled/ephemeralModelProvider when set', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        title: 'Demo',
        proxy: 'http://proxy.internal',
        ignoreFiles: '.kissignore',
        ephemeralSessionsEnabled: true,
        ephemeralModelProvider: { id: 'eph' },
      },
      OPTS,
    )
    expect(warnings).toEqual([
      'project "Demo": dropping kiss field "proxy" (no nerv target)',
      'project "Demo": dropping kiss field "ignoreFiles" (no nerv target)',
      'project "Demo": dropping kiss field "ephemeralSessionsEnabled" (no nerv target)',
      'project "Demo": dropping kiss field "ephemeralModelProvider" (no nerv target)',
    ])
  })

  test('does not warn when dropped-field values are absent or false', () => {
    const { warnings } = mapKissProjectToNervProject(
      { _id: 'p1', title: 'Demo', ephemeralSessionsEnabled: false },
      OPTS,
    )
    expect(warnings).toEqual([])
  })

  test('warns per-repo when pipelineJobTrackList is set (nerv has no matching repo field yet)', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        title: 'Demo',
        repositories: [{ projectPath: 'team/demo', description: 'd', pipelineJobTrackList: ['build', 'test'] }],
      },
      OPTS,
    )
    expect(warnings).toEqual([
      'project "Demo" repo "team/demo": dropping kiss field "pipelineJobTrackList" ' +
        '(nerv Project.repositories has no matching field yet)',
    ])
  })

  test('does not warn about pipelineJobTrackList when null or empty', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        repositories: [
          { projectPath: 'a', description: 'd', pipelineJobTrackList: null },
          { projectPath: 'b', description: 'd', pipelineJobTrackList: [] },
        ],
      },
      OPTS,
    )
    expect(warnings).toEqual([])
  })

  test('uses the Mongo _id as the label when title is absent', () => {
    const { warnings } = mapKissProjectToNervProject({ _id: 'raw-id-123', proxy: 'x' }, OPTS)
    expect(warnings).toEqual(['project "raw-id-123": dropping kiss field "proxy" (no nerv target)'])
  })

  test('contextIds always starts empty (binding happens later via /nerv bind)', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, OPTS)
    expect(doc.contextIds).toEqual([])
  })
})

describe('kissProjectLabel', () => {
  test('prefers title, falls back to _id', () => {
    expect(kissProjectLabel({ _id: 'x', title: 'Demo' })).toBe('Demo')
    expect(kissProjectLabel({ _id: 'x', title: '' })).toBe('x')
    expect(kissProjectLabel({ _id: 'x' })).toBe('x')
  })
})

describe('toKissProjectDoc', () => {
  test('parses a well-formed raw BSON document', () => {
    const raw = {
      _id: 'oid-1',
      title: 'Demo',
      repositories: [{ projectPath: 'a/b', description: 'd', defaultBranch: 'main' }],
      maxTaskCost: 5,
      autoReview: true,
    }
    const doc = toKissProjectDoc(raw)
    expect(doc).toEqual({
      _id: 'oid-1',
      title: 'Demo',
      repositories: [{ projectPath: 'a/b', description: 'd', defaultBranch: 'main' }],
      maxTaskCost: 5,
      autoReview: true,
    })
  })

  test('drops a malformed repo entry missing projectPath/description', () => {
    const raw = {
      _id: 'oid-1',
      repositories: [{ projectPath: 'a/b', description: 'd' }, { projectPath: 'no-description' }, 'not-an-object'],
    }
    const doc = toKissProjectDoc(raw)
    expect(doc.repositories).toEqual([{ projectPath: 'a/b', description: 'd' }])
  })

  test('leaves optional fields undefined when absent from the raw document', () => {
    const doc = toKissProjectDoc({ _id: 'oid-1' })
    expect(doc).toEqual({ _id: 'oid-1' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/tools/import-kiss-projects-mapping.test.ts`
Expected: FAIL — `Cannot find module '../../tools/import-kiss-projects-mapping.js'`

- [ ] **Step 4: Implement the mapping module**

Create `tools/import-kiss-projects-mapping.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Pure kiss-Project → nerv-Project field mapping for the config importer
 * (`tools/import-kiss-projects.ts`). No I/O — see `tools/import-kiss-projects-run.ts`
 * for the Mongo-facing orchestration.
 */

export interface KissProjectRepoRef {
  projectPath: string
  description: string
  defaultBranch?: string
  worktreeSubdir?: string
  pipelineJobTrackList?: string[] | null
}

export interface KissProjectDoc {
  _id: unknown
  title?: string
  repositories?: KissProjectRepoRef[]
  mcpServers?: unknown[]
  modelProvider?: Record<string, unknown>
  autoReview?: boolean
  selfReviewEnabled?: boolean
  maxTaskCost?: number | null
  proxy?: string
  ignoreFiles?: string
  ephemeralSessionsEnabled?: boolean
  ephemeralModelProvider?: unknown
}

export interface NervProjectRepoDoc {
  projectPath: string
  repoUrl: string
  baseBranch?: string
  worktreeSubdir?: string
  description?: string
}

export interface NervProjectDoc {
  contextIds: string[]
  repositories: NervProjectRepoDoc[]
  mcpServers?: unknown[]
  modelProvider?: Record<string, unknown>
  autoReview: boolean
  selfReviewEnabled: boolean
  costBudgetUsd: number | null
  forge: { kind: 'gitlab'; apiBaseUrl: string }
}

export interface MapImportOptions {
  /** kiss's global GitLab instance base URL (mirrors kiss's own `GITLAB_BASE_URL` env). */
  gitlabBaseUrl: string
}

export interface MapImportResult {
  doc: NervProjectDoc
  warnings: string[]
}

/** Human-readable label for a kiss project in warnings/reports: title, falling back to _id. */
export function kissProjectLabel(kiss: Pick<KissProjectDoc, '_id' | 'title'>): string {
  return kiss.title !== undefined && kiss.title !== '' ? kiss.title : String(kiss._id)
}

function isSetValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/u, '')
}

const DROPPED_PROJECT_FIELDS = ['proxy', 'ignoreFiles', 'ephemeralSessionsEnabled', 'ephemeralModelProvider'] as const

function mapRepo(
  repo: KissProjectRepoRef,
  gitlabBaseUrl: string,
  label: string,
  warnings: string[],
): NervProjectRepoDoc {
  if (isSetValue(repo.pipelineJobTrackList)) {
    warnings.push(
      `project "${label}" repo "${repo.projectPath}": dropping kiss field "pipelineJobTrackList" ` +
        '(nerv Project.repositories has no matching field yet)',
    )
  }
  return {
    projectPath: repo.projectPath,
    repoUrl: `${trimTrailingSlash(gitlabBaseUrl)}/${repo.projectPath}.git`,
    description: repo.description,
    ...(repo.defaultBranch === undefined ? {} : { baseBranch: repo.defaultBranch }),
    ...(repo.worktreeSubdir === undefined ? {} : { worktreeSubdir: repo.worktreeSubdir }),
  }
}

/** Maps one kiss Project doc to a nerv Project doc, collecting dropped-field warnings. Pure — no I/O. */
export function mapKissProjectToNervProject(kiss: KissProjectDoc, opts: MapImportOptions): MapImportResult {
  const warnings: string[] = []
  const label = kissProjectLabel(kiss)
  for (const field of DROPPED_PROJECT_FIELDS) {
    if (isSetValue(kiss[field])) warnings.push(`project "${label}": dropping kiss field "${field}" (no nerv target)`)
  }
  const repositories = (kiss.repositories ?? []).map((r) => mapRepo(r, opts.gitlabBaseUrl, label, warnings))
  const doc: NervProjectDoc = {
    contextIds: [],
    repositories,
    ...(kiss.mcpServers === undefined ? {} : { mcpServers: kiss.mcpServers }),
    ...(kiss.modelProvider === undefined ? {} : { modelProvider: kiss.modelProvider }),
    autoReview: kiss.autoReview ?? false,
    selfReviewEnabled: kiss.selfReviewEnabled ?? true,
    costBudgetUsd: kiss.maxTaskCost ?? null,
    forge: { kind: 'gitlab', apiBaseUrl: `${trimTrailingSlash(opts.gitlabBaseUrl)}/api/v4` },
  }
  return { doc, warnings }
}

// ─── Raw-BSON parsing (still pure — takes an already-fetched document, does no I/O) ──────────

function asStringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumberOrNullOrUndefined(v: unknown): number | null | undefined {
  if (v === null) return null
  return typeof v === 'number' ? v : undefined
}

function asBooleanOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function asStringArrayOrNullOrUndefined(v: unknown): string[] | null | undefined {
  if (v === null) return null
  if (!Array.isArray(v)) return undefined
  return v.every((item): item is string => typeof item === 'string') ? v : undefined
}

function toKissRepoRef(raw: unknown): KissProjectRepoRef | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const projectPath = asStringOrUndefined(r['projectPath'])
  const description = asStringOrUndefined(r['description'])
  if (projectPath === undefined || description === undefined) return null
  const defaultBranch = asStringOrUndefined(r['defaultBranch'])
  const worktreeSubdir = asStringOrUndefined(r['worktreeSubdir'])
  const pipelineJobTrackList = asStringArrayOrNullOrUndefined(r['pipelineJobTrackList'])
  return {
    projectPath,
    description,
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    ...(worktreeSubdir === undefined ? {} : { worktreeSubdir }),
    ...(pipelineJobTrackList === undefined ? {} : { pipelineJobTrackList }),
  }
}

/** Parses a raw Mongo document from kiss's `projects` collection into a typed `KissProjectDoc`. */
export function toKissProjectDoc(raw: Record<string, unknown>): KissProjectDoc {
  const rawRepos = raw['repositories']
  const repositories = Array.isArray(rawRepos)
    ? rawRepos.map(toKissRepoRef).filter((r): r is KissProjectRepoRef => r !== null)
    : undefined
  const title = asStringOrUndefined(raw['title'])
  const mcpServers = Array.isArray(raw['mcpServers']) ? (raw['mcpServers'] as unknown[]) : undefined
  const modelProvider =
    typeof raw['modelProvider'] === 'object' && raw['modelProvider'] !== null
      ? (raw['modelProvider'] as Record<string, unknown>)
      : undefined
  const autoReview = asBooleanOrUndefined(raw['autoReview'])
  const selfReviewEnabled = asBooleanOrUndefined(raw['selfReviewEnabled'])
  const maxTaskCost = asNumberOrNullOrUndefined(raw['maxTaskCost'])
  const proxy = asStringOrUndefined(raw['proxy'])
  const ignoreFiles = asStringOrUndefined(raw['ignoreFiles'])
  const ephemeralSessionsEnabled = asBooleanOrUndefined(raw['ephemeralSessionsEnabled'])
  const ephemeralModelProvider = raw['ephemeralModelProvider']
  return {
    _id: raw['_id'],
    ...(title === undefined ? {} : { title }),
    ...(repositories === undefined ? {} : { repositories }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
    ...(modelProvider === undefined ? {} : { modelProvider }),
    ...(autoReview === undefined ? {} : { autoReview }),
    ...(selfReviewEnabled === undefined ? {} : { selfReviewEnabled }),
    ...(maxTaskCost === undefined ? {} : { maxTaskCost }),
    ...(proxy === undefined ? {} : { proxy }),
    ...(ignoreFiles === undefined ? {} : { ignoreFiles }),
    ...(ephemeralSessionsEnabled === undefined ? {} : { ephemeralSessionsEnabled }),
    ...(ephemeralModelProvider === undefined ? {} : { ephemeralModelProvider }),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/tools/import-kiss-projects-mapping.test.ts`
Expected: PASS (16 tests, all green)

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tools/import-kiss-projects-mapping.ts tests/tools/import-kiss-projects-mapping.test.ts
git commit -m "feat(import): add kiss-to-nerv project mapping module"
```

---

### Task 4: Importer orchestration module (DI'd, unit-tested against fakes)

**Files:**

- Create: `tools/import-kiss-projects-run.ts`
- Test: `tests/tools/import-kiss-projects-run.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/import-kiss-projects-run.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { NervProjectDoc } from '../../tools/import-kiss-projects-mapping.js'
import { runImport } from '../../tools/import-kiss-projects-run.js'
import type { KissProjectDoc } from '../../tools/import-kiss-projects-mapping.js'
import type { RunImportPorts } from '../../tools/import-kiss-projects-run.js'

const OPTS = { gitlabBaseUrl: 'https://gitlab.corp.example', platformInstanceId: 'pi-1' }

function makeFakePorts(): RunImportPorts & { nervStore: Map<string, NervProjectDoc>; guardrailsSet: boolean } {
  const nervStore = new Map<string, NervProjectDoc>()
  let guardrailsSet = false
  return {
    nervStore,
    get guardrailsSet(): boolean {
      return guardrailsSet
    },
    nervFindByRepoPath: (projectPath) => Promise.resolve(nervStore.has(projectPath) ? {} : null),
    nervUpsert: (projectPath, doc) => {
      nervStore.set(projectPath, doc)
      return Promise.resolve()
    },
    guardrailsHas: () => guardrailsSet,
    guardrailsSetDefault: () => {
      guardrailsSet = true
    },
  } as RunImportPorts & { nervStore: Map<string, NervProjectDoc>; guardrailsSet: boolean }
}

const DEMO: KissProjectDoc = {
  _id: 'p1',
  title: 'Demo',
  repositories: [{ projectPath: 'team/demo', description: 'Demo repo' }],
}

describe('runImport', () => {
  test('dry-run makes no writes, reports would-create and would-set-default', async () => {
    const ports = makeFakePorts()
    const report = await runImport([DEMO], ports, { ...OPTS, apply: false })
    expect(ports.nervStore.size).toBe(0)
    expect(ports.guardrailsSet).toBe(false)
    expect(report.projects).toEqual([
      { label: 'Demo', primaryProjectPath: 'team/demo', warnings: [], action: 'would-create' },
    ])
    expect(report.guardrailsAction).toBe('would-set-default')
    expect(report.bindCommands).toEqual(['/nerv bind team/demo'])
  })

  test('apply creates a new project and sets default guardrails', async () => {
    const ports = makeFakePorts()
    const report = await runImport([DEMO], ports, { ...OPTS, apply: true })
    expect(ports.nervStore.has('team/demo')).toBe(true)
    expect(ports.guardrailsSet).toBe(true)
    expect(report.projects[0]?.action).toBe('created')
    expect(report.guardrailsAction).toBe('set-default')
  })

  test('a second apply run is idempotent: updates instead of creates, leaves existing guardrails', async () => {
    const ports = makeFakePorts()
    await runImport([DEMO], ports, { ...OPTS, apply: true })
    const second = await runImport([DEMO], ports, { ...OPTS, apply: true })
    expect(second.projects[0]?.action).toBe('updated')
    expect(second.guardrailsAction).toBe('left-existing')
    expect(ports.nervStore.size).toBe(1)
  })

  test('never overwrites existing guardrails on dry-run either', async () => {
    const ports = makeFakePorts()
    ports.guardrailsSetDefault(OPTS.platformInstanceId)
    const report = await runImport([DEMO], ports, { ...OPTS, apply: false })
    expect(report.guardrailsAction).toBe('no-op-dry-run-existing')
  })

  test('skips a project with zero repositories and emits no bind command', async () => {
    const ports = makeFakePorts()
    const noRepos: KissProjectDoc = { _id: 'p2', title: 'Empty' }
    const report = await runImport([noRepos], ports, { ...OPTS, apply: true })
    expect(report.projects).toEqual([
      { label: 'Empty', primaryProjectPath: '', warnings: [], action: 'skipped-no-repos' },
    ])
    expect(report.bindCommands).toEqual([])
    expect(ports.nervStore.size).toBe(0)
  })

  test('propagates mapping warnings into the per-project report', async () => {
    const ports = makeFakePorts()
    const withDroppedField: KissProjectDoc = { ...DEMO, proxy: 'http://proxy.internal' }
    const report = await runImport([withDroppedField], ports, { ...OPTS, apply: false })
    expect(report.projects[0]?.warnings).toEqual(['project "Demo": dropping kiss field "proxy" (no nerv target)'])
  })

  test('prints one bind command per imported project, in order', async () => {
    const ports = makeFakePorts()
    const second: KissProjectDoc = {
      _id: 'p2',
      title: 'Second',
      repositories: [{ projectPath: 'team/second', description: 'd' }],
    }
    const report = await runImport([DEMO, second], ports, { ...OPTS, apply: false })
    expect(report.bindCommands).toEqual(['/nerv bind team/demo', '/nerv bind team/second'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/import-kiss-projects-run.test.ts`
Expected: FAIL — `Cannot find module '../../tools/import-kiss-projects-run.js'`

- [ ] **Step 3: Implement the orchestration module**

Create `tools/import-kiss-projects-run.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * DI'd orchestration for the kiss→nerv/papai project importer. Takes async "ports" so this
 * module is fully unit-testable against in-memory fakes — no real Mongo connection needed.
 * `tools/import-kiss-projects.ts` wires these ports to real `mongodb` collections + papai's
 * guardrails store.
 */

import type { KissProjectDoc, NervProjectDoc } from './import-kiss-projects-mapping.js'
import { kissProjectLabel, mapKissProjectToNervProject } from './import-kiss-projects-mapping.js'

export interface RunImportOptions {
  apply: boolean
  platformInstanceId: string
  gitlabBaseUrl: string
}

export interface RunImportPorts {
  /** Returns a non-null marker if a nerv project already has a repo at this path. */
  nervFindByRepoPath(projectPath: string): Promise<{ notifyContextId?: string } | null>
  /** Upserts a nerv Project doc, identified by one of its repo paths. Must not touch notifyContextId. */
  nervUpsert(projectPath: string, doc: NervProjectDoc): Promise<void>
  guardrailsHas(platformInstanceId: string): boolean
  guardrailsSetDefault(platformInstanceId: string): void
}

export interface ImportedProjectReport {
  label: string
  primaryProjectPath: string
  warnings: string[]
  action: 'would-create' | 'would-update' | 'created' | 'updated' | 'skipped-no-repos'
}

export interface RunImportReport {
  projects: ImportedProjectReport[]
  guardrailsAction: 'would-set-default' | 'set-default' | 'left-existing' | 'no-op-dry-run-existing'
  /** One `/nerv bind <projectPath>` line per successfully-mapped project, for the operator to run. */
  bindCommands: string[]
}

/**
 * Imports kiss Project docs into nerv + a default papai `coding_guardrails`. Idempotent under
 * `apply: true` — a project already present in nerv (matched by its primary repo's projectPath)
 * is updated, not duplicated; an existing `coding_guardrails` is never overwritten.
 */
export async function runImport(
  kissProjects: KissProjectDoc[],
  ports: RunImportPorts,
  opts: RunImportOptions,
): Promise<RunImportReport> {
  const projects: ImportedProjectReport[] = []
  const bindCommands: string[] = []

  for (const kissDoc of kissProjects) {
    const label = kissProjectLabel(kissDoc)
    const { doc, warnings } = mapKissProjectToNervProject(kissDoc, { gitlabBaseUrl: opts.gitlabBaseUrl })
    if (doc.repositories.length === 0) {
      projects.push({ label, primaryProjectPath: '', warnings, action: 'skipped-no-repos' })
      continue
    }
    const primaryProjectPath = doc.repositories[0]!.projectPath
    const existing = await ports.nervFindByRepoPath(primaryProjectPath)
    const action: ImportedProjectReport['action'] = opts.apply
      ? existing === null
        ? 'created'
        : 'updated'
      : existing === null
        ? 'would-create'
        : 'would-update'
    if (opts.apply) await ports.nervUpsert(primaryProjectPath, doc)
    projects.push({ label, primaryProjectPath, warnings, action })
    bindCommands.push(`/nerv bind ${primaryProjectPath}`)
  }

  const hasGuardrails = ports.guardrailsHas(opts.platformInstanceId)
  let guardrailsAction: RunImportReport['guardrailsAction']
  if (hasGuardrails) {
    guardrailsAction = opts.apply ? 'left-existing' : 'no-op-dry-run-existing'
  } else {
    guardrailsAction = opts.apply ? 'set-default' : 'would-set-default'
    if (opts.apply) ports.guardrailsSetDefault(opts.platformInstanceId)
  }

  return { projects, guardrailsAction, bindCommands }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/import-kiss-projects-run.test.ts`
Expected: PASS (7 tests, all green)

- [ ] **Step 5: Commit**

```bash
git add tools/import-kiss-projects-run.ts tests/tools/import-kiss-projects-run.test.ts
git commit -m "feat(import): add DI'd import orchestration with idempotent upsert"
```

---

### Task 5: Importer CLI entrypoint (thin Mongo wiring, not unit-tested)

**Files:**

- Create: `tools/import-kiss-projects.ts`

- [ ] **Step 1: Implement the CLI entrypoint**

Create `tools/import-kiss-projects.ts`:

```typescript
#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Standalone kiss→nerv/papai config importer.
 *
 * Usage:
 *   KISS_MONGO_URI=... NERV_MONGO_URI=... KISS_GITLAB_BASE_URL=... PAPAI_PLATFORM_INSTANCE_ID=... \
 *     bun run tools/import-kiss-projects.ts [--apply]
 *
 * Default is --dry-run (no writes): prints the full nerv Project docs + guardrails decision it
 * would write, and the `/nerv bind` commands the operator will need afterward. Pass --apply to
 * perform the writes. Mongo I/O here is intentionally thin and NOT unit-tested — the pure mapping
 * (tools/import-kiss-projects-mapping.ts) and orchestration (tools/import-kiss-projects-run.ts)
 * modules carry the test coverage; verify this file by running --dry-run against a real staging
 * KISS_MONGO_URI/NERV_MONGO_URI pair and reviewing the printed manifest before ever passing
 * --apply (see docs/deployment/kiss-to-papai-shadow-migration.md).
 */

import { MongoClient, type Document, type WithId } from 'mongodb'

import { guardrailsSchema, hasCodingGuardrails, setCodingGuardrails } from '../src/coding-credentials/guardrails.js'
import type { KissProjectDoc, NervProjectDoc } from './import-kiss-projects-mapping.js'
import { toKissProjectDoc } from './import-kiss-projects-mapping.js'
import type { RunImportPorts } from './import-kiss-projects-run.js'
import { runImport } from './import-kiss-projects-run.js'

function parseArgs(argv: readonly string[]): { apply: boolean } {
  const args = argv.slice(2)
  return { apply: args.includes('--apply') }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

function makeNervPorts(
  nervCol: import('mongodb').Collection<Document>,
): Pick<RunImportPorts, 'nervFindByRepoPath' | 'nervUpsert'> {
  return {
    async nervFindByRepoPath(projectPath: string): Promise<{ notifyContextId?: string } | null> {
      const existing = await nervCol.findOne({ 'repositories.projectPath': projectPath })
      if (existing === null) return null
      const notifyContextId = typeof existing['notifyContextId'] === 'string' ? existing['notifyContextId'] : undefined
      return { ...(notifyContextId === undefined ? {} : { notifyContextId }) }
    },
    async nervUpsert(projectPath: string, doc: NervProjectDoc): Promise<void> {
      const existing = await nervCol.findOne({ 'repositories.projectPath': projectPath })
      const now = new Date()
      if (existing === null) {
        await nervCol.insertOne({ ...doc, createdAt: now, updatedAt: now })
      } else {
        await nervCol.updateOne({ _id: existing['_id'] }, { $set: { ...doc, updatedAt: now } })
      }
    },
  }
}

function makeGuardrailsPorts(): Pick<RunImportPorts, 'guardrailsHas' | 'guardrailsSetDefault'> {
  return {
    guardrailsHas: (platformInstanceId: string): boolean => hasCodingGuardrails(platformInstanceId),
    guardrailsSetDefault: (platformInstanceId: string): void => {
      setCodingGuardrails(platformInstanceId, guardrailsSchema.parse({}))
    },
  }
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv)
  const kissUri = requiredEnv('KISS_MONGO_URI')
  const nervUri = requiredEnv('NERV_MONGO_URI')
  const gitlabBaseUrl = requiredEnv('KISS_GITLAB_BASE_URL')
  const platformInstanceId = requiredEnv('PAPAI_PLATFORM_INSTANCE_ID')

  console.log(apply ? 'Running in APPLY mode (writes will be made).' : 'Running in DRY-RUN mode (no writes).')

  const kissClient = new MongoClient(kissUri)
  const nervClient = new MongoClient(nervUri)
  await kissClient.connect()
  await nervClient.connect()
  try {
    const rawKissDocs: WithId<Document>[] = await kissClient.db().collection('projects').find().toArray()
    const kissProjects: KissProjectDoc[] = rawKissDocs.map((raw) => toKissProjectDoc(raw))
    const nervCol = nervClient.db().collection('projects')

    const ports: RunImportPorts = { ...makeNervPorts(nervCol), ...makeGuardrailsPorts() }
    const report = await runImport(kissProjects, ports, { apply, platformInstanceId, gitlabBaseUrl })

    console.log(`\n${report.projects.length} kiss project(s) processed:\n`)
    for (const p of report.projects) {
      console.log(`  [${p.action}] ${p.label} (${p.primaryProjectPath || 'no repos'})`)
      for (const w of p.warnings) console.log(`    ! ${w}`)
    }
    console.log(`\nGuardrails: ${report.guardrailsAction}`)
    console.log('\nAfter this run, bind each project to its chat channel by running (in that channel):\n')
    for (const cmd of report.bindCommands) console.log(`  ${cmd}`)
  } finally {
    await kissClient.close()
    await nervClient.close()
  }
}

await main()
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no new errors from `tools/import-kiss-projects.ts` (this validates the raw `Document` handling and the `RunImportPorts` wiring compile cleanly against strict mode).

- [ ] **Step 3: Manual dry-run verification (documented, not automated)**

Against a real (staging, never production) kiss Mongo snapshot:

```bash
KISS_MONGO_URI=mongodb://localhost:27017/kiss \
NERV_MONGO_URI=mongodb://localhost:27017/nerv \
KISS_GITLAB_BASE_URL=https://gitlab.corp.example \
PAPAI_PLATFORM_INSTANCE_ID=pi-staging \
  bun run tools/import-kiss-projects.ts
```

Expected: prints one `[would-create]` or `[would-update]` line per kiss project, any dropped-field
warnings, the guardrails decision, and the full list of `/nerv bind <projectPath>` commands — and
makes **no writes** (verify via `nervClient`'s `projects` collection count before/after). Only
after reviewing this manifest, re-run with `--apply`.

- [ ] **Step 4: Commit**

```bash
git add tools/import-kiss-projects.ts
git commit -m "feat(import): add importer CLI entrypoint (dry-run default)"
```

---

### Task 6: `mintTranscriptToken`/`verifyTranscriptToken`

**Files:**

- Modify: `src/mcp-server/token.ts`
- Test: `tests/mcp-server/token.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/mcp-server/token.test.ts` (append a new `describe` block; keep the existing `plugin mcp token` block untouched):

```typescript
import { describe, expect, test } from 'bun:test'

import {
  mintPluginMcpToken,
  mintTranscriptToken,
  verifyPluginMcpToken,
  verifyTranscriptToken,
} from '../../src/mcp-server/token.js'

// ... existing `describe('plugin mcp token', ...)` block unchanged ...

describe('transcript token', () => {
  test('round-trips a valid magiSessionId', () => {
    const token = mintTranscriptToken('sess-42')
    expect(verifyTranscriptToken(token)).toEqual({ magiSessionId: 'sess-42' })
  })

  test('rejects a tampered payload', () => {
    const token = mintTranscriptToken('sess-42')
    const [, sig] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ v: 1, kind: 'transcript', magiSessionId: 'evil', exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url')
    expect(verifyTranscriptToken(`${forged}.${sig}`)).toBeNull()
  })

  test('rejects an expired token', () => {
    const token = mintTranscriptToken('sess-42', 1)
    expect(verifyTranscriptToken(token, Date.now() + 2000)).toBeNull()
  })

  test('rejects a plugin-mcp token presented as a transcript token (wrong kind)', () => {
    const pluginToken = mintPluginMcpToken({ storageContextId: 'c', chatUserId: 'u', pluginId: 'p' })
    expect(verifyTranscriptToken(pluginToken)).toBeNull()
  })

  test('rejects a malformed token', () => {
    expect(verifyTranscriptToken('not-a-token')).toBeNull()
    expect(verifyTranscriptToken('')).toBeNull()
  })

  test('never throws on adversarial input', () => {
    const adversarial = ['', '.', 'a.b', 'not-a-token', 'x'.repeat(100_000), '.'.repeat(50), '=====.=====']
    for (const input of adversarial) {
      expect(() => verifyTranscriptToken(input)).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp-server/token.test.ts`
Expected: FAIL — `Export named 'mintTranscriptToken' not found in module '../../src/mcp-server/token.js'`

- [ ] **Step 3: Implement `mintTranscriptToken`/`verifyTranscriptToken`**

In `src/mcp-server/token.ts`, add after `verifyPluginMcpToken`:

```typescript
/** Claims carried by a papai transcript-viewer capability token (`/t/<token>`). */
export interface TranscriptTokenClaims {
  magiSessionId: string
}

interface TranscriptTokenEnvelope extends TranscriptTokenClaims {
  v: 1
  /** Discriminator so a plugin-MCP token can never be replayed as a transcript token or vice versa. */
  kind: 'transcript'
  exp: number
}

/**
 * Mint a signed, time-bounded capability token binding papai's public `/t/<token>` route to a
 * magi session id. Reuses the plugin-MCP token's signing secret (same HMAC key, distinct `kind`).
 */
export function mintTranscriptToken(magiSessionId: string, ttlSeconds: number = PLUGIN_MCP_TOKEN_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const envelope: TranscriptTokenEnvelope = { v: 1, kind: 'transcript', exp, magiSessionId }
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Verify a transcript token; returns the claims or null (invalid signature, expired, malformed, or wrong kind). Never throws. */
export function verifyTranscriptToken(raw: string, nowMs: number = Date.now()): TranscriptTokenClaims | null {
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  const payload = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    if (!signaturesMatch(sig, sign(payload))) return null
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (typeof decoded !== 'object' || decoded === null) return null
    const env = decoded as Partial<TranscriptTokenEnvelope>
    if (env.v !== 1 || env.kind !== 'transcript' || typeof env.exp !== 'number') return null
    if (typeof env.magiSessionId !== 'string' || env.magiSessionId.length === 0) return null
    if (Math.floor(nowMs / 1000) >= env.exp) return null
    return { magiSessionId: env.magiSessionId }
  } catch (err) {
    log.debug({ error: err instanceof Error ? err.message : String(err) }, 'failed to decode transcript token payload')
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/mcp-server/token.test.ts`
Expected: PASS (11 tests, all green)

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/token.ts tests/mcp-server/token.test.ts
git commit -m "feat(mcp-server): add mintTranscriptToken/verifyTranscriptToken"
```

---

### Task 7: Repoint the transcript proxy to magi's real endpoint

**Files:**

- Modify: `src/debug/transcript-viewer.ts`
- Test: `tests/debug/transcript-viewer.test.ts`, `tests/debug/transcript-viewer-e2e.test.ts`

- [ ] **Step 1: Rewrite the failing tests**

Replace `tests/debug/transcript-viewer.test.ts` in full:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

import { mintTranscriptToken } from '../../src/mcp-server/token.js'
import {
  getViewerMagiConfig,
  proxyTranscriptHistory,
  proxyTranscriptStream,
  routeTranscriptPaths,
} from '../../src/debug/transcript-viewer.js'
import type { ViewerMagiConfig } from '../../src/debug/transcript-viewer.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../utils/test-helpers.js'

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

// Locally (and in CI's `check` job, which downloads the `build` job's
// `public/` artifact) `bun build:client` may already have produced these
// files, so we can't rely on ambient absence to exercise the missing-file
// 404 path. Deterministically hide the real file for the duration of the
// test, then restore it, so the assertion holds regardless of build state.
async function withFileHidden(fileName: string, run: () => Promise<void>): Promise<void> {
  const filePath = path.join(PUBLIC_DIR, fileName)
  const hiddenPath = `${filePath}.test-hidden`
  const existed = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  if (existed) await fs.rename(filePath, hiddenPath)
  try {
    await run()
  } finally {
    if (existed) await fs.rename(hiddenPath, filePath)
  }
}

describe('getViewerMagiConfig', () => {
  test('returns trimmed baseUrl and token when both configured', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example/', 'test')
    setPluginAdminConfig('acp', 'magi_token', '  sekret  ', 'test')

    expect(getViewerMagiConfig()).toEqual({ baseUrl: 'https://magi.example', token: 'sekret' })
  })

  test('returns null when nothing configured', async () => {
    await setupTestDb()

    expect(getViewerMagiConfig()).toBeNull()
  })
})

describe('proxyTranscriptHistory', () => {
  const cfg: ViewerMagiConfig = { baseUrl: 'https://magi.example', token: 'sekret' }

  test('targets magi /sessions/:id/transcript, forwarding only after/limit query params with a bearer token', async () => {
    const seen = { url: '', auth: null as string | null }
    const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
      seen.url = url
      seen.auth = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
    }

    const url = new URL('https://papai.example/t/tok_z/transcript?after=5&limit=100&bogus=1')
    const response = await proxyTranscriptHistory(url, 'sess-42', cfg, new AbortController().signal, fetchImpl)

    expect(seen.url).toBe('https://magi.example/sessions/sess-42/transcript?after=5&limit=100')
    expect(seen.auth).toBe('Bearer sekret')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ events: [], nextCursor: null })
  })

  test('passes through a magi 404', async () => {
    const fetchImpl = (): Promise<Response> => Promise.resolve(new Response('not found', { status: 404 }))

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'sess-42', cfg, new AbortController().signal, fetchImpl)

    expect(response.status).toBe(404)
  })

  test('returns 502 without throwing when the upstream fetch rejects', async () => {
    mockLogger()
    const fetchImpl = (): Promise<Response> => Promise.reject(new Error('DNS lookup failed'))

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'sess-42', cfg, new AbortController().signal, fetchImpl)

    expect(response.status).toBe(502)
  })

  test('does not leak upstream Set-Cookie/X-Powered-By headers', async () => {
    const fetchImpl = (): Promise<Response> =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'Set-Cookie': 'session=abc', 'X-Powered-By': 'Express', 'Content-Type': 'application/json' },
        }),
      )

    const url = new URL('https://papai.example/t/tok_z/transcript')
    const response = await proxyTranscriptHistory(url, 'sess-42', cfg, new AbortController().signal, fetchImpl)

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-powered-by')).toBeNull()
  })
})

function signalOf(init: RequestInit | undefined): AbortSignal | null {
  return init?.signal ?? null
}

describe('proxyTranscriptStream', () => {
  const cfg: ViewerMagiConfig = { baseUrl: 'https://magi.example', token: 'sekret' }

  test('targets magi /sessions/:id/stream, streaming SSE frames through with client-signal binding', async () => {
    const seen = { url: '', auth: null as string | null, signal: null as AbortSignal | null }
    const clientSignal = new AbortController().signal
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
        controller.close()
      },
    })
    const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
      seen.url = url
      seen.auth = new Headers(init?.headers).get('Authorization')
      seen.signal = signalOf(init)
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }

    const response = await proxyTranscriptStream('sess-42', cfg, clientSignal, fetchImpl)

    expect(seen.url).toBe('https://magi.example/sessions/sess-42/stream')
    expect(seen.auth).toBe('Bearer sekret')
    expect(seen.signal).toBe(clientSignal)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toBe('data: hello\n\n')
  })

  test('passes through a magi 404', async () => {
    const clientSignal = new AbortController().signal
    const fetchImpl = (): Promise<Response> => Promise.resolve(new Response('not found', { status: 404 }))

    const response = await proxyTranscriptStream('sess-42', cfg, clientSignal, fetchImpl)

    expect(response.status).toBe(404)
  })

  test('returns 502 without throwing when the upstream fetch rejects', async () => {
    mockLogger()
    const clientSignal = new AbortController().signal
    const fetchImpl = (): Promise<Response> => Promise.reject(new Error('connection reset'))

    const response = await proxyTranscriptStream('sess-42', cfg, clientSignal, fetchImpl)

    expect(response.status).toBe(502)
  })

  test('does not leak upstream Set-Cookie/X-Powered-By headers', async () => {
    const clientSignal = new AbortController().signal
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
        controller.close()
      },
    })
    const fetchImpl = (): Promise<Response> =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'session=abc', 'X-Powered-By': 'Express' },
        }),
      )

    const response = await proxyTranscriptStream('sess-42', cfg, clientSignal, fetchImpl)

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-powered-by')).toBeNull()
  })
})

describe('routeTranscriptPaths', () => {
  test('falls through null for a non-/t path', async () => {
    const url = new URL('https://papai.example/settings')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).toBeNull()
  })

  test('returns 404 for an unknown /t/<token>/<sub> subpath', async () => {
    await setupTestDb()
    const url = new URL('https://papai.example/t/tok_z/bogus')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
  })

  test('returns 404 for /t/<token>/stream and /t/<token>/transcript when the token is invalid, without attempting the proxy', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example', 'test')
    setPluginAdminConfig('acp', 'magi_token', 'sekret', 'test')
    const calls: string[] = []
    setMockFetch((url: string): Promise<Response> => {
      calls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    try {
      const streamUrl = new URL('https://papai.example/t/not-a-real-token/stream')
      const streamResponse = await routeTranscriptPaths(new Request(streamUrl), streamUrl)
      expect(streamResponse?.status).toBe(404)

      const transcriptUrl = new URL('https://papai.example/t/not-a-real-token/transcript')
      const transcriptResponse = await routeTranscriptPaths(new Request(transcriptUrl), transcriptUrl)
      expect(transcriptResponse?.status).toBe(404)
    } finally {
      restoreFetch()
    }
    expect(calls).toEqual([])
  })

  test('returns 404 for an expired token', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example', 'test')
    setPluginAdminConfig('acp', 'magi_token', 'sekret', 'test')
    const expiredToken = mintTranscriptToken('sess-1', -1)
    const url = new URL(`https://papai.example/t/${expiredToken}/transcript`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response?.status).toBe(404)
  })

  test('returns 503 for /t/<token>/stream when magi is not configured, given a valid token', async () => {
    await setupTestDb()
    const token = mintTranscriptToken('sess-1')
    const url = new URL(`https://papai.example/t/${token}/stream`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
  })

  test('returns 503 for /t/<token>/transcript when magi is not configured, given a valid token', async () => {
    await setupTestDb()
    const token = mintTranscriptToken('sess-1')
    const url = new URL(`https://papai.example/t/${token}/transcript`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
  })

  // The shell/asset routes must 404 cleanly when public/transcript.{html,js,css}
  // is missing (e.g. build:client hasn't run yet) rather than let Bun.file 500
  // later. Hide the real file for the duration of the test so this holds even
  // when a build already populated public/ (as CI's `check` job does).
  test('cleanly 404s the shell route for a bare /t/<token> while the file is missing', async () => {
    await withFileHidden('transcript.html', async () => {
      const url = new URL('https://papai.example/t/tok_z')
      const response = await routeTranscriptPaths(new Request(url), url)

      expect(response).not.toBeNull()
      expect(response?.status).toBe(404)
    })
  })

  test('cleanly 404s the /t.js asset route while the file is missing', async () => {
    await withFileHidden('transcript.js', async () => {
      const url = new URL('https://papai.example/t.js')
      const response = await routeTranscriptPaths(new Request(url), url)

      expect(response).not.toBeNull()
      expect(response?.status).toBe(404)
    })
  })

  test('cleanly 404s the /t.css asset route while the file is missing', async () => {
    await withFileHidden('transcript.css', async () => {
      const url = new URL('https://papai.example/t.css')
      const response = await routeTranscriptPaths(new Request(url), url)

      expect(response).not.toBeNull()
      expect(response?.status).toBe(404)
    })
  })

  test('returns 404 for an empty token', async () => {
    const url = new URL('https://papai.example/t/')
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
  })

  test('proxies a valid minted token to magi /sessions/:id/transcript with the bearer', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example', 'test')
    setPluginAdminConfig('acp', 'magi_token', 'sekret', 'test')
    const token = mintTranscriptToken('sess-live')
    const seen = { url: '' }
    setMockFetch((fetchUrl: string): Promise<Response> => {
      seen.url = fetchUrl
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    try {
      const url = new URL(`https://papai.example/t/${token}/transcript`)
      await routeTranscriptPaths(new Request(url), url)
    } finally {
      restoreFetch()
    }

    expect(seen.url).toBe('https://magi.example/sessions/sess-live/transcript')
  })
})
```

- [ ] **Step 2: Rewrite the e2e test**

Replace `tests/debug/transcript-viewer-e2e.test.ts` in full:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { HistoryResponseSchema } from '../../client/transcript/fetcher-schemas.js'
import { routeTranscriptPaths } from '../../src/debug/transcript-viewer.js'
import { mintTranscriptToken } from '../../src/mcp-server/token.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

const STUB_SESSION_ID = 'stub-session-id'

describe('transcript viewer end-to-end against a stub magi', () => {
  let server: ReturnType<typeof Bun.serve> | null = null
  let baseUrl = ''
  let token = ''

  beforeEach(async () => {
    await setupTestDb()
    token = mintTranscriptToken(STUB_SESSION_ID)

    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === `/sessions/${STUB_SESSION_ID}/transcript`) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  seq: 0,
                  ts: '2026-07-05T00:00:00.000Z',
                  type: 'update',
                  payload: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
                },
              ],
              nextCursor: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname === `/sessions/${STUB_SESSION_ID}/stream`) {
          const body = new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(
                new TextEncoder().encode(
                  `event: update\ndata: ${JSON.stringify({
                    seq: 0,
                    ts: '2026-07-05T00:00:00.000Z',
                    type: 'update',
                    payload: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
                  })}\n\n`,
                ),
              )
              controller.enqueue(new TextEncoder().encode('event: end\ndata: {}\n\n'))
              controller.close()
            },
          })
          return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        return new Response('not found', { status: 404 })
      },
    })
    baseUrl = server.url.origin

    setPluginAdminConfig('acp', 'magi_base_url', baseUrl, 'test')
    setPluginAdminConfig('acp', 'magi_token', 'stub-bearer', 'test')
  })

  afterEach(async () => {
    await server?.stop(true)
    server = null
    baseUrl = ''
  })

  test('proxies paginated history from the stub magi transcript endpoint', async () => {
    const url = new URL(`https://papai.example/t/${token}/transcript`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    const body = HistoryResponseSchema.parse(await response?.json())
    expect(body.events).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
    expect(body.events[0]).toMatchObject({
      seq: 0,
      type: 'update',
      payload: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
    })
  })

  test('proxies the SSE stream byte-for-byte from the stub magi stream endpoint', async () => {
    const url = new URL(`https://papai.example/t/${token}/stream`)
    const response = await routeTranscriptPaths(new Request(url), url)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('text/event-stream')
    const text = await response?.text()
    expect(text).toContain('event: update')
    expect(text).toContain('"content":"hi"')
    expect(text).toContain('event: end')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/debug/transcript-viewer.test.ts tests/debug/transcript-viewer-e2e.test.ts`
Expected: FAIL — assertion mismatches (e.g. `seen.url` still equals `https://magi.example/t/sess-42/transcript` instead of `https://magi.example/sessions/sess-42/transcript`; the new "returns 404 for an invalid token" tests fail because today every token is forwarded verbatim, never rejected).

- [ ] **Step 4: Repoint the proxy functions and add token verification**

In `src/debug/transcript-viewer.ts`, add the import and update the three functions:

```typescript
import path from 'node:path'

import { logger } from '../logger.js'
import { verifyTranscriptToken } from '../mcp-server/token.js'
import { getPluginAdminConfig } from '../plugins/store.js'
```

Replace `proxyTranscriptHistory`:

```typescript
export async function proxyTranscriptHistory(
  url: URL,
  magiSessionId: string,
  cfg: ViewerMagiConfig,
  clientSignal: AbortSignal,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const params = new URLSearchParams()
  for (const [k, v] of url.searchParams) if (ALLOWED_QUERY.has(k)) params.set(k, v)
  const qs = params.toString()
  const target = `${cfg.baseUrl}/sessions/${encodeURIComponent(magiSessionId)}/transcript${qs === '' ? '' : `?${qs}`}`
  let upstream: Response
  try {
    upstream = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      signal: AbortSignal.any([clientSignal, AbortSignal.timeout(15_000)]),
    })
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'transcript history upstream fetch failed',
    )
    return new Response('upstream unavailable', { status: 502 })
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}
```

Replace `proxyTranscriptStream`:

```typescript
export async function proxyTranscriptStream(
  magiSessionId: string,
  cfg: ViewerMagiConfig,
  clientSignal: AbortSignal,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const target = `${cfg.baseUrl}/sessions/${encodeURIComponent(magiSessionId)}/stream`
  let upstream: Response
  try {
    upstream = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'text/event-stream' },
      signal: clientSignal,
    })
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'transcript stream upstream fetch failed',
    )
    return new Response('upstream unavailable', { status: 502 })
  }
  if (!upstream.ok || upstream.body === null) {
    return new Response('upstream stream unavailable', { status: upstream.ok ? 502 : upstream.status })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
```

Replace `routeTranscriptPaths`:

```typescript
/**
 * Deliberately PUBLIC, no-auth capability-token routes: possession of the
 * opaque `/t/<token>` token is the access control. Mounted before the
 * debug-server auth gate — do not move this behind it. The token itself is
 * verified here (via `verifyTranscriptToken`) before any proxy call is made.
 */
export async function routeTranscriptPaths(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/t.js') return serveAsset('transcript.js', 'text/javascript')
  if (url.pathname === '/t.css') return serveAsset('transcript.css', 'text/css')
  if (!url.pathname.startsWith('/t/')) return null
  const rest = url.pathname.slice('/t/'.length)
  const slash = rest.indexOf('/')
  const rawToken = slash === -1 ? rest : rest.slice(0, slash)
  const sub = slash === -1 ? '' : rest.slice(slash + 1)
  if (rawToken === '') return new Response('Not found', { status: 404 })
  const token = decodeToken(rawToken)
  if (sub === '') return serveShell()
  if (sub === 'stream' || sub === 'transcript') {
    const claims = verifyTranscriptToken(token)
    if (claims === null) return new Response('Not found', { status: 404 })
    const cfg = getViewerMagiConfig()
    if (cfg === null) return new Response('transcript viewer not configured', { status: 503 })
    const response =
      sub === 'stream'
        ? await proxyTranscriptStream(claims.magiSessionId, cfg, req.signal)
        : await proxyTranscriptHistory(url, claims.magiSessionId, cfg, req.signal)
    return response
  }
  return new Response('Not found', { status: 404 })
}
```

`getViewerMagiConfig`, `serveAsset`, `serveShell`, and `decodeToken` are unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/debug/transcript-viewer.test.ts tests/debug/transcript-viewer-e2e.test.ts`
Expected: PASS (23 + 2 tests, all green)

- [ ] **Step 6: Commit**

```bash
git add src/debug/transcript-viewer.ts tests/debug/transcript-viewer.test.ts tests/debug/transcript-viewer-e2e.test.ts
git commit -m "fix(transcript-viewer): verify token and proxy to magi's real /sessions endpoint"
```

---

### Task 8: `transcript` plugin facade

**Files:**

- Create: `src/plugins/transcript-facade.ts`
- Test: `tests/plugins/transcript-facade.test.ts`
- Modify: `src/plugins/runtime-types.ts`, `src/plugins/tool-runtime.ts`
- Test: `tests/plugins/tool-runtime.test.ts`

- [ ] **Step 1: Write the failing standalone facade test**

Create `tests/plugins/transcript-facade.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { buildTranscriptFacade } from '../../src/plugins/transcript-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  await setupTestDb()
})
afterEach(() => {
  delete process.env['INSTANCE_CONFIG_KEY']
  delete process.env['SETTINGS_PUBLIC_BASE_URL']
})

test('mintUrl returns null when no public base URL is configured', () => {
  delete process.env['SETTINGS_PUBLIC_BASE_URL']
  const facade = buildTranscriptFacade('acp', true)
  expect(facade.mintUrl('sess-1')).toBeNull()
})

test('mintUrl returns an absolute /t/<token> URL when a public base URL is configured', () => {
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
  const facade = buildTranscriptFacade('acp', true)
  const url = facade.mintUrl('sess-1')
  expect(url).not.toBeNull()
  expect(url).toMatch(/^https:\/\/papai\.example\/t\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
})

test('mintUrl throws without the coding.secrets permission', () => {
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
  const facade = buildTranscriptFacade('acp', false)
  expect(() => facade.mintUrl('sess-1')).toThrow("does not have 'coding.secrets' permission")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/transcript-facade.test.ts`
Expected: FAIL — `Cannot find module '../../src/plugins/transcript-facade.js'`

- [ ] **Step 3: Add `transcript` to `PluginToolRuntimeContext`**

In `src/plugins/runtime-types.ts`, add to `PluginToolRuntimeContext` (after `codingRepos`):

```typescript
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): CodingRepoEntry | null
  }
  transcript: {
    /** Mints a papai `/t/<token>` transcript URL for a magi session id, or null if no public base URL is configured. */
    mintUrl(magiSessionId: string): string | null
  }
}
```

- [ ] **Step 4: Implement `buildTranscriptFacade`**

Create `src/plugins/transcript-facade.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mintTranscriptToken } from '../mcp-server/token.js'
import { getSettingsPublicBaseUrl } from '../settings/config.js'
import { deny } from './deny.js'
import type { PluginToolRuntimeContext } from './types.js'

/** Mints papai `/t/<token>` transcript URLs, gated on the `coding.secrets` permission (mirrors `coding-secrets-facade.ts`). */
export function buildTranscriptFacade(
  pluginId: string,
  hasPermission: boolean,
): PluginToolRuntimeContext['transcript'] {
  return Object.freeze({
    mintUrl(magiSessionId: string): string | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      const base = getSettingsPublicBaseUrl()
      if (base === null) return null
      return `${base}/t/${encodeURIComponent(mintTranscriptToken(magiSessionId))}`
    },
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/plugins/transcript-facade.test.ts`
Expected: PASS (3 tests, all green)

- [ ] **Step 6: Wire the facade into `buildPluginToolRuntimeContext` (with a failing wiring test first)**

Add to `tests/plugins/tool-runtime.test.ts`, a new `describe` block after `describe('attachments facade', ...)`:

```typescript
describe('transcript facade', () => {
  test('provides a working transcript.mintUrl on the runtime context', () => {
    const ctx = buildPluginToolRuntimeContext(
      'test-plugin',
      makeManifest({ permissions: ['coding.secrets'] }),
      makeRuntime(),
    )
    expect(ctx.transcript).toBeDefined()
    expect(typeof ctx.transcript.mintUrl).toBe('function')
    // No SETTINGS_PUBLIC_BASE_URL configured in the test env → null, not a throw.
    expect(ctx.transcript.mintUrl('sess-1')).toBeNull()
  })

  test('throws when plugin lacks coding.secrets permission', () => {
    const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest({ permissions: [] }), makeRuntime())
    expect(() => ctx.transcript.mintUrl('sess-1')).toThrow(/coding\.secrets/u)
  })
})
```

Run: `bun test tests/plugins/tool-runtime.test.ts`
Expected: FAIL — `ctx.transcript is undefined`

- [ ] **Step 7: Wire `buildTranscriptFacade` into `buildPluginToolRuntimeContext`**

In `src/plugins/tool-runtime.ts`, add the import:

```typescript
import { buildCodingReposFacade, buildCodingSecretsFacade } from './coding-secrets-facade.js'
import { deny } from './deny.js'
import { buildIdentityFacade } from './identity-facade.js'
import { consumePluginQuota } from './rate-limit.js'
import { buildTranscriptFacade } from './transcript-facade.js'
```

And add the field at the end of `buildPluginToolRuntimeContext`'s returned object:

```typescript
    codingRepos: buildCodingReposFacade(pluginId, runtime.storageContextId, permissions.has('coding.secrets')),
    transcript: buildTranscriptFacade(pluginId, permissions.has('coding.secrets')),
  })
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/plugins/tool-runtime.test.ts tests/plugins/transcript-facade.test.ts`
Expected: PASS (all green)

- [ ] **Step 9: Commit**

```bash
git add src/plugins/transcript-facade.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts tests/plugins/transcript-facade.test.ts tests/plugins/tool-runtime.test.ts
git commit -m "feat(plugins): add transcript facade to the plugin tool runtime context"
```

---

### Task 9: ACP surfaces the minted transcript URL

**Files:**

- Modify: `plugins/acp/tools.ts`, `plugins/acp/session-tools.ts`, `plugins/acp/continue-tool.ts`, `tests/plugins/acp/support.ts`
- Test: `tests/plugins/acp/start-session.test.ts`, `tests/plugins/acp/continue-session.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/plugins/acp/start-session.test.ts`, inside `describe('acp start_session tool', ...)` (after the existing `'records shareToken/transcriptUrl from the magi response'` test):

```typescript
test('includes a minted transcriptUrl in the result and stored record when transcript.mintUrl resolves', async () => {
  const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ id: 'sess-mint', status: 'queued' }, 202))
  const store = new Map<string, string>()
  const { tools } = activate(httpFetch)
  const ctx = {
    ...runtimeCtxWithKv(store),
    transcript: { mintUrl: (magiSessionId: string): string => `https://papai.example/t/${magiSessionId}-tok` },
  }
  const result = await tools.get('start_session')!.execute({ project: 'demo', prompt: 'do it' }, ctx, options())
  expect(asRecord(result)['transcriptUrl']).toBe('https://papai.example/t/sess-mint-tok')
  const rec = readStoredRecord(store, 'sess-mint')
  expect(rec['transcriptUrl']).toBe('https://papai.example/t/sess-mint-tok')
})
```

Add to `tests/plugins/acp/continue-session.test.ts`, inside `describe('acp continue_session tool', ...)`:

```typescript
test('includes a minted transcriptUrl in the result and stored child record when transcript.mintUrl resolves', async () => {
  const calls: string[] = []
  const httpFetch = followUpOnlyFetch('p1', { id: 'c-mint', status: 'queued', parentSessionId: 'p1' }, calls)
  const store = new Map<string, string>()
  writeRecord(runtimeCtxWithKv(store).kv, 'p1', { project: 'demo', title: 't', createdAt: 'x' })
  const { tools } = activate(httpFetch)
  const ctx = {
    ...runtimeCtxWithKv(store),
    transcript: { mintUrl: (magiSessionId: string): string => `https://papai.example/t/${magiSessionId}-tok` },
  }
  const res = asRecord(await tools.get('continue_session')!.execute({ sessionId: 'p1', prompt: 'go' }, ctx, options()))
  expect(res['transcriptUrl']).toBe('https://papai.example/t/c-mint-tok')
  const child = readStoredRecord(store, 'c-mint')
  expect(child['transcriptUrl']).toBe('https://papai.example/t/c-mint-tok')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/acp/start-session.test.ts tests/plugins/acp/continue-session.test.ts`
Expected: FAIL — TypeScript error, `Property 'transcript' is missing in type` (the `RuntimeContext` type in `plugins/acp/tools.ts` doesn't have `transcript` yet, and `support.ts`'s fixtures don't provide it either).

- [ ] **Step 3: Add `transcript` to the plugin-local `RuntimeContext` type**

In `plugins/acp/tools.ts`, add to `RuntimeContext` (after `codingRepos`):

```typescript
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): {
      name: string
      repoUrl: string
      baseBranch: string
      permissionPreset: string
      additionalEgressDomains?: string[]
    } | null
  }
  transcript: {
    mintUrl(magiSessionId: string): string | null
  }
}
```

- [ ] **Step 4: Add the default `transcript` fixture to `support.ts`**

In `tests/plugins/acp/support.ts`, add `transcript: { mintUrl: () => null },` at the end of BOTH `runtimeCtx`'s and `runtimeCtxWithKv`'s returned objects (right after `codingRepos: codingRepos ?? defaultCodingRepos(),` in each):

```typescript
    codingRepos: codingRepos ?? defaultCodingRepos(),
    transcript: { mintUrl: (): null => null },
  } as PluginToolRuntimeContext
}
```

(Applies to both `runtimeCtx` and `runtimeCtxWithKv`.)

- [ ] **Step 5: Mint a transcript URL in `startSessionTool`**

In `plugins/acp/session-tools.ts`, replace the tail of `startSessionTool`'s `execute`:

```typescript
      const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
        agent,
        contextId: runtimeContext.storageContextId,
        prompt,
        secrets,
        ...(forgeToken === null ? {} : { forgeToken }),
        ...(prNumber === null ? {} : { prNumber }),
        projectSpec,
        ...(Object.keys(mcpTokens).length === 0 ? {} : { mcpTokens }),
      })
      const sessionId = sessionIdOf(result)
      const mintedUrl = sessionId === null ? null : runtimeContext.transcript.mintUrl(sessionId)
      const withTranscript = mintedUrl === null ? result : { ...asObject(result), transcriptUrl: mintedUrl }
      recordStartedSession(runtimeContext, withTranscript, project, prompt, prNumber ?? undefined)
      return withTranscript
    },
  }
}
```

- [ ] **Step 6: Mint a transcript URL in `continueSessionTool`**

In `plugins/acp/continue-tool.ts`, replace the tail of `continueSessionTool`'s `execute`:

```typescript
      const result = await callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(parentId)}/follow-up`, {
        prompt,
        contextId: runtimeContext.storageContextId,
        secrets,
        forgeToken,
        ...(Object.keys(mcpTokens).length === 0 ? {} : { mcpTokens }),
      })
      const childId = sessionIdOf(result)
      const mintedUrl = childId === null ? null : runtimeContext.transcript.mintUrl(childId)
      const withTranscript = mintedUrl === null ? result : { ...asObject(result), transcriptUrl: mintedUrl }
      if (childId !== null)
        writeRecord(runtimeContext.kv, childId, {
          ...buildChildRecord(parentId, parentRecord, prompt),
          ...shareFieldsOf(withTranscript),
        })
      return withTranscript
    },
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/plugins/acp/start-session.test.ts tests/plugins/acp/continue-session.test.ts`
Expected: PASS (16 + 5 tests, all green — including the pre-existing `'records shareToken/transcriptUrl from the magi response'` test, which still passes because the fixture's default `transcript.mintUrl` returns `null`, leaving the magi-provided `transcriptUrl` untouched).

- [ ] **Step 8: Run the full ACP plugin suite to check for regressions**

Run: `bun test tests/plugins/acp/`
Expected: PASS (all files green)

- [ ] **Step 9: Commit**

```bash
git add plugins/acp/tools.ts plugins/acp/session-tools.ts plugins/acp/continue-tool.ts tests/plugins/acp/support.ts tests/plugins/acp/start-session.test.ts tests/plugins/acp/continue-session.test.ts
git commit -m "feat(acp): surface a minted transcriptUrl on start_session/continue_session"
```

---

### Task 10: `notify-route.ts` accepts `magiSessionId`

**Files:**

- Modify: `src/debug/notify-route.ts`
- Test: `tests/debug/notify-route.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/debug/notify-route.test.ts`, inside `describe('handleNotifyRoute', ...)` (after the existing `'returns 502 when delivery throws'` test), and extend the `afterEach`:

```typescript
afterEach(() => {
  delete process.env['NOTIFY_TOKEN']
  delete process.env['SETTINGS_PUBLIC_BASE_URL']
  resetNotifyTokenCacheForTesting()
  clearRuntimeChatRouter()
})

// ... existing tests unchanged, then:

test('appends a transcript link when magiSessionId is present and a public base URL is configured', async () => {
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
  const router = new RecordingRouter()
  setRuntimeChatRouter(router)
  const res = await handleNotifyRoute(
    notifyReq('tok', { contextId: 'user-1', markdown: 'done', magiSessionId: 'sess-1' }),
  )
  expect(res.status).toBe(200)
  expect(router.sent[0]?.markdown).toContain('done')
  expect(router.sent[0]?.markdown).toMatch(/https:\/\/papai\.example\/t\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u)
})

test('leaves markdown unchanged when magiSessionId is absent (backward compat)', async () => {
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
  const router = new RecordingRouter()
  setRuntimeChatRouter(router)
  const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'done' }))
  expect(res.status).toBe(200)
  expect(router.sent[0]?.markdown).toBe('done')
})

test('leaves markdown unchanged when magiSessionId is present but no public base URL is configured', async () => {
  const router = new RecordingRouter()
  setRuntimeChatRouter(router)
  const res = await handleNotifyRoute(
    notifyReq('tok', { contextId: 'user-1', markdown: 'done', magiSessionId: 'sess-1' }),
  )
  expect(res.status).toBe(200)
  expect(router.sent[0]?.markdown).toBe('done')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/notify-route.test.ts`
Expected: FAIL — first new test fails because `magiSessionId` is stripped by `NotifyBodySchema` (extra keys are dropped by Zod's default object parsing, so `markdown` is delivered unchanged and the link never appears).

- [ ] **Step 3: Accept `magiSessionId` and append the transcript link**

In `src/debug/notify-route.ts`, add imports:

```typescript
import { isAuthorizedGroup } from '../authorized-groups.js'
import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
import {
  getConfigContextIdFromStorageContextId,
  getNativeContextId,
  isScopedThreadContextId,
  parseScopedContextId,
} from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { dmTarget } from '../chat/types.js'
import { logger } from '../logger.js'
import { mintTranscriptToken } from '../mcp-server/token.js'
import { getNotifyToken } from '../notify-token.js'
import { recordProactiveInHistory } from '../proactive-history.js'
import { getSettingsPublicBaseUrl } from '../settings/config.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'
import { jsonResponse } from './json-response.js'
```

Update the schema:

```typescript
const NotifyBodySchema = z.object({
  contextId: z.string().min(1),
  contextType: z.enum(['dm', 'group']).optional(),
  threadId: z.string().min(1).optional(),
  markdown: z.string().min(1),
  /** magi session id (from nerv's PapaiTaskNotifier); when present, papai mints and appends a `/t/<token>` transcript link. */
  magiSessionId: z.string().min(1).optional(),
})
```

Add a helper (near `buildNotifyTarget`):

```typescript
/** Appends a `/t/<token>` transcript link when `magiSessionId` is present and a public base URL is configured. No-op otherwise (fail-safe — never crashes a notify). */
const appendTranscriptLink = (markdown: string, magiSessionId: string | undefined): string => {
  if (magiSessionId === undefined) return markdown
  const base = getSettingsPublicBaseUrl()
  if (base === null) return markdown
  const url = `${base}/t/${encodeURIComponent(mintTranscriptToken(magiSessionId))}`
  return `${markdown}\n\n[Watch the session live](${url})`
}
```

Update `handleNotifyRoute`'s tail:

```typescript
  const chat = getRuntimeChatRouter()
  if (chat === null) return jsonResponse({ error: 'chat router not running' }, { status: 422 })

  const target = buildNotifyTarget(parsed.data, isAuthorizedGroup(parsed.data.contextId))
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) return jsonResponse({ error: 'context not deliverable' }, { status: 404 })

  const markdown = appendTranscriptLink(parsed.data.markdown, parsed.data.magiSessionId)
  return sendNotify(chat, platformInstanceId, target, parsed.data.contextId, markdown)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/notify-route.test.ts`
Expected: PASS (all tests green — including the pre-existing `'records the delivered notify markdown into history on success'` test, since that test's body has no `magiSessionId`, so `appendTranscriptLink` is a no-op and `markdown` still equals `'Milestone hit'`).

- [ ] **Step 5: Commit**

```bash
git add src/debug/notify-route.ts tests/debug/notify-route.test.ts
git commit -m "feat(notify): accept optional magiSessionId and append a transcript link"
```

---

## Final verification

After all 10 tasks:

```bash
bun run typecheck
bun test
bun run lint
```

Expected: all green. This exercises every new/modified file (`tools/import-kiss-projects*.ts`,
`src/mcp-server/token.ts`, `src/debug/transcript-viewer.ts`, `src/plugins/transcript-facade.ts`,
`src/plugins/runtime-types.ts`, `src/plugins/tool-runtime.ts`, `plugins/acp/*.ts`,
`src/debug/notify-route.ts`, `src/coding-credentials/guardrails.ts`) plus their full existing
test suites, confirming no regressions in the surrounding ACP/transcript/notify/plugin-runtime
code this plan touches.

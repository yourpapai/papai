<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Harness Hygiene Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eight non-coverage hygiene findings from the harness branch analysis so the branch merges clean and its evidence is trustworthy.

**Architecture:** Eight small, independently committable fixes per `docs/superpowers/specs/2026-07-19-harness-hygiene-design.md`: commit stranded docs, per-record catalog dates, one unambiguous catalog mapping, Windows fail-closed honesty, single-sourcing the pinned Docker image, dependency-cache eviction, annotating the historical identity-scoping entry, and seam-API documentation.

**Tech Stack:** Bun, TypeScript (strict), bun:test, GitHub Actions YAML, oxfmt/oxlint/tsgo gates.

**Spec:** `docs/superpowers/specs/2026-07-19-harness-hygiene-design.md`

**Frozen-tree note:** `tests/stories/**` and `scripts/story/**` are frozen compat inputs. Tasks 2 and 4 change frozen bytes — after this batch, record a fresh baseline manifest (`bun test:stories:manifest`) and use this branch's HEAD as the new compat baseline ref. A baseline recorded before these changes will (correctly) report the changed files as added/changed.

---

### Task 1: Commit stranded ADR documentation, drop `.opencode` drift

**Files:**

- Add: `docs/adr/0225-hermetic-story-execution-docker-sandbox.md`
- Modify: `docs/adr/README.md`
- Revert: `.opencode/package.json`, `.opencode/package-lock.json`

- [ ] **Step 1: Verify the working tree holds only the expected uncommitted changes**

Run: `git status --short`
Expected:

```
 M .opencode/package-lock.json
 M .opencode/package.json
 M docs/adr/README.md
?? docs/adr/0225-hermetic-story-execution-docker-sandbox.md
```

- [ ] **Step 2: Commit the ADR and its README row**

```bash
git add docs/adr/0225-hermetic-story-execution-docker-sandbox.md docs/adr/README.md
git commit -m "docs(adr): record hermetic story docker sandbox decision"
```

- [ ] **Step 3: Revert the unrelated opencode-plugin bump from this branch**

```bash
git checkout -- .opencode/package.json .opencode/package-lock.json
git status --short
```

Expected: clean working tree (no output).

---

### Task 2: Per-record `verifiedAt` dates and guest-readonly catalog mapping

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (type at :30-45, mapping table at :211-300, builder at :316-338)
- Test: `tests/stories/harness/catalog-coverage.test.ts`

The `CatalogCoverage` type literal-locks `verifiedAt: '2026-07-13'`, and one blanket constant stamps every record. Restructure the two story-id tables (`ACP_COMMAND_STORY_IDS` + `QUALIFICATION_STORY_IDS` + `executableStoryIdsFor`) into a single per-id mapping table carrying each record's real verification date, and map `SCN-task-guest-readonly` to its existing story.

- [ ] **Step 1: Write the failing tests**

Add to `tests/stories/harness/catalog-coverage.test.ts` inside the existing `describe('scenario catalog coverage', ...)` block:

```typescript
test('stamps settings catalog records with their verification date', () => {
  const settingsCoverage = catalogCoverage.filter(
    (coverage) => coverage.scenarioId.startsWith('SCN-settings-') && coverage.kind === 'executable',
  )

  expect(settingsCoverage).toHaveLength(11)
  for (const coverage of settingsCoverage) expect(coverage.verifiedAt).toBe('2026-07-18')
})

test('maps the guest-readonly catalog record to its executable story', () => {
  expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-task-guest-readonly')).toEqual({
    scenarioId: 'SCN-task-guest-readonly',
    catalogStatus: 'confirmed',
    kind: 'executable',
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/guest-readonly.story.test.ts#guest group turns can read tasks but cannot advertise writes',
    ],
  })
})

test('tracks the executable coverage total', () => {
  expect(catalogCoverage.filter((coverage) => coverage.kind === 'executable')).toHaveLength(30)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/stories/harness/catalog-coverage.test.ts`
Expected: FAIL — settings records still stamp `'2026-07-13'`, `SCN-task-guest-readonly` is `kind: 'pending'`, executable total is 29.

- [ ] **Step 3: Widen the `verifiedAt` type and restructure the mapping table**

In `tests/stories/catalog/coverage.ts`, change both `CatalogCoverage` union arms from `verifiedAt: '2026-07-13'` to `verifiedAt: string`:

```typescript
export type CatalogCoverage =
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'executable'
      verifiedAt: string
      storyIds: NonEmptyReadonlyTuple<string>
    }>
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'pending'
      verifiedAt: string
      reason: PendingReason
      requiredSeam?: string
    }>
```

Then replace the three declarations `ACP_COMMAND_STORY_IDS`, `QUALIFICATION_STORY_IDS`, and the `executableStoryIdsFor` function with one table (note: `ExecutableStoryMapping` and the table replace all three; keep every story id string byte-identical to the current file):

```typescript
type ExecutableStoryMapping = Readonly<{ verifiedAt: string; storyIds: NonEmptyReadonlyTuple<string> }>

const EXECUTABLE_STORY_MAPPINGS: Partial<Record<CatalogScenarioId, ExecutableStoryMapping>> = {
  'SCN-coding-acp-command': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts#SCN-coding-acp-command: eligible and ineligible runtime extension command and prompt',
    ],
  },
  'SCN-coding-acp-start-fresh': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-start-fresh: starts a configured session through the real ACP tool loop',
    ],
  },
  'SCN-coding-acp-start-on-pr': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-start-on-pr: starts a configured session with PR and forge token',
    ],
  },
  'SCN-coding-acp-cautious-permission-roundtrip': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-cautious-permission-roundtrip: resolves matching cautious decisions and leaves empty queues untouched',
    ],
  },
  'SCN-coding-acp-list-sessions': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-sessions: returns only sessions known to this chat',
    ],
  },
  'SCN-coding-acp-session-status': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-session-status: preserves a declared missing-session response without local mutation',
    ],
  },
  'SCN-coding-acp-list-projects': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-projects: lists the local repository catalogue without Magi',
    ],
  },
  'SCN-coding-acp-list-agents': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-agents: gets available agents through guarded Magi HTTP',
    ],
  },
  'SCN-coding-acp-finish-push': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-push: pushes with the exact requested finish payload',
    ],
  },
  'SCN-coding-acp-finish-pr': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-pr: opens a PR with the exact requested title and body',
    ],
  },
  'SCN-coding-acp-cancel': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-cancel: cancels exactly the selected coding session',
    ],
  },
  'SCN-coding-acp-continue-followup': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-continue-followup: continues a locally known session and records its child',
    ],
  },
  'SCN-coding-acp-continue-by-pr': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-continue-by-pr: follows up only the locally known matching PR session',
    ],
  },
  'SCN-coding-acp-mcp-session': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#SCN-coding-acp-mcp-session: starts a session with an exact configured MCP upstream and credential map',
    ],
  },
  'SCN-coding-acp-not-configured': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-not-configured: refuses an unconfigured start without creating a session',
    ],
  },
  'SCN-coding-acp-self-hosted-forge-preflight': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-self-hosted-forge-preflight: refuses a self-hosted repository without forge settings',
    ],
  },
  'SCN-coding-acp-whomayuse-denied': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-whomayuse-denied: hides session start from an operator-denied member',
    ],
  },
  'SCN-coding-acp-guest-denied': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-guest-denied: hides session start from a guest group turn',
    ],
  },
  'SCN-settings-bootstrap': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/context-and-instances.story.test.ts#SCN-settings-bootstrap: first-run session bootstraps a fresh personal context end to end',
    ],
  },
  'SCN-settings-instances': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/context-and-instances.story.test.ts#SCN-settings-instances: an admin-created task instance becomes assignable and serves the next turn',
    ],
  },
  'SCN-settings-context-config': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/context-and-instances.story.test.ts#SCN-settings-context-config: tool visibility config changes what the next turn posts',
    ],
  },
  'SCN-settings-identity': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/identity.story.test.ts#SCN-settings-identity: identity saved through settings resolves me in the next chat turn',
    ],
  },
  'SCN-settings-coding-agent-provider': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/module-settings-qualification.story.test.ts#SCN-settings-coding-agent-provider: updates coding credentials through settings and changes the next chat turn',
    ],
  },
  'SCN-settings-coding-forge': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/coding-surfaces.story.test.ts#SCN-settings-coding-forge: forge credentials saved through settings reach the session start',
    ],
  },
  'SCN-settings-coding-mcp': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/coding-surfaces.story.test.ts#SCN-settings-coding-mcp: MCP selections saved through settings reach the session start',
    ],
  },
  'SCN-settings-coding-repos': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/coding-surfaces.story.test.ts#SCN-settings-coding-repos: a repository registered through settings is listed and startable',
    ],
  },
  'SCN-settings-admin-guardrails': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/admin-surfaces.story.test.ts#SCN-settings-admin-guardrails: a guardrail saved through settings changes the advertised toolset',
    ],
  },
  'SCN-settings-admin-system-access': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/admin-surfaces.story.test.ts#SCN-settings-admin-system-access: granting admin through settings flips admin authorization',
    ],
  },
  'SCN-settings-admin-roster-announce': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/admin-surfaces.story.test.ts#SCN-settings-admin-roster-announce: an admin broadcast reaches every authorized user',
    ],
  },
  'SCN-task-guest-readonly': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/guest-readonly.story.test.ts#guest group turns can read tasks but cannot advertise writes',
    ],
  },
}
```

Finally, update the `catalogCoverage` builder: replace `const storyIds = executableStoryIdsFor(scenarioId)` with `const mapping = EXECUTABLE_STORY_MAPPINGS[scenarioId]` and build the executable record from the mapping:

```typescript
export const catalogCoverage: readonly CatalogCoverage[] = Object.freeze(
  CATALOG_SCENARIO_IDS.map((scenarioId) => {
    const mapping = EXECUTABLE_STORY_MAPPINGS[scenarioId]
    if (mapping !== undefined) {
      return Object.freeze({
        scenarioId,
        catalogStatus: catalogStatusFor(scenarioId),
        kind: 'executable' as const,
        verifiedAt: mapping.verifiedAt,
        storyIds: mapping.storyIds,
      })
    }
    const catalogStatus = catalogStatusFor(scenarioId)
    const requiredSeam = REQUIRED_SEAMS[scenarioId]
    return Object.freeze({
      scenarioId,
      catalogStatus,
      kind: 'pending' as const,
      verifiedAt: '2026-07-13' as const,
      reason: pendingReasonFor(scenarioId, catalogStatus),
      ...(requiredSeam === undefined ? {} : { requiredSeam }),
    })
  }),
)
```

(The pending branch intentionally keeps the `'2026-07-13'` classification date until the roadmap audit replaces pending reasons with structured records.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/stories/harness/catalog-coverage.test.ts`
Expected: all tests PASS, including the pre-existing ACP record test (its `verifiedAt: '2026-07-13'` expectation still holds).

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): stamp catalog verification dates and map guest-readonly story"
```

---

### Task 3: Windows fail-closed with actionable error + docs honesty

**Files:**

- Modify: `scripts/story/sandbox.ts:25-28`
- Test: `tests/scripts/story-sandbox.test.ts`
- Modify: `README.md` (Hermetic Story Tests section)
- Modify: `docs/architecture/commands.md` (Hermetic story qualification section)

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/story-sandbox.test.ts`:

```typescript
import { selectStorySandboxBackend } from '../../scripts/story/sandbox.js'

// inside the existing describe block for the sandbox:
test('rejects win32 with an actionable unsupported-host error', () => {
  expect(() => selectStorySandboxBackend('win32')).toThrow(
    'Story sandbox is not supported on Windows: the linux-docker backend requires a POSIX host uid/gid. Run the story suite on Linux or macOS with Docker (see docs/architecture/commands.md).',
  )
})
```

(If `selectStorySandboxBackend` is already imported in that file, do not duplicate the import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-sandbox.test.ts`
Expected: FAIL — `selectStorySandboxBackend('win32')` currently returns `'linux-docker'` without throwing.

- [ ] **Step 3: Implement the explicit win32 rejection**

In `scripts/story/sandbox.ts`, replace `selectStorySandboxBackend`:

```typescript
export function selectStorySandboxBackend(platform: NodeJS.Platform): StorySandboxBackend {
  if (platform === 'win32') {
    throw new Error(
      'Story sandbox is not supported on Windows: the linux-docker backend requires a POSIX host uid/gid. Run the story suite on Linux or macOS with Docker (see docs/architecture/commands.md).',
    )
  }
  if (UNSUPPORTED_PLATFORMS.has(platform)) throw new Error(`Story sandbox backend is not implemented for ${platform}`)
  return 'linux-docker'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/story-sandbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Correct the README**

In `README.md`, replace the sentence "Every run executes inside the pinned `oven/bun:1.3.13` Docker image — including on macOS and Windows via Docker Desktop — with no network, a read-only app snapshot, and a read-only bind-mounted dependency cache, so a working Docker daemon is required." with:

```markdown
Every run executes inside the pinned `oven/bun:1.3.13` Docker image — on Linux, and on
macOS via Docker Desktop — with no network, a read-only app snapshot, and a read-only
bind-mounted dependency cache, so a working Docker daemon is required. Windows hosts are
not supported yet: the launcher fails closed with an actionable error before any test
spawns.
```

- [ ] **Step 6: Correct `docs/architecture/commands.md`**

In the "Hermetic story qualification" section (the long paragraph beginning "The story launcher starts Bun with `--no-env-file`..."), replace the exact substring `(Linux, macOS, and Windows via Docker Desktop)` with `(Linux, and macOS via Docker Desktop; Windows is not supported yet and fails closed with an actionable error)`. Leave the rest of the sentence, including the digest reference, untouched — Task 4 single-sources it.

- [ ] **Step 7: Commit**

```bash
git add scripts/story/sandbox.ts tests/scripts/story-sandbox.test.ts README.md docs/architecture/commands.md
git commit -m "fix(stories): fail closed with actionable error on Windows hosts"
```

---

### Task 4: Single-source the pinned sandbox image reference

**Files:**

- Create: `scripts/story/sandbox-image.txt`
- Modify: `scripts/story/inputs.ts:18-20` (frozen enforcement matcher)
- Modify: `scripts/story/sandbox.ts:30-31` (hardcoded constant)
- Modify: `.github/workflows/ci.yml` (Verify Linux story sandbox step)
- Modify: `.github/workflows/story-stress.yml` (Verify Linux story sandbox step)
- Test: `tests/scripts/story-sandbox-image.test.ts` (new)

The digest currently lives in five places (`sandbox.ts` + twice per workflow). Single-source it in a checked-in file read by both the runner and the workflows. The file must become a frozen enforcement input, or `sandbox.ts` would fail to load it inside the sealed session snapshot.

- [ ] **Step 1: Write the failing contract test**

Create `tests/scripts/story-sandbox-image.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { isFrozenEnforcementPath } from '../../scripts/story/inputs.js'
import { STORY_SANDBOX_LINUX_IMAGE } from '../../scripts/story/sandbox.js'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const readRepositoryFile = (relative: string): string => readFileSync(path.join(repositoryRoot, relative), 'utf8')

describe('story sandbox image single source', () => {
  test('the checked-in image file is the exported reference', () => {
    expect(readRepositoryFile('scripts/story/sandbox-image.txt').trim()).toBe(STORY_SANDBOX_LINUX_IMAGE)
  })

  test('the pinned reference carries a sha256 digest and the required Bun tag', () => {
    expect(STORY_SANDBOX_LINUX_IMAGE).toMatch(/^docker\.io\/oven\/bun:1\.3\.13@sha256:[a-f0-9]{64}$/u)
  })

  test('sandbox.ts does not hardcode a digest', () => {
    expect(readRepositoryFile('scripts/story/sandbox.ts')).not.toContain('sha256:')
  })

  test('the image file is a frozen enforcement input', () => {
    expect(isFrozenEnforcementPath('scripts/story/sandbox-image.txt')).toBe(true)
    expect(isFrozenEnforcementPath('scripts/story/other.txt')).toBe(false)
  })

  test.each(['.github/workflows/ci.yml', '.github/workflows/story-stress.yml'])(
    '%s reads the image file instead of hardcoding it',
    (workflow) => {
      const contents = readRepositoryFile(workflow)
      expect(contents).toContain('cat scripts/story/sandbox-image.txt')
      expect(contents).not.toContain('sha256:')
    },
  )

  test('the commands documentation points at the image file instead of hardcoding the digest', () => {
    const contents = readRepositoryFile('docs/architecture/commands.md')
    expect(contents).not.toMatch(/oven\/bun:[^\s`]*@sha256:/u)
    expect(contents).toContain('scripts/story/sandbox-image.txt')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-sandbox-image.test.ts`
Expected: FAIL — `scripts/story/sandbox-image.txt` does not exist yet.

- [ ] **Step 3: Create the image file**

Create `scripts/story/sandbox-image.txt` with exactly one line (plus trailing newline):

```text
docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e
```

- [ ] **Step 4: Make the image file a frozen enforcement input**

In `scripts/story/inputs.ts`, replace `isFrozenEnforcementPath`:

```typescript
export function isFrozenEnforcementPath(filePath: string): boolean {
  return /^scripts\/story\/(?:[^/]+\.ts|sandbox-image\.txt)$/u.test(filePath)
}
```

(`scripts/story/baseline.ts` consumes this matcher, so historical baseline comparison picks the file up automatically.)

- [ ] **Step 5: Load the image from the file in `sandbox.ts`**

In `scripts/story/sandbox.ts`, add `readFileSync` to the `node:fs` import:

```typescript
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
```

Then replace the hardcoded constant:

```typescript
function loadStorySandboxLinuxImage(): string {
  const image = readFileSync(path.join(import.meta.dir, 'sandbox-image.txt'), 'utf8').trim()
  if (image === '') throw new Error('Story sandbox image reference must not be empty')
  return image
}

export const STORY_SANDBOX_LINUX_IMAGE = loadStorySandboxLinuxImage()
```

- [ ] **Step 6: Update both workflows to read the file**

In `.github/workflows/ci.yml` and `.github/workflows/story-stress.yml`, replace the `Verify Linux story sandbox` step body:

```yaml
- name: Verify Linux story sandbox
  run: |
    docker version
    image="$(cat scripts/story/sandbox-image.txt)"
    docker pull "$image"
    docker run --rm --network none "$image" --version
```

- [ ] **Step 7: Point the commands documentation at the image file**

In `docs/architecture/commands.md` (same paragraph as Task 3 Step 6), replace the exact substring "the pinned `docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e` OCI image" with "the pinned `oven/bun` OCI image (digest single-sourced in `scripts/story/sandbox-image.txt`)".

- [ ] **Step 8: Run the contract test and the existing sandbox suite**

Run: `bun test tests/scripts/story-sandbox-image.test.ts tests/scripts/story-sandbox.test.ts`
Expected: PASS for both (the existing suite still imports `STORY_SANDBOX_LINUX_IMAGE`, now file-backed).

- [ ] **Step 9: Run the sandboxed suites to prove the snapshot path works end to end**

Run: `bun test:stories`
Expected: 40 pass / 0 fail (the child loads `sandbox.ts` from the sealed snapshot, so this proves the image file was captured as a frozen input).

- [ ] **Step 10: Commit**

```bash
git add scripts/story/sandbox-image.txt scripts/story/inputs.ts scripts/story/sandbox.ts .github/workflows/ci.yml .github/workflows/story-stress.yml docs/architecture/commands.md tests/scripts/story-sandbox-image.test.ts
git commit -m "test(stories): single-source the pinned sandbox image reference"
```

---

### Task 5: Dependency-cache eviction

**Files:**

- Modify: `scripts/story/dependencies.ts` (add prune + keep-resolution, wire into `acquireStoryDependencySnapshot` at :229-274)
- Test: `tests/scripts/story-dependency-cache-prune.test.ts` (new)

The cache (`~/.cache/papai-story-dependencies`) grows ~1.2 GB per lockfile/platform change with no eviction. Add best-effort pruning after every successful acquire: keep the newest 3 entries (by directory mtime), always keep the just-acquired key, never fail a run because pruning failed.

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/story-dependency-cache-prune.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { pruneDependencyCacheEntries, resolveDependencyCacheKeep } from '../../scripts/story/dependencies.js'

const key = (letter: string): string => letter.repeat(64)

async function createEntry(root: string, name: string, mtime: Date): Promise<void> {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'manifest.json'), '{}\n')
  await utimes(directory, mtime, mtime)
}

describe('resolveDependencyCacheKeep', () => {
  test('defaults to three and accepts positive integers', () => {
    expect(resolveDependencyCacheKeep({})).toBe(3)
    expect(resolveDependencyCacheKeep({ PAPAI_STORY_DEPENDENCY_CACHE_KEEP: '5' })).toBe(5)
    expect(resolveDependencyCacheKeep({ PAPAI_STORY_DEPENDENCY_CACHE_KEEP: ' 4 ' })).toBe(4)
  })

  test('rejects blank, zero, negative, and non-numeric values', () => {
    for (const value of ['', '0', '-2', 'abc', '2.5']) {
      expect(resolveDependencyCacheKeep({ PAPAI_STORY_DEPENDENCY_CACHE_KEEP: value })).toBe(3)
    }
  })
})

describe('pruneDependencyCacheEntries', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'papai-cache-prune-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('keeps the newest entries and always keeps the current key', async () => {
    const names = ['a', 'b', 'c', 'd', 'e'].map(key)
    const base = Date.parse('2026-07-19T00:00:00Z')
    for (const [index, name] of names.entries()) {
      await createEntry(root, name, new Date(base + index * 1000))
    }

    await pruneDependencyCacheEntries(root, names[0]!, {}, 2)

    expect((await readdir(root)).sort()).toEqual([names[0], names[3], names[4]].sort())
  })

  test('does nothing at or below the keep limit', async () => {
    const names = ['a', 'b'].map(key)
    for (const name of names) await createEntry(root, name, new Date('2026-07-19T00:00:00Z'))

    await pruneDependencyCacheEntries(root, names[0]!, {}, 3)

    expect((await readdir(root)).sort()).toEqual(names.sort())
  })

  test('ignores staging directories and non-hash entries', async () => {
    const names = ['a', 'b', 'c', 'd'].map(key)
    const base = Date.parse('2026-07-19T00:00:00Z')
    for (const [index, name] of names.entries()) {
      await createEntry(root, name, new Date(base + index * 1000))
    }
    await createEntry(root, '.staging-tmp', new Date('2026-07-18T00:00:00Z'))

    await pruneDependencyCacheEntries(root, names[3]!, {}, 2)

    expect((await readdir(root)).sort()).toEqual(['.staging-tmp', names[2], names[3]].sort())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/story-dependency-cache-prune.test.ts`
Expected: FAIL — `pruneDependencyCacheEntries` and `resolveDependencyCacheKeep` are not exported.

- [ ] **Step 3: Implement keep-resolution and pruning**

In `scripts/story/dependencies.ts`, after `verifyEntry` (before `createStagingEntry`), add:

```typescript
const DEFAULT_CACHE_KEEP = 3

export function resolveDependencyCacheKeep(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment['PAPAI_STORY_DEPENDENCY_CACHE_KEEP']
  if (raw === undefined || !/^\d+$/u.test(raw.trim())) return DEFAULT_CACHE_KEEP
  const parsed = Number.parseInt(raw.trim(), 10)
  return parsed > 0 ? parsed : DEFAULT_CACHE_KEEP
}

export async function pruneDependencyCacheEntries(
  cacheRoot: string,
  currentKey: string,
  overrides: StoryDependencySnapshotDependencies = {},
  keep: number = resolveDependencyCacheKeep(),
): Promise<void> {
  const deps = withDefaultDependencies(overrides)
  try {
    const entries = (await deps.readdir(cacheRoot, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && HASH.test(entry.name),
    )
    if (entries.length <= keep) return
    const decorated = await Promise.all(
      entries.map(async (entry) => ({
        name: entry.name,
        mtimeMs: (await deps.lstat(path.join(cacheRoot, entry.name))).mtimeMs,
      })),
    )
    decorated.sort((left, right) => right.mtimeMs - left.mtimeMs || compareText(left.name, right.name))
    const kept = new Set([currentKey, ...decorated.slice(0, keep).map((entry) => entry.name)])
    for (const entry of decorated.slice(keep)) {
      if (kept.has(entry.name)) continue
      await removeDependencyCacheTree(path.join(cacheRoot, entry.name), deps)
    }
  } catch (error) {
    console.warn(`Story dependency cache prune skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}
```

Note: the `HASH` filter already excludes dot-prefixed staging directories, since they do not match `/^[a-f0-9]{64}$/u`.

- [ ] **Step 4: Wire pruning into `acquireStoryDependencySnapshot`**

The current function starts like this (`scripts/story/dependencies.ts:229-233`):

```typescript
export async function acquireStoryDependencySnapshot(
  options: SnapshotOptions,
  overrides: StoryDependencySnapshotDependencies = {},
): Promise<StoryDependencySnapshot> {
  const deps = withDefaultDependencies(overrides)
```

Make exactly these edits, leaving every other line of the body identical:

1. Change the function's name and signature line to `async function acquireSnapshotEntry(options: SnapshotOptions, deps: Dependencies): Promise<StoryDependencySnapshot> {` (collapsing the four-line signature into one line is fine; let the formatter decide).
2. Delete the `const deps = withDefaultDependencies(overrides)` line — the wrapper now owns dependency resolution.
3. Immediately after the (now private) function, add the new exported wrapper:

```typescript
export async function acquireStoryDependencySnapshot(
  options: SnapshotOptions,
  overrides: StoryDependencySnapshotDependencies = {},
): Promise<StoryDependencySnapshot> {
  const deps = withDefaultDependencies(overrides)
  const snapshot = await acquireSnapshotEntry(options, deps)
  await pruneDependencyCacheEntries(options.cacheRoot, snapshot.key, deps)
  return snapshot
}
```

- [ ] **Step 5: Run the new tests and the existing snapshot suite**

Run: `bun test tests/scripts/story-dependency-cache-prune.test.ts tests/scripts/story-dependency-snapshot.test.ts`
Expected: PASS for both (the refactor keeps acquire behavior identical).

- [ ] **Step 6: Commit**

```bash
git add scripts/story/dependencies.ts tests/scripts/story-dependency-cache-prune.test.ts
git commit -m "test(stories): evict stale dependency cache entries"
```

---

### Task 6: Annotate the historical identity-scoping entry and pin the user-scope rule

**Files:**

- Modify: `src/db/migrations/scoped-context-owned-columns.ts` (annotate the `user_identity_mappings` entry)
- Test: `tests/chat/context-scope-consistency.test.ts`

Research outcome (already traced): `CONTEXT_OWNED_COLUMNS` is consumed only by historical migrations `043_scoped_context_ids` and `051_legacy_context_id_backfill`, whose tests pin the legacy scoping rewrite (`tests/db/migrations/043_scoped_context_ids.test.ts:338`, `tests/db/migrations/051_legacy_context_id_backfill.test.ts:220`). Identity mappings were created context-keyed in migration 019, so the entry is correct history — the platform-user-id keyspace came later, and migration 067 cleans the orphaned scoped rows. Per the spec's fallback: annotate, do not remove.

- [ ] **Step 1: Write the failing consistency test**

In `tests/chat/context-scope-consistency.test.ts`, after the `missingFromRegistry` derivation, add:

```typescript
const GRANDFATHERED_USER_SCOPED_OWNED = new Set(['user_identity_mappings.context_id'])

const userScopedOwnedEntries = CONTEXT_OWNED_COLUMNS.flatMap((column) => {
  const scope = ENTITY_SCOPES.find((entry) => entry.table === column.table && entry.column === column.column)?.scope
  return scope === 'user' && !GRANDFATHERED_USER_SCOPED_OWNED.has(key(column.table, column.column))
    ? [key(column.table, column.column)]
    : []
})
```

And inside the `describe('ENTITY_SCOPES reconciliation', ...)` block, add:

```typescript
test('no user-scoped table beyond the grandfathered identity entry is context-owned', () => {
  expect(userScopedOwnedEntries).toEqual([])
})
```

- [ ] **Step 2: Verify the ratchet test holds in both directions**

This is a _ratchet_ test: it passes immediately because `user_identity_mappings` is the only user-scoped entry and it is grandfathered — its job is to fail when a _future_ user-scoped table is added to the list. Prove it actually bites:

1. Run: `bun test tests/chat/context-scope-consistency.test.ts` — expected: PASS.
2. Temporarily change `GRANDFATHERED_USER_SCOPED_OWNED` to `new Set([])` and re-run — expected: FAIL listing `user_identity_mappings.context_id`.
3. Restore the set to `new Set(['user_identity_mappings.context_id'])` and re-run — expected: PASS.

- [ ] **Step 3: Annotate the historical entry**

In `src/db/migrations/scoped-context-owned-columns.ts`, above the `user_identity_mappings` entry, add:

```typescript
  // Historical: migrations 043/051 rewrote legacy context-keyed identity rows into
  // scoped form. The live keyspace is the raw platform user id ('user' scope, see
  // src/chat/context-scope.ts); migration 067 deletes the orphaned scoped rows. Do not
  // add user-scoped tables to this list.
  { table: 'user_identity_mappings', column: 'context_id', conflictColumns: ['provider_name'], threadScoped: true },
```

- [ ] **Step 4: Run the consistency and migration tests**

Run: `bun test tests/chat/context-scope-consistency.test.ts tests/db/migrations/`
Expected: PASS — no behavioral change, 043/051 historical tests untouched.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/scoped-context-owned-columns.ts tests/chat/context-scope-consistency.test.ts
git commit -m "docs(db): annotate historical identity scoping entry and pin user-scope rule"
```

---

### Task 7: Document the seam-API contract of the compatibility proof

**Files:**

- Modify: `docs/architecture/commands.md` (Hermetic story qualification section)
- Modify: `tests/CLAUDE.md` (E2E Testing section)

Neither file is a frozen compat input, so these edits do not re-baseline the manifest.

- [ ] **Step 1: Add the seam-API paragraph to `docs/architecture/commands.md`**

At the end of the "Hermetic story qualification" section, append:

```markdown
The compatibility proof is a **behavioral and seam-API proof**, not purely behavioral. The frozen harness bytes consume production dependency-injection seams, so a candidate refactor must preserve their TypeScript signatures — or land the seam change on master before the baseline is recorded, because candidate-side harness edits are forbidden by the frozen-tree rule. The consumed seams are:

- `createPapaiRuntime` and `createProductionRuntimeDeps` (`src/runtime/`), consumed by `tests/stories/harness/world.ts`;
- the world's per-dependency override points: `database`, `chat.createRouter`, `application.setupBot`, `web.route`, the `extensions` lifecycle, and `capabilities.resolve`;
- the scripted-model seam `buildModel` in the LLM orchestrator;
- the tool capability catalog contract (`src/runtime/capability-catalog.ts`): registration throws on duplicate ids with different wire names, resolution throws on unknown ids.
```

- [ ] **Step 2: Add the pointer to `tests/CLAUDE.md`**

In the E2E Testing section, immediately after the "Refactor qualification freezes **every regular file**..." bullet, add:

```markdown
- The compatibility proof is a **behavioral + seam-API** proof: the frozen harness bytes consume `createPapaiRuntime`, `createProductionRuntimeDeps`, the `web.route`/`application.setupBot`/`buildModel` DI points, and the capability catalog. A refactor must preserve those TypeScript shapes or land the seam change on master before the baseline is recorded — see `docs/architecture/commands.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/commands.md tests/CLAUDE.md
git commit -m "docs(testing): document seam-API contract of the story compatibility proof"
```

---

### Task 8: Final verification gate

- [ ] **Step 1: Run the sandboxed story suite**

Run: `bun test:stories`
Expected: 40 pass / 0 fail — identical scenario set as before the batch.

- [ ] **Step 2: Run the harness contract suites**

Run: `bun test:stories:contracts`
Expected: 250+ pass / 0 fail (new catalog tests included; the exact count grows by the Task 2 additions).

- [ ] **Step 3: Run the runner and touched unit suites**

Run: `bun test tests/scripts/ tests/chat/context-scope-consistency.test.ts tests/db/`
Expected: all pass / 0 fail.

- [ ] **Step 4: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 5: Record the fresh baseline manifest**

Run: `bun test:stories:manifest`
Expected: writes `reports/stories/manifest.json`; the frozen file list now includes `scripts/story/sandbox-image.txt` and the scenario set is unchanged at 41 extracted scenario ids.

- [ ] **Step 6: Verify the compat gate against this branch's HEAD**

Run: `git status --short` (confirm the working tree is clean — `reports/` is gitignored), then `bun scripts/story/test-stories.ts --compat --baseline-ref HEAD --manifest-only`
Expected: exit 0, no mismatch output.

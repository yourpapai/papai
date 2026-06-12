<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dependency-Cruiser Architecture Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the removed custom architecture inventory pipeline with a `dependency-cruiser`-based generator that emits committed `docs/architecture/` artifacts for humans and LLMs, and refreshes them through a dedicated reviewable PR workflow.

**Architecture:** Use `dependency-cruiser` as the canonical runtime graph collector for `src/` and `client/`. Normalize the raw graph into stable repo-specific server/client areas, render deterministic Markdown/JSON/SVG artifacts under `docs/architecture/`, and wire a separate GitHub Actions workflow that regenerates artifacts on relevant `master` pushes and opens or updates one dedicated refresh PR.

**Tech Stack:** Bun, TypeScript, Zod, dependency-cruiser, GraphViz, bun:test, GitHub Actions

---

**Execution note:** This plan intentionally omits git commit steps. Only commit if the user explicitly asks for it.

## File Map

- Create: `.dependency-cruiser.mjs`
  - Standard depcruise config entrypoint for the repo; re-exports the runtime cruise options from the TS config module.
- Modify: `package.json`
  - Add `dependency-cruiser` to `devDependencies` and add a local generation script.

- Create: `scripts/architecture-refresh-model.ts`
  - Zod-backed types and schema for the reduced `architecture-llm.json` artifact plus server/client area metadata.
- Create: `scripts/architecture-refresh-config.ts`
  - Runtime scope filters, excluded path prefixes, fixed focused server areas, client surface definitions, depcruise options, and path-to-area mapping helpers.
- Create: `scripts/architecture-refresh-normalize.ts`
  - Converts raw depcruise JSON into the reduced architecture model, computes edges, and fails on uncategorized included paths.
- Create: `scripts/architecture-refresh-report.ts`
  - Renders `overview.md`, focused server docs, client overview docs, and focused GraphViz dot strings for server/client neighborhood diagrams.
- Create: `scripts/architecture-refresh.ts`
  - Main CLI/orchestrator: run depcruise, normalize, render top-level `archi`/`ddot`, render focused SVGs, wipe and rewrite `docs/architecture/` deterministically.

- Create: `tests/scripts/architecture-refresh-config.test.ts`
  - Covers runtime scope filters, fixed area IDs, and path-to-area classification.
- Create: `tests/scripts/architecture-refresh-normalize.test.ts`
  - Covers normalization, area-edge computation, client/server split, and uncategorized-path failures.
- Create: `tests/scripts/architecture-refresh-report.test.ts`
  - Covers stable Markdown/JSON rendering and focused dot output.
- Create: `tests/scripts/architecture-refresh.test.ts`
  - Covers end-to-end script orchestration with injected depcruise/GraphViz/filesystem deps.
- Create: `tests/scripts/architecture-refresh-workflow.test.ts`
  - Guards workflow path filters, permissions, GraphViz install, and the dedicated PR action.

- Create: `.github/workflows/architecture-refresh.yml`
  - Separate workflow for relevant `master` pushes; generates artifacts and opens/updates one architecture-refresh PR.

- Create/Generate: `docs/architecture/`
  - Generated, committed output root containing:
    - `raw/dependency-cruiser.json`
    - `architecture-llm.json`
    - `overview.md`
    - `diagrams/server-archi.svg`
    - `diagrams/server-ddot.svg`
    - `server/*.md`
    - `server/*.svg`
    - `client/overview.md`
    - `client/*.svg`

### Task 1: Add Runtime Scope, Area Mapping, and Reduced-Model Types

**Files:**

- Create: `scripts/architecture-refresh-model.ts`
- Create: `scripts/architecture-refresh-config.ts`
- Create: `.dependency-cruiser.mjs`
- Modify: `package.json`
- Test: `tests/scripts/architecture-refresh-config.test.ts`

- [ ] **Step 1: Write the failing scope/config tests**

```ts
import { describe, expect, test } from 'bun:test'

import {
  CLIENT_SURFACE_IDS,
  FOCUSED_SERVER_AREA_IDS,
  clientSurfaceForPath,
  isArchitectureRuntimePath,
  serverAreaForPath,
  slugForArea,
} from '../../scripts/architecture-refresh-config.js'

describe('architecture refresh config', () => {
  test('includes src and client runtime files, but excludes non-runtime paths', () => {
    expect(isArchitectureRuntimePath('src/chat/router.ts')).toBe(true)
    expect(isArchitectureRuntimePath('client/settings/App.svelte')).toBe(true)
    expect(isArchitectureRuntimePath('client/stories/Button.stories.svelte')).toBe(false)
    expect(isArchitectureRuntimePath('tests/scripts/run-semgrep.test.ts')).toBe(false)
    expect(isArchitectureRuntimePath('scripts/build-client.ts')).toBe(false)
    expect(isArchitectureRuntimePath('docs/architecture/overview.md')).toBe(false)
  })

  test('maps fixed server areas to stable slugs', () => {
    expect(FOCUSED_SERVER_AREA_IDS).toEqual([
      'chat',
      'llm-orchestrator',
      'tools',
      'providers/plugins',
      'attachments',
      'message-queue',
      'instances',
      'identity',
      'deferred-prompts',
      'memory/memos',
      'mcp/web',
      'settings/debug',
      'stats/usage',
    ])
    expect(slugForArea('providers/plugins')).toBe('providers-plugins')
    expect(slugForArea('memory/memos')).toBe('memory-memos')
  })

  test('classifies representative server and client paths', () => {
    expect(serverAreaForPath('src/chat/router.ts')).toBe('chat')
    expect(serverAreaForPath('src/llm-orchestrator.ts')).toBe('llm-orchestrator')
    expect(serverAreaForPath('src/tools/tools-builder.ts')).toBe('tools')
    expect(serverAreaForPath('src/debug/settings/server.ts')).toBe('settings/debug')

    expect(CLIENT_SURFACE_IDS).toEqual(['settings', 'admin', 'debug'])
    expect(clientSurfaceForPath('client/settings/App.svelte')).toBe('settings')
    expect(clientSurfaceForPath('client/admin/AdminApp.svelte')).toBe('admin')
    expect(clientSurfaceForPath('client/debug/DebugApp.svelte')).toBe('debug')
  })
})
```

- [ ] **Step 2: Run the config test and verify it fails**

Run: `bun test tests/scripts/architecture-refresh-config.test.ts`

Expected: FAIL with `Cannot find module '../../scripts/architecture-refresh-config.js'`.

- [ ] **Step 3: Add the reduced-model schema, area definitions, and depcruise config entrypoint**

```ts
// scripts/architecture-refresh-model.ts
import { z } from 'zod'

export const focusedServerAreaIds = [
  'chat',
  'llm-orchestrator',
  'tools',
  'providers/plugins',
  'attachments',
  'message-queue',
  'instances',
  'identity',
  'deferred-prompts',
  'memory/memos',
  'mcp/web',
  'settings/debug',
  'stats/usage',
] as const

export const clientSurfaceIds = ['settings', 'admin', 'debug'] as const

export const areaNodeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  kind: z.enum(['server', 'client']),
  paths: z.array(z.string()),
  dependsOn: z.array(z.string()),
  dependedOnBy: z.array(z.string()),
})

export const architectureLlmSchema = z.object({
  scope: z.object({
    includedRoots: z.array(z.string()),
    excludedPrefixes: z.array(z.string()),
  }),
  rawArtifact: z.literal('raw/dependency-cruiser.json'),
  server: z.object({
    areas: z.array(areaNodeSchema),
    focusedAreaIds: z.array(z.string()),
  }),
  client: z.object({
    surfaces: z.array(areaNodeSchema),
  }),
})

export type FocusedServerAreaId = (typeof focusedServerAreaIds)[number]
export type ClientSurfaceId = (typeof clientSurfaceIds)[number]
export type ArchitectureLlm = z.infer<typeof architectureLlmSchema>
```

```ts
// scripts/architecture-refresh-config.ts
import {
  clientSurfaceIds,
  focusedServerAreaIds,
  type ClientSurfaceId,
  type FocusedServerAreaId,
} from './architecture-refresh-model.js'

export const ARCHITECTURE_OUTPUT_DIR = 'docs/architecture'
export const INCLUDED_ROOTS = ['src', 'client'] as const
export const EXCLUDED_PREFIXES = [
  'tests/',
  'scripts/',
  'review-loop/',
  'docs/architecture/',
  'client/stories/',
] as const

const SERVER_AREA_PREFIXES: Readonly<Record<FocusedServerAreaId, readonly string[]>> = {
  chat: ['src/chat/', 'src/bot.ts'],
  'llm-orchestrator': [
    'src/llm-orchestrator',
    'src/system-prompt.ts',
    'src/ai-progress-reporter.ts',
    'src/ai-output-settings.ts',
  ],
  tools: ['src/tools/'],
  'providers/plugins': ['src/providers/', 'src/plugins/'],
  attachments: ['src/attachments/', 'src/bot-attachments.ts'],
  'message-queue': ['src/message-queue/'],
  instances: ['src/instances/'],
  identity: ['src/identity/'],
  'deferred-prompts': ['src/deferred-prompts/', 'src/recurring', 'src/recurrence', 'src/recurring.ts', 'src/scheduler'],
  'memory/memos': ['src/memory', 'src/memos.ts', 'src/history.ts', 'src/conversation.ts'],
  'mcp/web': ['src/mcp/', 'src/web/'],
  'settings/debug': ['src/settings/', 'src/debug/'],
  'stats/usage': ['src/stats/', 'src/usage/'],
}

const CLIENT_SURFACE_PREFIXES: Readonly<Record<ClientSurfaceId, readonly string[]>> = {
  settings: ['client/settings/'],
  admin: ['client/admin/'],
  debug: ['client/debug/'],
}

export const dependencyCruiserOptions = {
  tsConfig: 'tsconfig.json',
  exclude: { path: ['^tests/', '^review-loop/', '^docs/architecture/', '^client/stories/'] },
  doNotFollow: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
  includeOnly: { path: ['^src/', '^client/'] },
}

export const FOCUSED_SERVER_AREA_IDS = [...focusedServerAreaIds]
export const CLIENT_SURFACE_IDS = [...clientSurfaceIds]

export const isArchitectureRuntimePath = (relativePath: string): boolean => {
  if (!INCLUDED_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))) return false
  return !EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
}

export const slugForArea = (areaId: string): string => areaId.replaceAll('/', '-')

export const serverAreaForPath = (relativePath: string): FocusedServerAreaId | null => {
  for (const areaId of focusedServerAreaIds) {
    if (SERVER_AREA_PREFIXES[areaId].some((prefix) => relativePath.startsWith(prefix))) return areaId
  }
  return null
}

export const clientSurfaceForPath = (relativePath: string): ClientSurfaceId | null => {
  for (const surfaceId of clientSurfaceIds) {
    if (CLIENT_SURFACE_PREFIXES[surfaceId].some((prefix) => relativePath.startsWith(prefix))) return surfaceId
  }
  return null
}
```

```js
// .dependency-cruiser.mjs
import { dependencyCruiserOptions } from './scripts/architecture-refresh-config.js'

export default {
  options: dependencyCruiserOptions,
}
```

```json
// package.json
{
  "scripts": {
    "architecture:refresh": "bun scripts/architecture-refresh.ts"
  },
  "devDependencies": {
    "dependency-cruiser": "^17.4.3"
  }
}
```

- [ ] **Step 4: Run the config test and verify it passes**

Run: `bun test tests/scripts/architecture-refresh-config.test.ts`

Expected: PASS with three green assertions for scope inclusion, slug stability, and path classification.

### Task 2: Normalize Raw Depcruise Output Into the Reduced Architecture Model

**Files:**

- Create: `scripts/architecture-refresh-normalize.ts`
- Test: `tests/scripts/architecture-refresh-normalize.test.ts`

- [ ] **Step 1: Write the failing normalization tests**

```ts
import { describe, expect, test } from 'bun:test'

import { normalizeArchitectureGraph } from '../../scripts/architecture-refresh-normalize.js'

const rawGraph = {
  modules: [
    {
      source: 'src/chat/router.ts',
      dependencies: [{ resolved: 'src/tools/tools-builder.ts' }],
    },
    {
      source: 'src/tools/tools-builder.ts',
      dependencies: [{ resolved: 'src/providers/index.ts' }],
    },
    {
      source: 'src/providers/index.ts',
      dependencies: [],
    },
    {
      source: 'client/settings/App.svelte',
      dependencies: [{ resolved: 'src/settings/session.ts' }],
    },
    {
      source: 'src/settings/session.ts',
      dependencies: [],
    },
  ],
  summary: { totalCruised: 5 },
} as const

describe('normalizeArchitectureGraph', () => {
  test('collapses file-level modules into server and client area edges', () => {
    const model = normalizeArchitectureGraph(rawGraph)

    expect(model.rawArtifact).toBe('raw/dependency-cruiser.json')
    expect(model.server.areas.find((area) => area.id === 'chat')?.dependsOn).toEqual(['tools'])
    expect(model.server.areas.find((area) => area.id === 'tools')?.dependsOn).toEqual(['providers/plugins'])
    expect(model.client.surfaces.find((surface) => surface.id === 'settings')?.dependsOn).toEqual(['settings/debug'])
  })

  test('fails on uncategorized included runtime paths', () => {
    expect(() =>
      normalizeArchitectureGraph({
        modules: [{ source: 'src/unknown/new-runtime.ts', dependencies: [] }],
        summary: { totalCruised: 1 },
      }),
    ).toThrow('Uncategorized runtime path: src/unknown/new-runtime.ts')
  })
})
```

- [ ] **Step 2: Run the normalization test and verify it fails**

Run: `bun test tests/scripts/architecture-refresh-normalize.test.ts`

Expected: FAIL with `Cannot find module '../../scripts/architecture-refresh-normalize.js'`.

- [ ] **Step 3: Implement graph normalization and uncategorized-path enforcement**

```ts
// scripts/architecture-refresh-normalize.ts
import type { ICruiseResult } from 'dependency-cruiser'

import {
  CLIENT_SURFACE_IDS,
  EXCLUDED_PREFIXES,
  FOCUSED_SERVER_AREA_IDS,
  INCLUDED_ROOTS,
  clientSurfaceForPath,
  isArchitectureRuntimePath,
  serverAreaForPath,
  slugForArea,
} from './architecture-refresh-config.js'
import { architectureLlmSchema, type ArchitectureLlm } from './architecture-refresh-model.js'

type AreaAccumulator = Readonly<{
  id: string
  slug: string
  label: string
  kind: 'server' | 'client'
  paths: Set<string>
  dependsOn: Set<string>
  dependedOnBy: Set<string>
}>

const moduleSource = (module: ICruiseResult['modules'][number]): string => module.source.replaceAll('\\', '/')

const dependencyTarget = (
  dependency: NonNullable<ICruiseResult['modules'][number]['dependencies']>[number],
): string | null => {
  const candidate = dependency.resolved ?? dependency.module
  if (typeof candidate !== 'string') return null
  return candidate.replaceAll('\\', '/')
}

const createArea = (id: string, kind: 'server' | 'client'): AreaAccumulator => ({
  id,
  slug: slugForArea(id),
  label: id,
  kind,
  paths: new Set<string>(),
  dependsOn: new Set<string>(),
  dependedOnBy: new Set<string>(),
})

export const normalizeArchitectureGraph = (raw: Pick<ICruiseResult, 'modules'>): ArchitectureLlm => {
  const serverAreas = new Map(FOCUSED_SERVER_AREA_IDS.map((id) => [id, createArea(id, 'server')]))
  const clientSurfaces = new Map(CLIENT_SURFACE_IDS.map((id) => [id, createArea(id, 'client')]))

  for (const module of raw.modules) {
    const source = moduleSource(module)
    if (!isArchitectureRuntimePath(source)) continue

    const serverArea = serverAreaForPath(source)
    const clientSurface = clientSurfaceForPath(source)
    if (serverArea === null && clientSurface === null) {
      throw new Error(`Uncategorized runtime path: ${source}`)
    }

    const owner = serverArea === null ? clientSurfaces.get(clientSurface!)! : serverAreas.get(serverArea)!
    owner.paths.add(source)

    for (const dependency of module.dependencies ?? []) {
      const target = dependencyTarget(dependency)
      if (target === null || !isArchitectureRuntimePath(target)) continue

      const targetServerArea = serverAreaForPath(target)
      const targetClientSurface = clientSurfaceForPath(target)
      if (targetServerArea === null && targetClientSurface === null) {
        throw new Error(`Uncategorized runtime path: ${target}`)
      }

      const targetId = targetServerArea ?? targetClientSurface!
      if (targetId === owner.id) continue
      owner.dependsOn.add(targetId)

      const targetOwner =
        targetServerArea === null ? clientSurfaces.get(targetClientSurface!)! : serverAreas.get(targetServerArea)!
      targetOwner.dependedOnBy.add(owner.id)
    }
  }

  const normalized = architectureLlmSchema.parse({
    scope: {
      includedRoots: [...INCLUDED_ROOTS],
      excludedPrefixes: [...EXCLUDED_PREFIXES],
    },
    rawArtifact: 'raw/dependency-cruiser.json',
    server: {
      focusedAreaIds: [...FOCUSED_SERVER_AREA_IDS],
      areas: [...serverAreas.values()]
        .map((area) => ({
          id: area.id,
          slug: area.slug,
          label: area.label,
          kind: area.kind,
          paths: [...area.paths].sort(),
          dependsOn: [...area.dependsOn].sort(),
          dependedOnBy: [...area.dependedOnBy].sort(),
        }))
        .filter((area) => area.paths.length > 0),
    },
    client: {
      surfaces: [...clientSurfaces.values()]
        .map((surface) => ({
          id: surface.id,
          slug: surface.slug,
          label: surface.label,
          kind: surface.kind,
          paths: [...surface.paths].sort(),
          dependsOn: [...surface.dependsOn].sort(),
          dependedOnBy: [...surface.dependedOnBy].sort(),
        }))
        .filter((surface) => surface.paths.length > 0),
    },
  })

  return normalized
}
```

- [ ] **Step 4: Run the normalization test and verify it passes**

Run: `bun test tests/scripts/architecture-refresh-normalize.test.ts`

Expected: PASS, including the uncategorized-path failure assertion.

### Task 3: Render Deterministic Markdown, JSON, and Focused Dot Outputs

**Files:**

- Create: `scripts/architecture-refresh-report.ts`
- Test: `tests/scripts/architecture-refresh-report.test.ts`

- [ ] **Step 1: Write the failing renderer tests**

```ts
import { describe, expect, test } from 'bun:test'

import { buildArchitectureOutputFiles, renderFocusedAreaDot } from '../../scripts/architecture-refresh-report.js'

const model = {
  scope: { includedRoots: ['src', 'client'], excludedPrefixes: ['tests/', 'scripts/'] },
  rawArtifact: 'raw/dependency-cruiser.json',
  server: {
    focusedAreaIds: ['chat', 'tools'],
    areas: [
      {
        id: 'chat',
        slug: 'chat',
        label: 'chat',
        kind: 'server',
        paths: ['src/chat/router.ts'],
        dependsOn: ['tools'],
        dependedOnBy: [],
      },
      {
        id: 'tools',
        slug: 'tools',
        label: 'tools',
        kind: 'server',
        paths: ['src/tools/tools-builder.ts'],
        dependsOn: [],
        dependedOnBy: ['chat'],
      },
    ],
  },
  client: {
    surfaces: [
      {
        id: 'settings',
        slug: 'settings',
        label: 'settings',
        kind: 'client',
        paths: ['client/settings/App.svelte'],
        dependsOn: ['settings/debug'],
        dependedOnBy: [],
      },
    ],
  },
} as const

describe('architecture refresh report', () => {
  test('builds stable committed output file paths', () => {
    const files = buildArchitectureOutputFiles(model)
    expect(files.map((file) => file.relativePath)).toEqual([
      'architecture-llm.json',
      'overview.md',
      'server/chat.md',
      'server/tools.md',
      'client/overview.md',
    ])
    expect(files[0]?.content).not.toContain('generatedAt')
  })

  test('renders focused area dot with neighboring dependencies', () => {
    const dot = renderFocusedAreaDot('chat', model)
    expect(dot).toContain('digraph')
    expect(dot).toContain('"chat" -> "tools"')
  })
})
```

- [ ] **Step 2: Run the renderer test and verify it fails**

Run: `bun test tests/scripts/architecture-refresh-report.test.ts`

Expected: FAIL with `Cannot find module '../../scripts/architecture-refresh-report.js'`.

- [ ] **Step 3: Implement deterministic Markdown/JSON rendering and focused dot builders**

```ts
// scripts/architecture-refresh-report.ts
import type { ArchitectureLlm } from './architecture-refresh-model.js'

export interface ArchitectureOutputFile {
  readonly relativePath: string
  readonly content: string
}

const lines = (value: readonly string[]): string => value.join('\n')

const listOrNone = (items: readonly string[]): string =>
  items.length === 0 ? '_None._' : items.map((item) => `- ${item}`).join('\n')

const overviewForModel = (model: ArchitectureLlm): string =>
  lines([
    '# Architecture Overview',
    '',
    '## Runtime Scope',
    '',
    `- Included roots: ${model.scope.includedRoots.join(', ')}`,
    `- Excluded prefixes: ${model.scope.excludedPrefixes.join(', ')}`,
    '',
    '## Server Areas',
    '',
    ...model.server.areas.map((area) => `- ${area.id} -> ${area.dependsOn.join(', ') || 'none'}`),
    '',
    '## Client Surfaces',
    '',
    ...model.client.surfaces.map((surface) => `- ${surface.id} -> ${surface.dependsOn.join(', ') || 'none'}`),
    '',
    '## Canonical Raw Graph',
    '',
    `- ${model.rawArtifact}`,
    '',
  ])

const serverAreaDoc = (area: ArchitectureLlm['server']['areas'][number]): string =>
  lines([
    `# ${area.id}`,
    '',
    '## Paths',
    '',
    listOrNone(area.paths),
    '',
    '## Depends On',
    '',
    listOrNone(area.dependsOn),
    '',
    '## Depended On By',
    '',
    listOrNone(area.dependedOnBy),
    '',
  ])

export const renderFocusedAreaDot = (areaId: string, model: ArchitectureLlm): string => {
  const area = model.server.areas.find((candidate) => candidate.id === areaId)
  if (area === undefined) throw new Error(`Unknown focused area: ${areaId}`)

  const edges = area.dependsOn.map((dependencyId) => `  "${area.id}" -> "${dependencyId}";`)
  const reverseEdges = area.dependedOnBy.map((dependentId) => `  "${dependentId}" -> "${area.id}";`)

  return lines([
    'digraph focused_area {',
    '  rankdir=LR;',
    `  "${area.id}" [shape=box, style=filled, fillcolor="#d6f5de"];`,
    ...edges,
    ...reverseEdges,
    '}',
  ])
}

export const renderClientSurfaceDot = (surfaceId: string, model: ArchitectureLlm): string => {
  const surface = model.client.surfaces.find((candidate) => candidate.id === surfaceId)
  if (surface === undefined) throw new Error(`Unknown client surface: ${surfaceId}`)

  return lines([
    'digraph client_surface {',
    '  rankdir=LR;',
    `  "${surface.id}" [shape=box, style=filled, fillcolor="#dbeafe"];`,
    ...surface.dependsOn.map((dependencyId) => `  "${surface.id}" -> "${dependencyId}";`),
    '}',
  ])
}

export const buildArchitectureOutputFiles = (model: ArchitectureLlm): readonly ArchitectureOutputFile[] => [
  {
    relativePath: 'architecture-llm.json',
    content: `${JSON.stringify(model, null, 2)}\n`,
  },
  {
    relativePath: 'overview.md',
    content: overviewForModel(model),
  },
  ...model.server.areas.map((area) => ({
    relativePath: `server/${area.slug}.md`,
    content: serverAreaDoc(area),
  })),
  {
    relativePath: 'client/overview.md',
    content: lines([
      '# Client Architecture Overview',
      '',
      ...model.client.surfaces.map((surface) => `- ${surface.id}: ${surface.paths.join(', ')}`),
      '',
    ]),
  },
]
```

- [ ] **Step 4: Run the renderer test and verify it passes**

Run: `bun test tests/scripts/architecture-refresh-report.test.ts`

Expected: PASS, and the output-file assertion confirms there is no volatile `generatedAt` field.

### Task 4: Wire the Main Generator Script and Produce the Initial `docs/architecture/` Artifact Set

**Files:**

- Create: `scripts/architecture-refresh.ts`
- Modify: `package.json`
- Test: `tests/scripts/architecture-refresh.test.ts`
- Generate: `docs/architecture/`

- [ ] **Step 1: Write the failing orchestration test**

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import type { ICruiseResult } from 'dependency-cruiser'

import { runArchitectureRefresh } from '../../scripts/architecture-refresh.js'

describe('runArchitectureRefresh', () => {
  let writes: Array<{ path: string; content: string }>

  beforeEach(() => {
    writes = []
  })

  test('writes the canonical raw graph, reduced json, top-level server diagrams, focused server docs, and client artifacts', async () => {
    const rawGraph: ICruiseResult = {
      modules: [
        { source: 'src/chat/router.ts', dependencies: [{ resolved: 'src/tools/tools-builder.ts' }] },
        { source: 'src/tools/tools-builder.ts', dependencies: [] },
        { source: 'client/settings/App.svelte', dependencies: [{ resolved: 'src/settings/session.ts' }] },
        { source: 'src/settings/session.ts', dependencies: [] },
      ],
      summary: {
        violations: [],
        error: 0,
        warn: 0,
        info: 0,
        totalCruised: 4,
        optionsUsed: { outputType: 'json' },
      },
    }

    await runArchitectureRefresh([], {
      cruiseGraph: async () => rawGraph,
      formatTopLevelGraph: async (kind) => `digraph ${kind} {}`,
      renderDotToSvg: async (dot) => `<svg>${dot}</svg>`,
      rmDir: async () => {},
      mkdirp: async () => {},
      writeTextFile: async (path, content) => {
        writes.push({ path, content })
      },
    })

    expect(writes.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docs/architecture/raw/dependency-cruiser.json'),
        expect.stringContaining('docs/architecture/architecture-llm.json'),
        expect.stringContaining('docs/architecture/overview.md'),
        expect.stringContaining('docs/architecture/diagrams/server-archi.svg'),
        expect.stringContaining('docs/architecture/diagrams/server-ddot.svg'),
        expect.stringContaining('docs/architecture/server/chat.md'),
        expect.stringContaining('docs/architecture/server/chat.svg'),
        expect.stringContaining('docs/architecture/client/overview.md'),
        expect.stringContaining('docs/architecture/client/settings.svg'),
      ]),
    )
  })
})
```

- [ ] **Step 2: Run the orchestration test and verify it fails**

Run: `bun test tests/scripts/architecture-refresh.test.ts`

Expected: FAIL with `Cannot find module '../../scripts/architecture-refresh.js'`.

- [ ] **Step 3: Implement the main architecture refresh runner and package script**

```ts
// scripts/architecture-refresh.ts
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { cruise, format, type ICruiseResult } from 'dependency-cruiser'

import { ARCHITECTURE_OUTPUT_DIR, dependencyCruiserOptions } from './architecture-refresh-config.js'
import { normalizeArchitectureGraph } from './architecture-refresh-normalize.js'
import {
  buildArchitectureOutputFiles,
  renderClientSurfaceDot,
  renderFocusedAreaDot,
} from './architecture-refresh-report.js'

export interface RunArchitectureRefreshDeps {
  readonly cruiseGraph?: () => Promise<ICruiseResult>
  readonly formatTopLevelGraph?: (kind: 'archi' | 'ddot', raw: ICruiseResult) => Promise<string>
  readonly renderDotToSvg?: (dot: string) => Promise<string>
  readonly rmDir?: (dirPath: string) => Promise<void>
  readonly mkdirp?: (dirPath: string) => Promise<void>
  readonly writeTextFile?: (filePath: string, content: string) => Promise<void>
}

const defaultCruiseGraph = async (): Promise<ICruiseResult> => {
  const result = await cruise(['src', 'client'], dependencyCruiserOptions)
  return result.output as ICruiseResult
}

const defaultFormatTopLevelGraph = async (kind: 'archi' | 'ddot', raw: ICruiseResult): Promise<string> => {
  const filtered = {
    ...raw,
    modules: raw.modules.filter((module) => module.source.startsWith('src/')),
  }
  const result = await format(filtered as ICruiseResult, { outputType: kind })
  return String(result.output)
}

const defaultRenderDotToSvg = async (dot: string): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('dot', ['-Tsvg'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `dot exited with code ${code ?? 1}`))
    })
    child.stdin.end(dot)
  })
}

export const runArchitectureRefresh = async (
  _argv: readonly string[],
  deps: RunArchitectureRefreshDeps = {},
): Promise<void> => {
  const cruiseGraph = deps.cruiseGraph ?? defaultCruiseGraph
  const formatTopLevelGraph = deps.formatTopLevelGraph ?? defaultFormatTopLevelGraph
  const renderDotToSvg = deps.renderDotToSvg ?? defaultRenderDotToSvg
  const rmDir = deps.rmDir ?? ((dirPath: string) => rm(dirPath, { recursive: true, force: true }))
  const mkdirp = deps.mkdirp ?? ((dirPath: string) => mkdir(dirPath, { recursive: true }))
  const writeTextFile =
    deps.writeTextFile ?? ((filePath: string, content: string) => writeFile(filePath, content, 'utf8'))

  const raw = await cruiseGraph()
  const model = normalizeArchitectureGraph(raw)
  const files = buildArchitectureOutputFiles(model)
  const outputRoot = path.join(process.cwd(), ARCHITECTURE_OUTPUT_DIR)

  await rmDir(outputRoot)

  const writeManagedFile = async (relativePath: string, content: string): Promise<void> => {
    const absolutePath = path.join(outputRoot, relativePath)
    await mkdirp(path.dirname(absolutePath))
    await writeTextFile(absolutePath, content)
  }

  await writeManagedFile('raw/dependency-cruiser.json', `${JSON.stringify(raw, null, 2)}\n`)
  for (const file of files) await writeManagedFile(file.relativePath, file.content)

  await writeManagedFile('diagrams/server-archi.svg', await renderDotToSvg(await formatTopLevelGraph('archi', raw)))
  await writeManagedFile('diagrams/server-ddot.svg', await renderDotToSvg(await formatTopLevelGraph('ddot', raw)))

  for (const area of model.server.areas) {
    await writeManagedFile(`server/${area.slug}.svg`, await renderDotToSvg(renderFocusedAreaDot(area.id, model)))
  }

  for (const surface of model.client.surfaces) {
    await writeManagedFile(
      `client/${surface.slug}.svg`,
      await renderDotToSvg(renderClientSurfaceDot(surface.id, model)),
    )
  }
}

if (import.meta.main) {
  await runArchitectureRefresh(process.argv.slice(2))
}
```

```json
// package.json
{
  "scripts": {
    "architecture:refresh": "bun scripts/architecture-refresh.ts"
  }
}
```

- [ ] **Step 4: Run the targeted script tests and verify they pass**

Run: `bun test tests/scripts/architecture-refresh.test.ts tests/scripts/architecture-refresh-config.test.ts tests/scripts/architecture-refresh-normalize.test.ts tests/scripts/architecture-refresh-report.test.ts`

Expected: PASS for the full architecture-refresh script suite.

- [ ] **Step 5: Generate the initial committed artifacts and verify determinism**

Run: `bun run architecture:refresh`

Expected: `docs/architecture/` is created with the raw JSON, reduced JSON, overview Markdown, top-level server SVGs, focused server artifacts, and client artifacts.

Run: `bun run architecture:refresh && rtk git diff --exit-code -- docs/architecture`

Expected: exit code `0` on the second run, proving there is no nondeterministic drift.

### Task 5: Add the Dedicated Architecture-Refresh Workflow and PR Automation

**Files:**

- Create: `.github/workflows/architecture-refresh.yml`
- Create: `tests/scripts/architecture-refresh-workflow.test.ts`

- [ ] **Step 1: Write the failing workflow guard test**

```ts
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

describe('architecture refresh workflow', () => {
  test('targets master pushes with runtime/config path filters and creates a dedicated PR', async () => {
    const workflow = await readFile('.github/workflows/architecture-refresh.yml', 'utf8')

    expect(workflow).toContain('branches: [master]')
    expect(workflow).toContain("- 'src/**'")
    expect(workflow).toContain("- 'client/**'")
    expect(workflow).toContain("- 'package.json'")
    expect(workflow).toContain("- 'bun.lock'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('pull-requests: write')
    expect(workflow).toContain('graphviz')
    expect(workflow).toContain('bun run architecture:refresh')
    expect(workflow).toContain('peter-evans/create-pull-request@v8')
    expect(workflow).toContain('automation/architecture-refresh')
    expect(workflow).toContain('docs/architecture/**')
  })
})
```

- [ ] **Step 2: Run the workflow guard test and verify it fails**

Run: `bun test tests/scripts/architecture-refresh-workflow.test.ts`

Expected: FAIL because `.github/workflows/architecture-refresh.yml` does not exist yet.

- [ ] **Step 3: Implement the separate workflow with GraphViz install and a single dedicated PR branch**

```yaml
# .github/workflows/architecture-refresh.yml
name: Architecture Refresh

on:
  push:
    branches: [master]
    paths:
      - 'src/**'
      - 'client/**'
      - 'package.json'
      - 'bun.lock'
      - '.dependency-cruiser.mjs'
      - 'scripts/architecture-refresh*.ts'
      - '.github/workflows/architecture-refresh.yml'

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: architecture-refresh-${{ github.sha }}
  cancel-in-progress: true

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: master

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13

      - name: Install GraphViz
        run: sudo apt-get update && sudo apt-get install -y graphviz

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Generate architecture artifacts
        run: bun run architecture:refresh

      - name: Create or update architecture refresh PR
        uses: peter-evans/create-pull-request@v8
        with:
          branch: automation/architecture-refresh
          base: master
          commit-message: docs: refresh architecture artifacts
          title: docs: refresh architecture artifacts
          body: |
            Automated refresh of committed `docs/architecture/` artifacts.

            - Trigger: push to `master` affecting runtime or generation config
            - Scope: artifacts only
            - Source: `dependency-cruiser` + repo-local normalization/rendering
          add-paths: |
            docs/architecture/**
          delete-branch: false
```

- [ ] **Step 4: Run the workflow guard test and verify it passes**

Run: `bun test tests/scripts/architecture-refresh-workflow.test.ts`

Expected: PASS, confirming path filters, permissions, GraphViz install, and the dedicated PR branch/action are all locked in.

### Task 6: Final Verification and Stale-Reference Sweep

**Files:**

- Modify if needed: `package.json`
- Modify if needed: any doc or script still referencing the removed inventory pipeline

- [ ] **Step 1: Search for stale references to the removed inventory pipeline**

Run: `rg "inventory:architecture|architecture-inventory" package.json docs scripts tests`

Expected: no live runtime references remain; if any appear, remove or update them as part of this task.

- [ ] **Step 2: Run the focused script test suite**

Run: `bun test tests/scripts/architecture-refresh-config.test.ts tests/scripts/architecture-refresh-normalize.test.ts tests/scripts/architecture-refresh-report.test.ts tests/scripts/architecture-refresh.test.ts tests/scripts/architecture-refresh-workflow.test.ts`

Expected: PASS for all architecture-refresh test files.

- [ ] **Step 3: Run repo formatting and targeted type checks**

Run: `bun run format:check && bun run typecheck`

Expected: both commands pass with no formatting or TypeScript errors.

- [ ] **Step 4: Regenerate artifacts one last time and verify the tree is stable**

Run: `bun run architecture:refresh && rtk git diff --exit-code -- docs/architecture`

Expected: exit code `0`, proving the generated artifact set is deterministic and fully written.

- [ ] **Step 5: Run the full project check before handoff**

Run: `bun check:full`

Expected: PASS, with the new generator, tests, workflow file, and generated artifacts integrated cleanly into the repo.

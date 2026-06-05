// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import path from 'node:path'

import type { DependencyType, ICruiseResult, IDependency, IModule, ISummary } from 'dependency-cruiser'

import { runArchitectureRefresh } from '../../scripts/architecture-refresh.js'

const createDependency = (resolved: string): IDependency => ({
  circular: false,
  coreModule: false,
  couldNotResolve: false,
  dependencyTypes: ['local'] satisfies readonly DependencyType[],
  dynamic: false,
  exoticallyRequired: false,
  followable: true,
  module: resolved,
  protocol: 'file:',
  mimeType: '',
  moduleSystem: 'es6',
  resolved,
  valid: true,
  instability: 0,
})

const createModule = (source: string, dependencyTargets: readonly string[]): IModule => ({
  source,
  valid: true,
  dependencies: dependencyTargets.map(createDependency),
  dependents: [],
})

const createSummary = (): ISummary => ({
  violations: [],
  error: 0,
  ignore: 0,
  warn: 0,
  info: 0,
  totalCruised: 4,
  optionsUsed: { outputType: 'json' },
})

const createFullCommittedRawGraph = (): ICruiseResult => ({
  modules: [
    createModule('src/chat/router.ts', ['src/tools/tools-builder.ts', 'src/llm-orchestrator/index.ts']),
    createModule('src/llm-orchestrator/index.ts', ['src/providers/registry.ts']),
    createModule('src/tools/tools-builder.ts', ['src/identity/store.ts']),
    createModule('src/providers/registry.ts', ['src/instances/store.ts']),
    createModule('src/attachments/store.ts', ['src/instances/store.ts']),
    createModule('src/message-queue/queue.ts', ['src/chat/router.ts']),
    createModule('src/instances/store.ts', []),
    createModule('src/identity/store.ts', ['src/settings/session.ts']),
    createModule('src/deferred-prompts/scheduler.ts', ['src/memos.ts']),
    createModule('src/memory/index.ts', ['src/web/fetch.ts']),
    createModule('src/mcp/server.ts', ['src/web/fetch.ts']),
    createModule('src/settings/session.ts', ['src/stats/collector.ts']),
    createModule('src/stats/collector.ts', []),
    createModule('client/settings/App.svelte', ['src/settings/session.ts']),
    createModule('client/admin/App.svelte', ['src/settings/session.ts']),
    createModule('client/debug/App.tsx', ['src/chat/router.ts']),
  ],
  summary: createSummary(),
})

const expectedCommittedArtifactPaths = [
  'docs/architecture/architecture-llm.json',
  'docs/architecture/client/overview.md',
  'docs/architecture/overview.md',
  'docs/architecture/server/attachments.md',
  'docs/architecture/server/chat.md',
  'docs/architecture/server/deferred-prompts.md',
  'docs/architecture/server/identity.md',
  'docs/architecture/server/instances.md',
  'docs/architecture/server/llm-orchestrator.md',
  'docs/architecture/server/mcp-web.md',
  'docs/architecture/server/memory-memos.md',
  'docs/architecture/server/message-queue.md',
  'docs/architecture/server/providers-plugins.md',
  'docs/architecture/server/settings-debug.md',
  'docs/architecture/server/stats-usage.md',
  'docs/architecture/server/tools.md',
] as const

const expectedCommittedArtifactPathsInWorkspace = expectedCommittedArtifactPaths.map((relativePath) =>
  path.join(process.cwd(), relativePath),
)

describe('runArchitectureRefresh', () => {
  let writes: Array<{ path: string; content: string }>

  beforeEach(() => {
    writes = []
  })

  test('writes only committed Markdown and LLM architecture artifacts', async () => {
    const rawGraph = createFullCommittedRawGraph()

    await runArchitectureRefresh([], {
      listArchitectureFiles: () => Promise.resolve(['src/chat/router.ts', 'client/settings/App.svelte']),
      cruiseGraph: () => Promise.resolve(rawGraph),
      formatGeneratedFiles: () => Promise.resolve(),
      rmDir: () => Promise.resolve(),
      mkdirp: () => Promise.resolve(),
      writeTextFile: (filePath, content) => {
        writes.push({ path: filePath, content })
        return Promise.resolve()
      },
    })

    expect(writes.map((entry) => entry.path).sort()).toEqual([...expectedCommittedArtifactPathsInWorkspace].sort())
    expect(writes.every((entry) => !entry.path.endsWith('.svg'))).toBe(true)
    expect(writes.every((entry) => !entry.path.includes('/raw/'))).toBe(true)
  })

  test('wraps graph generation failures with stage-specific context', async () => {
    await expect(
      runArchitectureRefresh([], {
        listArchitectureFiles: () => Promise.resolve(['src/chat/router.ts']),
        cruiseGraph: () => Promise.reject(new Error('depcruise exploded')),
      }),
    ).rejects.toThrow('Architecture refresh graph generation failed: depcruise exploded')
  })

  test('wraps normalization failures with stage-specific context', async () => {
    await expect(
      runArchitectureRefresh([], {
        listArchitectureFiles: () => Promise.resolve(['src/unknown/runtime.ts']),
        cruiseGraph: () =>
          Promise.resolve({
            modules: [createModule('src/unknown/runtime.ts', [])],
            summary: createSummary(),
          }),
      }),
    ).rejects.toThrow('Architecture refresh normalization failed: Uncategorized runtime path: src/unknown/runtime.ts')
  })

  test('wraps tracked file discovery failures with stage-specific context', async () => {
    await expect(
      runArchitectureRefresh([], {
        listArchitectureFiles: () => Promise.reject(new Error('git ls-files failed')),
      }),
    ).rejects.toThrow('Architecture refresh tracked file discovery failed: git ls-files failed')
  })

  test('wraps rendering failures with stage-specific context', async () => {
    await expect(
      runArchitectureRefresh([], {
        listArchitectureFiles: () => Promise.resolve(['src/chat/router.ts']),
        cruiseGraph: () => Promise.resolve(createFullCommittedRawGraph()),
        formatGeneratedFiles: () => Promise.resolve(),
        rmDir: () => Promise.resolve(),
        mkdirp: () => Promise.resolve(),
        writeTextFile: () => Promise.reject(new Error('disk full')),
      }),
    ).rejects.toThrow('Architecture refresh rendering failed: disk full')
  })

  test('passes tracked runtime files to dependency-cruiser', async () => {
    const rawGraph = createFullCommittedRawGraph()
    const cruiseGraph = mock((_files: readonly string[]) => Promise.resolve(rawGraph))

    await runArchitectureRefresh([], {
      listArchitectureFiles: () => Promise.resolve(['src/chat/router.ts', 'client/settings/App.svelte']),
      cruiseGraph,
      formatGeneratedFiles: () => Promise.resolve(),
      rmDir: () => Promise.resolve(),
      mkdirp: () => Promise.resolve(),
      writeTextFile: () => Promise.resolve(),
    })

    expect(cruiseGraph).toHaveBeenCalledWith(['src/chat/router.ts', 'client/settings/App.svelte'])
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { constants } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DependencyType, ICruiseResult, IDependency, IModule, ISummary } from 'dependency-cruiser'

import { findDotExecutable, renderDotToSvg, runArchitectureRefresh } from '../../scripts/architecture-refresh.js'

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
  'docs/architecture/client/admin.svg',
  'docs/architecture/client/debug.svg',
  'docs/architecture/client/overview.md',
  'docs/architecture/client/settings.svg',
  'docs/architecture/diagrams/server-archi.svg',
  'docs/architecture/diagrams/server-ddot.svg',
  'docs/architecture/overview.md',
  'docs/architecture/raw/dependency-cruiser.json',
  'docs/architecture/server/attachments.md',
  'docs/architecture/server/attachments.svg',
  'docs/architecture/server/chat.md',
  'docs/architecture/server/chat.svg',
  'docs/architecture/server/deferred-prompts.md',
  'docs/architecture/server/deferred-prompts.svg',
  'docs/architecture/server/identity.md',
  'docs/architecture/server/identity.svg',
  'docs/architecture/server/instances.md',
  'docs/architecture/server/instances.svg',
  'docs/architecture/server/llm-orchestrator.md',
  'docs/architecture/server/llm-orchestrator.svg',
  'docs/architecture/server/mcp-web.md',
  'docs/architecture/server/mcp-web.svg',
  'docs/architecture/server/memory-memos.md',
  'docs/architecture/server/memory-memos.svg',
  'docs/architecture/server/message-queue.md',
  'docs/architecture/server/message-queue.svg',
  'docs/architecture/server/providers-plugins.md',
  'docs/architecture/server/providers-plugins.svg',
  'docs/architecture/server/settings-debug.md',
  'docs/architecture/server/settings-debug.svg',
  'docs/architecture/server/stats-usage.md',
  'docs/architecture/server/stats-usage.svg',
  'docs/architecture/server/tools.md',
  'docs/architecture/server/tools.svg',
] as const

const expectedCommittedArtifactPathsInWorkspace = expectedCommittedArtifactPaths.map((relativePath) =>
  path.join(process.cwd(), relativePath),
)

describe('runArchitectureRefresh', () => {
  let writes: Array<{ path: string; content: string }>

  beforeEach(() => {
    writes = []
  })

  test('writes the full committed Task 4 artifact set', async () => {
    const rawGraph = createFullCommittedRawGraph()

    await runArchitectureRefresh([], {
      cruiseGraph: () => Promise.resolve(rawGraph),
      formatTopLevelGraph: (kind) => Promise.resolve(`digraph ${kind} {}`),
      renderDotToSvg: (dot) => Promise.resolve(`<svg>${dot}</svg>`),
      formatGeneratedFiles: () => Promise.resolve(),
      rmDir: () => Promise.resolve(),
      mkdirp: () => Promise.resolve(),
      writeTextFile: (filePath, content) => {
        writes.push({ path: filePath, content })
        return Promise.resolve()
      },
    })

    expect(writes.map((entry) => entry.path).sort()).toEqual([...expectedCommittedArtifactPathsInWorkspace].sort())
  })

  test('resolves dot from PATH before falling back to hard-coded locations', async () => {
    const checkedPaths: string[] = []

    const executable = await findDotExecutable({
      env: { PATH: '/usr/bin:/bin' },
      whichExecutable: (command, options) => {
        expect(command).toBe('dot')
        expect(options).toEqual({ PATH: '/usr/bin:/bin' })
        return '/usr/bin/dot'
      },
      accessPath: (candidate) => {
        checkedPaths.push(candidate)
        return Promise.reject(new Error(`unexpected fallback access for ${candidate}`))
      },
    })

    expect(executable).toBe('/usr/bin/dot')
    expect(checkedPaths).toEqual([])
  })

  test('falls back to deterministic svg output when PATH and known dot locations are unavailable', async () => {
    const checkedPaths: string[] = []

    const executable = await findDotExecutable({
      env: { PATH: '/missing/bin' },
      whichExecutable: () => null,
      accessPath: (candidate) => {
        checkedPaths.push(candidate)
        return Promise.reject(new Error(`missing ${candidate}`))
      },
    })

    expect(executable).toBeNull()
    expect(checkedPaths).toEqual(['/opt/homebrew/bin/dot', '/usr/local/bin/dot'])

    await expect(
      renderDotToSvg('digraph test {}', {
        env: { PATH: '/missing/bin' },
        whichExecutable: () => null,
        accessPath: () => Promise.reject(new Error('missing dot')),
      }),
    ).rejects.toThrow('Graphviz dot executable not available on PATH or known fallback locations')
  })

  test('wraps graph generation failures with stage-specific context', async () => {
    await expect(
      runArchitectureRefresh([], {
        cruiseGraph: () => Promise.reject(new Error('depcruise exploded')),
      }),
    ).rejects.toThrow('Architecture refresh graph generation failed: depcruise exploded')
  })

  test('wraps normalization failures with stage-specific context', async () => {
    await expect(
      runArchitectureRefresh([], {
        cruiseGraph: () =>
          Promise.resolve({
            modules: [createModule('src/unknown/runtime.ts', [])],
            summary: createSummary(),
          }),
      }),
    ).rejects.toThrow('Architecture refresh normalization failed: Uncategorized runtime path: src/unknown/runtime.ts')
  })

  test('wraps rendering failures with stage-specific context', async () => {
    const rawGraph = createFullCommittedRawGraph()

    await expect(
      runArchitectureRefresh([], {
        cruiseGraph: () => Promise.resolve(rawGraph),
        formatTopLevelGraph: () => Promise.resolve('digraph broken {}'),
        renderDotToSvg: () => Promise.reject(new Error('dot exited with code 1')),
        formatGeneratedFiles: () => Promise.resolve(),
        rmDir: () => Promise.resolve(),
        mkdirp: () => Promise.resolve(),
        writeTextFile: () => Promise.resolve(),
      }),
    ).rejects.toThrow('Architecture refresh rendering failed: dot exited with code 1')
  })

  test('leaves the output tree untouched when graphviz is unavailable before rendering starts', async () => {
    const rawGraph = createFullCommittedRawGraph()
    const rmDir = mock((_dirPath: string) => Promise.resolve())
    const mkdirp = mock((_dirPath: string) => Promise.resolve())
    const writeTextFile = mock((_filePath: string, _content: string) => Promise.resolve())

    await expect(
      runArchitectureRefresh([], {
        cruiseGraph: () => Promise.resolve(rawGraph),
        formatTopLevelGraph: () => Promise.resolve('digraph ready {}'),
        renderDotToSvg: (_dot) => Promise.resolve('<svg/>'),
        preflightDiagramRenderer: () =>
          Promise.reject(new Error('Graphviz dot executable not available on PATH or known fallback locations')),
        formatGeneratedFiles: () => Promise.resolve(),
        rmDir,
        mkdirp,
        writeTextFile,
      }),
    ).rejects.toThrow(
      'Architecture refresh rendering failed: Graphviz dot executable not available on PATH or known fallback locations',
    )

    expect(rmDir).not.toHaveBeenCalled()
    expect(mkdirp).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  test('prefers GRAPHVIZ_DOT before hard-coded fallback candidates', async () => {
    const checkedPaths: string[] = []
    const accessResults = [
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, 10)
      }),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, 0)
      }),
      new Promise<void>(() => {}),
    ]

    const executable = await findDotExecutable({
      env: {
        PATH: '/missing/bin',
        GRAPHVIZ_DOT: '/custom/bin/dot',
      },
      whichExecutable: () => null,
      accessPath: (candidate) => {
        checkedPaths.push(candidate)
        return accessResults.shift()!
      },
    })

    expect(executable).toBe('/custom/bin/dot')
    expect(checkedPaths).toEqual(['/custom/bin/dot'])
  })

  test('ignores readable-but-non-executable fallback candidates', async () => {
    const accessPath = mock((_candidate: string, _mode?: number) => Promise.reject(new Error('not executable')))

    const executable = await findDotExecutable({
      env: {
        PATH: '/missing/bin',
        GRAPHVIZ_DOT: '/custom/bin/dot',
      },
      whichExecutable: () => null,
      accessPath,
    })

    expect(executable).toBeNull()
    expect(accessPath.mock.calls.map((call) => call[1])).toEqual([constants.X_OK, constants.X_OK, constants.X_OK])
  })

  test('waits for graphviz stdout to close before resolving successful renders', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'architecture-refresh-'))
    const dotPath = path.join(tempDir, 'dot')

    try {
      await writeFile(
        dotPath,
        ['#!/bin/sh', 'cat >/dev/null', '(sleep 0.05; printf "<svg>delayed output</svg>\\n") &', 'exit 0', ''].join(
          '\n',
        ),
        'utf8',
      )
      await chmod(dotPath, 0o755)

      const svg = await renderDotToSvg('digraph test {}', {
        env: {
          PATH: '/missing/bin',
          GRAPHVIZ_DOT: dotPath,
        },
        whichExecutable: () => null,
      })

      expect(svg).toContain('<svg>delayed output</svg>')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

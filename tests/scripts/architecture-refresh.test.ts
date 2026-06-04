// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

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

const createRawGraph = (): ICruiseResult => ({
  modules: [
    createModule('src/chat/router.ts', ['src/tools/tools-builder.ts']),
    createModule('src/tools/tools-builder.ts', []),
    createModule('client/settings/App.svelte', ['src/settings/session.ts']),
    createModule('src/settings/session.ts', []),
  ],
  summary: createSummary(),
})

const hasWrittenPath = (writePaths: readonly string[], expectedSuffix: string): boolean =>
  writePaths.some((writePath) => writePath.includes(expectedSuffix))

describe('runArchitectureRefresh', () => {
  let writes: Array<{ path: string; content: string }>

  beforeEach(() => {
    writes = []
  })

  test('writes the canonical raw graph, reduced json, top-level server diagrams, focused server docs, and client artifacts', async () => {
    const rawGraph = createRawGraph()

    await runArchitectureRefresh([], {
      cruiseGraph: () => Promise.resolve(rawGraph),
      formatTopLevelGraph: (kind) => Promise.resolve(`digraph ${kind} {}`),
      renderDotToSvg: (dot) => Promise.resolve(`<svg>${dot}</svg>`),
      formatGeneratedFiles: () => Promise.resolve(),
      rmDir: () => Promise.resolve(),
      mkdirp: () => Promise.resolve(),
      writeTextFile: (path, content) => {
        writes.push({ path, content })
        return Promise.resolve()
      },
    })

    const writePaths = writes.map((entry) => entry.path)

    expect(hasWrittenPath(writePaths, 'docs/architecture/raw/dependency-cruiser.json')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/architecture-llm.json')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/overview.md')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/diagrams/server-archi.svg')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/diagrams/server-ddot.svg')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/server/chat.md')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/server/chat.svg')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/client/overview.md')).toBe(true)
    expect(hasWrittenPath(writePaths, 'docs/architecture/client/settings.svg')).toBe(true)
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

    const svg = await renderDotToSvg('digraph test {}', {
      env: { PATH: '/missing/bin' },
      whichExecutable: () => null,
      accessPath: () => Promise.reject(new Error('missing dot')),
    })

    expect(svg).toContain('Graphviz dot executable not available')
    expect(svg).toContain('digraph test {}')
  })
})

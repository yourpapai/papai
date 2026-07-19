// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import assert from 'node:assert'

import { runPhase2c, type Phase2cDeps } from '../../../scripts/behavior-audit/closure-verifier-pipeline.js'
import type { ConsolidatedManifest } from '../../../scripts/behavior-audit/incremental.js'
import type { ConsolidatedBehavior } from '../../../scripts/behavior-audit/report-writer.js'

type LoadedCodeindexDeps = Awaited<ReturnType<Phase2cDeps['loadCodeindexDeps']>>

interface Harness {
  readonly deps: Phase2cDeps
  readonly reads: string[]
  readonly writes: ReadonlyArray<{ readonly featureKey: string; readonly behaviors: readonly ConsolidatedBehavior[] }>
  readonly logs: string[]
  readonly warnings: string[]
}

function createBehavior(overrides: Partial<ConsolidatedBehavior> = {}): ConsolidatedBehavior {
  return {
    id: 'b1',
    domain: 'tools',
    featureName: 'Sample',
    isUserFacing: true,
    behavior: 'does something',
    userStory: 'As a user, I want /config',
    context: '',
    sourceTestKeys: [],
    sourceBehaviorIds: [],
    supportingInternalRefs: [],
    entryPointHints: [{ kind: 'command', identifier: '/config' }],
    closure: null,
    ...overrides,
  }
}

function createLoadedCodeindexDeps(
  search: {
    readonly findSymbolCandidates?: () => readonly {
      readonly filePath: string
      readonly startLine: number
      readonly endLine: number
      readonly symbolKey: string
      readonly qualifiedName: string
      readonly snippet: string
    }[]
  } = {},
): LoadedCodeindexDeps {
  return {
    loadCodeindexConfig: () => Promise.resolve({ dbPath: ':memory:' }),
    search: {
      findSymbolCandidates: (_db, _query, _limit) => [...(search.findSymbolCandidates?.() ?? [])],
      findIncomingReferences: () => [],
    },
    db: {
      openDatabase: () => new Database(':memory:'),
    },
  }
}

function createHarness(
  input: {
    readonly behaviorsByFeatureKey?: Readonly<Record<string, readonly ConsolidatedBehavior[]>>
    readonly codeindexDeps?: LoadedCodeindexDeps | null
  } = {},
): Harness {
  const behaviorsByFeatureKey = input.behaviorsByFeatureKey ?? {}
  const reads: string[] = []
  const writes: Array<{ readonly featureKey: string; readonly behaviors: readonly ConsolidatedBehavior[] }> = []
  const logs: string[] = []
  const warnings: string[] = []

  const deps: Phase2cDeps = {
    repoRoot: '/fake/repo',
    loadCommandCatalog: () => Promise.resolve(() => [{ name: 'config', description: 'Configure' }]),
    loadToolRegistry: () => Promise.resolve(() => ['createTask']),
    loadRouteRegistry: () => Promise.resolve(() => ['/api/settings']),
    loadCodeindexDeps: () => {
      if (input.codeindexDeps === null) {
        return Promise.reject(new Error('codeindex unavailable'))
      }
      return Promise.resolve(input.codeindexDeps ?? createLoadedCodeindexDeps())
    },
    readConsolidatedFile: (featureKey: string) => {
      reads.push(featureKey)
      return Promise.resolve(behaviorsByFeatureKey[featureKey] ?? null)
    },
    writeConsolidatedFile: (featureKey: string, behaviors: readonly ConsolidatedBehavior[]) => {
      writes.push({ featureKey, behaviors })
      return Promise.resolve()
    },
    concurrency: 2,
    log: {
      log: (message: string) => {
        logs.push(message)
      },
      warn: (message: string) => {
        warnings.push(message)
      },
    },
  }

  return { deps, reads, writes, logs, warnings }
}

const manifestWith = (featureKeys: readonly string[]): ConsolidatedManifest => ({
  version: 1,
  entries: Object.fromEntries(
    featureKeys.map((featureKey) => [
      `id::${featureKey}`,
      {
        consolidatedId: `id::${featureKey}`,
        domain: 'tools',
        featureName: featureKey,
        sourceTestKeys: [],
        sourceBehaviorIds: [],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey,
        keywords: [],
        sourceDomains: ['tools'],
        phase2Fingerprint: 'fp',
        lastConsolidatedAt: '2026-04-22T10:00:00.000Z',
      },
    ]),
  ),
})

describe('runPhase2c', () => {
  test('writes closure results back into consolidated files for each featureKey', async () => {
    const manifest = manifestWith(['candidate-a', 'candidate-b'])
    const { deps, writes, reads, logs } = createHarness({
      behaviorsByFeatureKey: {
        'candidate-a': [createBehavior({ id: 'a1', entryPointHints: [{ kind: 'command', identifier: '/config' }] })],
        'candidate-b': [createBehavior({ id: 'b1', entryPointHints: [{ kind: 'command', identifier: '/missing' }] })],
      },
    })

    await runPhase2c(manifest, new Set(), deps)

    expect(reads.toSorted()).toEqual(['candidate-a', 'candidate-b'])
    expect(writes).toHaveLength(2)
    const writeA = writes.find((w) => w.featureKey === 'candidate-a')
    const writeB = writes.find((w) => w.featureKey === 'candidate-b')
    assert(writeA !== undefined)
    assert(writeB !== undefined)
    expect(writeA.behaviors[0]?.closure?.closureStatus).toBe('resolved')
    expect(writeB.behaviors[0]?.closure?.closureStatus).toBe('unresolved')
    expect(logs[0]).toContain('Phase 2c complete')
  })

  test('skips featureKey when consolidated file is missing on disk', async () => {
    const manifest = manifestWith(['missing'])
    const { deps, writes } = createHarness({ behaviorsByFeatureKey: {} })

    await runPhase2c(manifest, new Set(), deps)

    expect(writes).toHaveLength(0)
  })

  test('gracefully degrades when codeindex fails to load', async () => {
    const manifest = manifestWith(['candidate'])
    const { deps, writes, warnings } = createHarness({
      behaviorsByFeatureKey: {
        candidate: [
          createBehavior({
            id: 'h1',
            entryPointHints: [{ kind: 'handler', identifier: 'onTextMessage' }],
          }),
        ],
      },
      codeindexDeps: null,
    })

    await runPhase2c(manifest, new Set(), deps)

    expect(warnings.some((w) => w.includes('codeindex unavailable'))).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.behaviors[0]?.closure?.closureStatus).toBe('unresolved')
  })

  test('handles empty manifest entries without error', async () => {
    const manifest: ConsolidatedManifest = { version: 1, entries: {} }
    const { deps, reads, writes, logs } = createHarness()

    await runPhase2c(manifest, new Set(), deps)

    expect(reads).toEqual([])
    expect(writes).toEqual([])
    expect(logs[0]).toContain('0 feature keys verified')
  })

  test('when selectedFeatureKeys contains one of three featureKeys, only that one is re-verified', async () => {
    const manifest = manifestWith(['feature-a', 'feature-b', 'feature-c'])
    const { deps, writes, reads, logs } = createHarness({
      behaviorsByFeatureKey: {
        'feature-a': [createBehavior({ id: 'a1', entryPointHints: [{ kind: 'command', identifier: '/config' }] })],
        'feature-b': [createBehavior({ id: 'b1', entryPointHints: [{ kind: 'command', identifier: '/config' }] })],
        'feature-c': [createBehavior({ id: 'c1', entryPointHints: [{ kind: 'command', identifier: '/config' }] })],
      },
    })

    await runPhase2c(manifest, new Set(['feature-b']), deps)

    expect(reads).toEqual(['feature-b'])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.featureKey).toBe('feature-b')
    expect(logs[0]).toContain('1 feature keys verified')
  })
})

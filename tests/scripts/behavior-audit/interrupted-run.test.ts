import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../../scripts/behavior-audit/incremental.js'
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../../scripts/behavior-audit/index.js'
import type { Progress } from '../../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, createIncrementalManifestFixture } from '../behavior-audit-integration.helpers.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

function createSelection(overrides: Partial<IncrementalSelection> = {}): IncrementalSelection {
  return {
    phase1SelectedTestKeys: [],
    phase2aSelectedTestKeys: [],
    phase2bSelectedFeatureKeys: [],
    phase3SelectedConsolidatedIds: [],
    reportRebuildOnly: false,
    ...overrides,
  }
}

// Returns a prepareIncrementalRun callback that emits the first-run result on
// the first invocation and the second-run result on every subsequent invocation.
// The routing is expressed as a lookup table so no conditional lives inside the
// test block itself.
function makePrepareIncrementalRun(
  firstResult: Awaited<ReturnType<BehaviorAuditDeps['prepareIncrementalRun']>>,
  subsequentResult: Awaited<ReturnType<BehaviorAuditDeps['prepareIncrementalRun']>>,
  runCount: { current: number },
): BehaviorAuditDeps['prepareIncrementalRun'] {
  const resultByRun: ReadonlyArray<Awaited<ReturnType<BehaviorAuditDeps['prepareIncrementalRun']>>> = [
    firstResult,
    subsequentResult,
  ]
  return () => {
    runCount.current += 1
    const result = resultByRun[Math.min(runCount.current - 1, resultByRun.length - 1)]
    assert(result !== undefined)
    return Promise.resolve(result)
  }
}

// Returns a runPhase2bIfNeeded callback that rejects on the first invocation
// (simulating interruption) and resolves on every subsequent invocation.
function makeRunPhase2bIfNeeded(
  interruptionError: Error,
  successResult: ConsolidatedManifest,
  runCount: { current: number },
): BehaviorAuditDeps['runPhase2bIfNeeded'] {
  const firstRunIndex = 1
  return () => {
    const isFirstRun = runCount.current === firstRunIndex
    return isFirstRun ? Promise.reject(interruptionError) : Promise.resolve(successResult)
  }
}

function createNoopProgressReporter(): {
  readonly emit: () => void
  readonly end: () => void
} {
  return {
    emit: (): void => undefined,
    end: (): void => undefined,
  }
}

describe('behavior-audit interrupted-run baseline', () => {
  test('interrupted first run still seeds next incremental baseline from lastStartCommit', async () => {
    const selectedKey = 'tests/tools/sample.test.ts::suite > case'
    const parsedFiles = [
      parseTestFile(
        'tests/tools/sample.test.ts',
        ["describe('suite', () => {", "  test('case', () => {})", '})', ''].join('\n'),
      ),
    ]
    const selectionInputs: Array<{
      readonly previousManifest: IncrementalManifest
      readonly updatedManifest: IncrementalManifest
      readonly previousLastStartCommit: string | null
    }> = []
    const progress = createEmptyProgress(1)
    const consolidatedManifest: ConsolidatedManifest = { version: 1, entries: {} }
    const firstPreviousManifest = createIncrementalManifestFixture({
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {},
    })
    const firstUpdatedManifest = createIncrementalManifestFixture({
      ...firstPreviousManifest,
      lastStartCommit: 'head-1',
      lastStartedAt: '2026-04-22T10:00:00.000Z',
      tests: {},
    })
    const secondUpdatedManifest = createIncrementalManifestFixture({
      ...firstUpdatedManifest,
      lastStartCommit: 'head-2',
      lastStartedAt: '2026-04-22T11:00:00.000Z',
      tests: firstUpdatedManifest.tests,
    })

    const runCount = { current: 0 }
    const runPhase1SelectedKeys: string[][] = []

    const deps: BehaviorAuditDeps = {
      requireOpenAiApiKey: () => {},
      prepareIncrementalRun: makePrepareIncrementalRun(
        {
          previousManifest: firstPreviousManifest,
          previousLastStartCommit: null,
          updatedManifest: firstUpdatedManifest,
        },
        {
          previousManifest: firstUpdatedManifest,
          previousLastStartCommit: 'head-1',
          updatedManifest: secondUpdatedManifest,
        },
        runCount,
      ),
      selectIncrementalRunWork: (input) => {
        selectionInputs.push(input)
        return Promise.resolve({
          parsedFiles,
          previousConsolidatedManifest: null,
          selection: createSelection({
            phase1SelectedTestKeys: [selectedKey],
            phase2aSelectedTestKeys: [selectedKey],
          }),
        })
      },
      loadOrCreateProgress: () => Promise.resolve(progress),
      createProgressReporter: () => createNoopProgressReporter(),
      rebuildReportsFromStoredResults: () => Promise.resolve(),
      runPhase1IfNeeded: (_parsedFiles, _progress, selectedTestKeys) => {
        runPhase1SelectedKeys.push([...selectedTestKeys].toSorted())
        return Promise.resolve()
      },
      runPhase1bIfNeeded: () => Promise.resolve(),
      runPhase2aIfNeeded: () => Promise.resolve(new Set()),
      runPhase2bIfNeeded: makeRunPhase2bIfNeeded(
        new Error('simulated interruption after run start'),
        consolidatedManifest,
        runCount,
      ),
      saveConsolidatedManifest: () => Promise.resolve(),
      runPhase3IfNeeded: () => Promise.resolve(),
      stdout: { isTTY: false },
      isTestEnvironment: true,
      log: { log: mock(() => {}) },
    }

    await expect(runBehaviorAudit(deps)).rejects.toThrow('simulated interruption after run start')

    await runBehaviorAudit(deps)

    expect(selectionInputs[1]).toEqual({
      previousManifest: firstUpdatedManifest,
      updatedManifest: secondUpdatedManifest,
      previousLastStartCommit: 'head-1',
    })
    expect(runPhase1SelectedKeys[1]).toEqual([selectedKey])
  })
})

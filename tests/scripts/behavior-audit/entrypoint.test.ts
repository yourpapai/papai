import { afterEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert'

import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../../scripts/behavior-audit/incremental.js'
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../../scripts/behavior-audit/index.js'
import {
  resolveProgressRenderer,
  type BehaviorAuditProgressReporter,
} from '../../../scripts/behavior-audit/progress-reporter.js'
import type { Progress } from '../../../scripts/behavior-audit/progress.js'
import { parseTestFile, type ParsedTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createIncrementalManifestFixture,
  createManifestTestEntry,
} from '../behavior-audit-integration.helpers.js'

type SelectWorkInput = Parameters<BehaviorAuditDeps['selectIncrementalRunWork']>[0]
type RebuildReportsInput = Parameters<BehaviorAuditDeps['rebuildReportsFromStoredResults']>[0]
type CreateProgressReporterInput = Parameters<BehaviorAuditDeps['createProgressReporter']>[0]

const originalProgressRendererEnv = process.env['BEHAVIOR_AUDIT_PROGRESS_RENDERER']

afterEach(() => {
  if (originalProgressRendererEnv === undefined) {
    delete process.env['BEHAVIOR_AUDIT_PROGRESS_RENDERER']
  } else {
    process.env['BEHAVIOR_AUDIT_PROGRESS_RENDERER'] = originalProgressRendererEnv
  }
  reloadBehaviorAuditConfig()
})

function setProgressRendererEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env['BEHAVIOR_AUDIT_PROGRESS_RENDERER']
  } else {
    process.env['BEHAVIOR_AUDIT_PROGRESS_RENDERER'] = value
  }
  reloadBehaviorAuditConfig()
}

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

function createParsedFiles(): readonly ParsedTestFile[] {
  return [
    parseTestFile(
      'tests/tools/sample.test.ts',
      ["describe('suite', () => {", "  test('first case', () => {})", "  test('second case', () => {})", '})', ''].join(
        '\n',
      ),
    ),
  ]
}

function getParsedTestKeys(parsedFiles: readonly ParsedTestFile[]): readonly string[] {
  return parsedFiles
    .flatMap((parsedFile) => parsedFile.tests.map((testCase) => `${parsedFile.filePath}::${testCase.fullPath}`))
    .toSorted()
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

function createConsolidatedManifest(): ConsolidatedManifest {
  return { version: 1, entries: {} }
}

function expectReporterInput(
  input: CreateProgressReporterInput | undefined,
  expected: Omit<CreateProgressReporterInput, 'log'>,
): CreateProgressReporterInput {
  assert(input !== undefined)
  expect(input.renderer).toBe(expected.renderer)
  expect(input.isTTY).toBe(expected.isTTY)
  expect(input.isTestEnvironment).toBe(expected.isTestEnvironment)
  expect(typeof input.log).toBe('function')
  return input
}

function createHarness(
  overrides: Partial<{
    parsedFiles: readonly ParsedTestFile[]
    previousManifest: IncrementalManifest
    updatedManifest: IncrementalManifest
    previousLastStartCommit: string | null
    previousConsolidatedManifest: ConsolidatedManifest | null
    selection: IncrementalSelection
    progress: Progress
    dirtyFromPhase2a: ReadonlySet<string>
    consolidatedManifest: ConsolidatedManifest
    requireOpenAiApiKeyError: Error | null
    reporter: BehaviorAuditProgressReporter
    stdoutIsTTY: boolean
    isTestEnvironment: boolean
  }> = {},
): {
  readonly deps: BehaviorAuditDeps
  readonly calls: {
    readonly requireOpenAiApiKey: { count: number }
    readonly prepareIncrementalRun: { count: number }
    readonly selectIncrementalRunWork: SelectWorkInput[]
    readonly loadOrCreateProgress: number[]
    readonly rebuildReportsFromStoredResults: RebuildReportsInput[]
    readonly runPhase1IfNeeded: Array<{
      readonly parsedTestKeys: readonly string[]
      readonly progress: Progress
      readonly selectedTestKeys: readonly string[]
      readonly manifest: IncrementalManifest
      readonly reporter: BehaviorAuditProgressReporter
    }>
    readonly runPhase1bIfNeeded: { count: number }
    readonly runPhase2aIfNeeded: Array<{
      readonly progress: Progress
      readonly manifest: IncrementalManifest
      readonly selectedTestKeys: readonly string[]
      readonly reporter: BehaviorAuditProgressReporter
    }>
    readonly runPhase2bIfNeeded: Array<{
      readonly progress: Progress
      readonly phase2Version: string
      readonly selectedFeatureKeys: readonly string[]
      readonly reporter: BehaviorAuditProgressReporter
    }>
    readonly saveConsolidatedManifest: ConsolidatedManifest[]
    readonly runPhase3IfNeeded: Array<{
      readonly progress: Progress
      readonly selectedConsolidatedIds: readonly string[]
      readonly selectedFeatureKeys: readonly string[]
      readonly consolidatedManifest: ConsolidatedManifest | null
      readonly reporter: BehaviorAuditProgressReporter
    }>
    readonly createProgressReporter: CreateProgressReporterInput[]
    readonly logs: string[]
  }
} {
  const parsedFiles = overrides.parsedFiles ?? createParsedFiles()
  const previousManifest =
    overrides.previousManifest ??
    createIncrementalManifestFixture({
      phaseVersions: { phase1: 'phase1-old', phase2: 'phase2-old', reports: 'reports-old' },
      tests: {},
    })
  const updatedManifest =
    overrides.updatedManifest ??
    createIncrementalManifestFixture({
      ...previousManifest,
      phaseVersions: { phase1: 'phase1-new', phase2: 'phase2-new', reports: 'reports-new' },
      tests: previousManifest.tests,
    })
  const previousLastStartCommit = overrides.previousLastStartCommit ?? null
  const selection =
    overrides.selection ??
    createSelection({
      phase1SelectedTestKeys: getParsedTestKeys(parsedFiles),
      phase2aSelectedTestKeys: getParsedTestKeys(parsedFiles),
    })
  const progress = overrides.progress ?? createEmptyProgress(parsedFiles.length)
  const previousConsolidatedManifest = overrides.previousConsolidatedManifest ?? null
  const dirtyFromPhase2a = overrides.dirtyFromPhase2a ?? new Set<string>()
  const consolidatedManifest = overrides.consolidatedManifest ?? createConsolidatedManifest()
  const requireOpenAiApiKeyError = overrides.requireOpenAiApiKeyError ?? null
  const reporter = overrides.reporter ?? {
    emit: mock((_event) => undefined),
    end: mock(() => undefined),
  }
  const stdoutIsTTY = overrides.stdoutIsTTY ?? false
  const isTestEnvironment = overrides.isTestEnvironment ?? false

  const calls = {
    requireOpenAiApiKey: { count: 0 },
    prepareIncrementalRun: { count: 0 },
    selectIncrementalRunWork: [] as SelectWorkInput[],
    loadOrCreateProgress: [] as number[],
    rebuildReportsFromStoredResults: [] as RebuildReportsInput[],
    runPhase1IfNeeded: [] as Array<{
      readonly parsedTestKeys: readonly string[]
      readonly progress: Progress
      readonly selectedTestKeys: readonly string[]
      readonly manifest: IncrementalManifest
      readonly reporter: BehaviorAuditProgressReporter
    }>,
    runPhase1bIfNeeded: { count: 0 },
    runPhase2aIfNeeded: [] as Array<{
      readonly progress: Progress
      readonly manifest: IncrementalManifest
      readonly selectedTestKeys: readonly string[]
      readonly reporter: BehaviorAuditProgressReporter
    }>,
    runPhase2bIfNeeded: [] as Array<{
      readonly progress: Progress
      readonly phase2Version: string
      readonly selectedFeatureKeys: readonly string[]
      readonly reporter: BehaviorAuditProgressReporter
    }>,
    saveConsolidatedManifest: [] as ConsolidatedManifest[],
    runPhase3IfNeeded: [] as Array<{
      readonly progress: Progress
      readonly selectedConsolidatedIds: readonly string[]
      readonly selectedFeatureKeys: readonly string[]
      readonly consolidatedManifest: ConsolidatedManifest | null
      readonly reporter: BehaviorAuditProgressReporter
    }>,
    createProgressReporter: [] as CreateProgressReporterInput[],
    logs: [] as string[],
  }

  const deps: BehaviorAuditDeps = {
    requireOpenAiApiKey: () => {
      calls.requireOpenAiApiKey.count += 1
      if (requireOpenAiApiKeyError !== null) {
        throw requireOpenAiApiKeyError
      }
    },
    prepareIncrementalRun: () => {
      calls.prepareIncrementalRun.count += 1
      return Promise.resolve({ previousManifest, previousLastStartCommit, updatedManifest })
    },
    selectIncrementalRunWork: (input) => {
      calls.selectIncrementalRunWork.push(input)
      return Promise.resolve({ parsedFiles, previousConsolidatedManifest, selection })
    },
    loadOrCreateProgress: (testCount) => {
      calls.loadOrCreateProgress.push(testCount)
      return Promise.resolve(progress)
    },
    createProgressReporter: (input) => {
      calls.createProgressReporter.push(input)
      return reporter
    },
    rebuildReportsFromStoredResults: (input) => {
      calls.rebuildReportsFromStoredResults.push(input)
      return Promise.resolve()
    },
    runPhase1IfNeeded: (phaseParsedFiles, phaseProgress, selectedTestKeys, manifest, phaseReporter) => {
      calls.runPhase1IfNeeded.push({
        parsedTestKeys: getParsedTestKeys(phaseParsedFiles),
        progress: phaseProgress,
        selectedTestKeys: [...selectedTestKeys].toSorted(),
        manifest,
        reporter: phaseReporter,
      })
      return Promise.resolve()
    },
    runPhase1bIfNeeded: (_progress) => {
      calls.runPhase1bIfNeeded.count += 1
      return Promise.resolve()
    },
    runPhase2aIfNeeded: (phaseProgress, manifest, selectedTestKeys, phaseReporter) => {
      calls.runPhase2aIfNeeded.push({
        progress: phaseProgress,
        manifest,
        selectedTestKeys: [...selectedTestKeys].toSorted(),
        reporter: phaseReporter,
      })
      return Promise.resolve(dirtyFromPhase2a)
    },
    runPhase2bIfNeeded: (phaseProgress, phase2Version, selectedFeatureKeys, phaseReporter) => {
      calls.runPhase2bIfNeeded.push({
        progress: phaseProgress,
        phase2Version,
        selectedFeatureKeys: [...selectedFeatureKeys].toSorted(),
        reporter: phaseReporter,
      })
      return Promise.resolve(consolidatedManifest)
    },
    saveConsolidatedManifest: (manifest) => {
      calls.saveConsolidatedManifest.push(manifest)
      return Promise.resolve()
    },
    runPhase3IfNeeded: (
      phaseProgress,
      selectedConsolidatedIds,
      selectedFeatureKeys,
      phaseConsolidatedManifest,
      phaseReporter,
    ) => {
      calls.runPhase3IfNeeded.push({
        progress: phaseProgress,
        selectedConsolidatedIds: [...selectedConsolidatedIds].toSorted(),
        selectedFeatureKeys: [...selectedFeatureKeys].toSorted(),
        consolidatedManifest: phaseConsolidatedManifest,
        reporter: phaseReporter,
      })
      return Promise.resolve()
    },
    stdout: { isTTY: stdoutIsTTY },
    isTestEnvironment,
    log: {
      log: mock((message: string) => {
        calls.logs.push(message)
      }),
    },
  }

  return { deps, calls }
}

describe('behavior-audit entrypoint incremental selection', () => {
  test('uses auto renderer config and resolves to text in non-tty environments', async () => {
    setProgressRendererEnv(undefined)
    const { deps, calls } = createHarness({ stdoutIsTTY: false, isTestEnvironment: false })

    await runBehaviorAudit(deps)

    expect(calls.createProgressReporter).toHaveLength(1)
    const reporterInput = expectReporterInput(calls.createProgressReporter[0], {
      renderer: 'auto',
      isTTY: false,
      isTestEnvironment: false,
    })
    expect(resolveProgressRenderer(reporterInput)).toBe('text')
  })

  test('uses auto renderer config and resolves to text in test environments', async () => {
    setProgressRendererEnv(undefined)
    const { deps, calls } = createHarness({ stdoutIsTTY: true, isTestEnvironment: true })

    await runBehaviorAudit(deps)

    expect(calls.createProgressReporter).toHaveLength(1)
    const reporterInput = expectReporterInput(calls.createProgressReporter[0], {
      renderer: 'auto',
      isTTY: true,
      isTestEnvironment: true,
    })
    expect(resolveProgressRenderer(reporterInput)).toBe('text')
  })

  test('uses explicit text renderer config', async () => {
    setProgressRendererEnv('text')
    const { deps, calls } = createHarness({ stdoutIsTTY: true, isTestEnvironment: false })

    await runBehaviorAudit(deps)

    expect(calls.createProgressReporter).toHaveLength(1)
    const reporterInput = expectReporterInput(calls.createProgressReporter[0], {
      renderer: 'text',
      isTTY: true,
      isTestEnvironment: false,
    })
    expect(resolveProgressRenderer(reporterInput)).toBe('text')
  })

  test('uses explicit listr2 renderer config', async () => {
    setProgressRendererEnv('listr2')
    const { deps, calls } = createHarness({ stdoutIsTTY: false, isTestEnvironment: true })

    await runBehaviorAudit(deps)

    expect(calls.createProgressReporter).toHaveLength(1)
    const reporterInput = expectReporterInput(calls.createProgressReporter[0], {
      renderer: 'listr2',
      isTTY: false,
      isTestEnvironment: true,
    })
    expect(resolveProgressRenderer(reporterInput)).toBe('text')
  })

  test('uses explicit listr2 renderer config and only resolves to listr2 when supported', async () => {
    setProgressRendererEnv('listr2')
    const { deps, calls } = createHarness({ stdoutIsTTY: true, isTestEnvironment: false })

    await runBehaviorAudit(deps)

    expect(calls.createProgressReporter).toHaveLength(1)
    const reporterInput = expectReporterInput(calls.createProgressReporter[0], {
      renderer: 'listr2',
      isTTY: true,
      isTestEnvironment: false,
    })
    expect(resolveProgressRenderer(reporterInput)).toBe('listr2')
  })

  test('creates one reporter per run and injects it into all phases', async () => {
    setProgressRendererEnv('text')
    const reporter = {
      emit: mock((_event) => undefined),
      end: mock(() => undefined),
    } satisfies BehaviorAuditProgressReporter
    const parsedFiles = createParsedFiles()
    const expectedKeys = getParsedTestKeys(parsedFiles)
    const { deps, calls } = createHarness({
      parsedFiles,
      reporter,
      selection: createSelection({
        phase1SelectedTestKeys: expectedKeys,
        phase2aSelectedTestKeys: expectedKeys,
      }),
    })

    await runBehaviorAudit(deps)

    expect(calls.createProgressReporter).toHaveLength(1)
    expect(calls.runPhase1IfNeeded[0]?.reporter).toBe(reporter)
    expect(calls.runPhase2aIfNeeded[0]?.reporter).toBe(reporter)
    expect(calls.runPhase2bIfNeeded[0]?.reporter).toBe(reporter)
    expect(calls.runPhase3IfNeeded[0]?.reporter).toBe(reporter)
    expect(reporter.end).toHaveBeenCalledTimes(1)
  })

  test('runs selected work and persists the consolidated manifest', async () => {
    const parsedFiles = createParsedFiles()
    const expectedKeys = getParsedTestKeys(parsedFiles)
    const { deps, calls } = createHarness({
      parsedFiles,
      selection: createSelection({
        phase1SelectedTestKeys: expectedKeys,
        phase2aSelectedTestKeys: expectedKeys,
      }),
    })

    await runBehaviorAudit(deps)

    const phase1Call = calls.runPhase1IfNeeded[0]
    const phase2aCall = calls.runPhase2aIfNeeded[0]
    const phase2bCall = calls.runPhase2bIfNeeded[0]
    const phase3Call = calls.runPhase3IfNeeded[0]
    assert(phase1Call !== undefined)
    assert(phase2aCall !== undefined)
    assert(phase2bCall !== undefined)
    assert(phase3Call !== undefined)

    expect(calls.loadOrCreateProgress).toEqual([1])
    expect(calls.runPhase1IfNeeded).toEqual([
      {
        parsedTestKeys: expectedKeys,
        progress: phase1Call.progress,
        selectedTestKeys: expectedKeys,
        manifest: phase1Call.manifest,
        reporter: phase1Call.reporter,
      },
    ])
    expect(calls.runPhase2aIfNeeded).toEqual([
      {
        progress: phase2aCall.progress,
        manifest: phase2aCall.manifest,
        selectedTestKeys: expectedKeys,
        reporter: phase2aCall.reporter,
      },
    ])
    expect(calls.runPhase2bIfNeeded).toEqual([
      {
        progress: phase2bCall.progress,
        phase2Version: 'phase2-new',
        selectedFeatureKeys: [],
        reporter: phase2bCall.reporter,
      },
    ])
    expect(calls.runPhase3IfNeeded).toEqual([
      {
        progress: phase3Call.progress,
        selectedConsolidatedIds: [],
        selectedFeatureKeys: [],
        consolidatedManifest: createConsolidatedManifest(),
        reporter: phase3Call.reporter,
      },
    ])
    expect(calls.saveConsolidatedManifest).toEqual([createConsolidatedManifest()])
    expect(calls.logs).toEqual(['Behavior Audit — discovering test files...\n', '\nBehavior audit complete.'])
  })

  test('fails fast when the API key requirement fails', async () => {
    const { deps, calls } = createHarness({
      requireOpenAiApiKeyError: new Error('Behavior audit requires OPENAI_API_KEY to be set'),
    })

    await expect(runBehaviorAudit(deps)).rejects.toThrow('Behavior audit requires OPENAI_API_KEY to be set')

    expect(calls.requireOpenAiApiKey.count).toBe(1)
    expect(calls.prepareIncrementalRun.count).toBe(0)
    expect(calls.selectIncrementalRunWork).toHaveLength(0)
    expect(calls.runPhase1IfNeeded).toHaveLength(0)
    expect(calls.runPhase2aIfNeeded).toHaveLength(0)
    expect(calls.runPhase2bIfNeeded).toHaveLength(0)
    expect(calls.runPhase3IfNeeded).toHaveLength(0)
    expect(calls.logs).toEqual([])
  })

  test('passes updated manifest context into incremental selection and forwards dirty phase2a work into phase2b', async () => {
    const parsedFiles = createParsedFiles()
    const selectedKey = 'tests/tools/sample.test.ts::suite > first case'
    const previousManifest = createIncrementalManifestFixture({
      lastStartCommit: 'previous-start',
      phaseVersions: { phase1: 'phase1-old', phase2: 'phase2-old', reports: 'reports-old' },
      tests: {
        [selectedKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > first case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'fp1',
          phase2Fingerprint: 'fp2',
          extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
          domain: 'tools',
          lastPhase1CompletedAt: 'x',
          lastPhase2CompletedAt: 'y',
        }),
      },
    })
    const updatedManifest = createIncrementalManifestFixture({
      ...previousManifest,
      lastStartCommit: 'updated-start',
      lastStartedAt: '2026-04-22T10:00:00.000Z',
      phaseVersions: { phase1: 'phase1-new', phase2: 'phase2-new', reports: 'reports-new' },
      tests: previousManifest.tests,
    })
    const previousConsolidatedManifest: ConsolidatedManifest = {
      version: 1,
      entries: {
        'tools::selected-case': {
          consolidatedId: 'tools::selected-case',
          domain: 'tools',
          featureName: 'Selected Case',
          sourceTestKeys: [selectedKey],
          sourceBehaviorIds: ['behavior-1'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey: 'candidate-from-selection',
          keywords: ['selection'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'phase2-fingerprint',
          lastConsolidatedAt: '2026-04-22T10:00:00.000Z',
        },
      },
    }
    const consolidatedManifest = createConsolidatedManifest()
    const { deps, calls } = createHarness({
      parsedFiles,
      previousManifest,
      updatedManifest,
      previousLastStartCommit: 'previous-start',
      previousConsolidatedManifest,
      selection: createSelection({
        phase1SelectedTestKeys: [selectedKey],
        phase2aSelectedTestKeys: [selectedKey],
        phase2bSelectedFeatureKeys: ['candidate-from-selection'],
        phase3SelectedConsolidatedIds: ['tools::selected-case'],
      }),
      dirtyFromPhase2a: new Set(['candidate-from-phase2a']),
      consolidatedManifest,
    })

    await runBehaviorAudit(deps)

    const phase2bCall = calls.runPhase2bIfNeeded[0]
    const phase3Call = calls.runPhase3IfNeeded[0]
    assert(phase2bCall !== undefined)
    assert(phase3Call !== undefined)

    expect(calls.selectIncrementalRunWork).toEqual([
      {
        previousManifest,
        updatedManifest,
        previousLastStartCommit: 'previous-start',
      },
    ])
    expect(calls.runPhase1IfNeeded[0]?.selectedTestKeys).toEqual([selectedKey])
    expect(calls.runPhase2aIfNeeded[0]?.selectedTestKeys).toEqual([selectedKey])
    expect(calls.runPhase2bIfNeeded).toEqual([
      {
        progress: phase2bCall.progress,
        phase2Version: 'phase2-new',
        selectedFeatureKeys: ['candidate-from-phase2a', 'candidate-from-selection'],
        reporter: phase2bCall.reporter,
      },
    ])
    expect(calls.runPhase3IfNeeded).toEqual([
      {
        progress: phase3Call.progress,
        selectedConsolidatedIds: ['tools::selected-case'],
        selectedFeatureKeys: ['candidate-from-phase2a', 'candidate-from-selection'],
        consolidatedManifest,
        reporter: phase3Call.reporter,
      },
    ])
  })

  test('does not short-circuit selected work when prior progress is already marked done', async () => {
    const selectedKey = 'tests/tools/sample.test.ts::suite > first case'
    const baseProgress = createEmptyProgress(1)
    const progress = {
      ...baseProgress,
      phase1: {
        ...baseProgress.phase1,
        status: 'done' as const,
        completedFiles: ['tests/tools/sample.test.ts'],
      },
      phase2b: {
        ...baseProgress.phase2b,
        status: 'done' as const,
        completedFeatureKeys: { 'candidate-from-selection': 'done' as const },
      },
      phase3: {
        ...baseProgress.phase3,
        status: 'done' as const,
        completedConsolidatedIds: { 'tools::selected-case': 'done' as const },
      },
    } satisfies Progress
    const { deps, calls } = createHarness({
      progress,
      selection: createSelection({
        phase1SelectedTestKeys: [selectedKey],
        phase2aSelectedTestKeys: [selectedKey],
        phase3SelectedConsolidatedIds: ['tools::selected-case'],
      }),
    })

    await runBehaviorAudit(deps)

    expect(calls.runPhase1IfNeeded).toHaveLength(1)
    expect(calls.runPhase2aIfNeeded).toHaveLength(1)
    expect(calls.runPhase2bIfNeeded).toHaveLength(1)
    expect(calls.runPhase3IfNeeded).toHaveLength(1)
    expect(calls.runPhase1IfNeeded[0]?.progress).toBe(progress)
    expect(calls.runPhase3IfNeeded[0]?.progress).toBe(progress)
  })

  test('rebuild-only selection calls report rebuilding and skips phase execution', async () => {
    const selectedKey = 'tests/tools/sample.test.ts::suite > first case'
    const previousManifest: IncrementalManifest = createIncrementalManifestFixture({
      lastStartCommit: 'previous-start',
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'reports-old' },
      tests: {
        [selectedKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > first case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'phase2-fp',
          extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
          domain: 'tools',
          lastPhase1CompletedAt: 'old-phase1',
          lastPhase2CompletedAt: 'old-phase2',
        }),
      },
    })
    const updatedManifest = createIncrementalManifestFixture({
      ...previousManifest,
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'reports-new' },
      tests: previousManifest.tests,
    })
    const previousConsolidatedManifest: ConsolidatedManifest = createConsolidatedManifest()
    const progress = createEmptyProgress(1)
    const { deps, calls } = createHarness({
      previousManifest,
      updatedManifest,
      previousConsolidatedManifest,
      progress,
      selection: createSelection({ reportRebuildOnly: true }),
    })

    await runBehaviorAudit(deps)

    expect(calls.rebuildReportsFromStoredResults).toEqual([
      {
        consolidatedManifest: previousConsolidatedManifest,
      },
    ])
    expect(calls.runPhase1IfNeeded).toHaveLength(0)
    expect(calls.runPhase2aIfNeeded).toHaveLength(0)
    expect(calls.runPhase2bIfNeeded).toHaveLength(0)
    expect(calls.runPhase3IfNeeded).toHaveLength(0)
    expect(calls.saveConsolidatedManifest).toHaveLength(0)
    expect(calls.logs).toEqual(['Behavior Audit — discovering test files...\n', '\nBehavior audit complete.'])
  })
})

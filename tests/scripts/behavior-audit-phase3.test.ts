import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { Phase2aDeps } from '../../scripts/behavior-audit/classify.js'
import type { Phase2bDeps } from '../../scripts/behavior-audit/consolidate.js'
import { writeReports } from '../../scripts/behavior-audit/evaluate-reporting.js'
import type { Phase3Deps } from '../../scripts/behavior-audit/evaluate.js'
import {
  buildPhase2Fingerprint,
  type ConsolidatedManifest,
  type IncrementalSelection,
} from '../../scripts/behavior-audit/incremental.js'
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit/index.js'
import {
  createTextProgressReporter,
  type BehaviorAuditProgressReporter,
  type ProgressEvent,
  type ProgressOutcome,
} from '../../scripts/behavior-audit/progress-reporter.js'
import {
  createConsolidatedManifestEntry,
  createEmptyProgressFixture,
  createManifestTestEntry,
  createIncrementalManifestFixture,
  mockAuditBehaviorConfig,
} from './behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from './behavior-audit-integration.runtime-helpers.js'
import {
  importWithGuard,
  isClassifyModule,
  loadConsolidateModule,
  loadEvaluateModule,
  type MockEvaluationResult,
} from './behavior-audit-integration.support.js'

function isDoneFinishEvent(event: ProgressEvent | undefined): event is DoneFinishEvent {
  return event !== undefined && event.kind === 'item-finish' && event.outcome.kind === 'done'
}

type DoneFinishEvent = Extract<ProgressEvent, { readonly kind: 'item-finish' }> & {
  readonly outcome: Extract<ProgressOutcome, { readonly kind: 'done' }>
}

function expectDoneFinishEvent(event: ProgressEvent | undefined): DoneFinishEvent {
  if (!isDoneFinishEvent(event)) {
    throw new Error('Expected done finish event')
  }

  return event
}

type ConsolidatedArtifactRecord = {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
}

type EvaluatedArtifactRecord = {
  readonly consolidatedId: string
  readonly maria: NonNullable<MockEvaluationResult>['result']['maria']
  readonly dani: NonNullable<MockEvaluationResult>['result']['dani']
  readonly viktor: NonNullable<MockEvaluationResult>['result']['viktor']
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly evaluatedAt: string
}

type Phase2aDepsHasWriteStdout = 'writeStdout' extends keyof Phase2aDeps ? true : false
type Phase2bDepsHasWriteStdout = 'writeStdout' extends keyof Phase2bDeps ? true : false
type Phase3DepsHasWriteStdout = 'writeStdout' extends keyof Phase3Deps ? true : false

function eventOrderLabel(event: ProgressEvent): string {
  if (event.kind !== 'item-finish') {
    return `reporter:${event.kind}:start`
  }

  return `reporter:${event.kind}:${event.outcome.kind}`
}

function createNoopProgressReporter(): BehaviorAuditProgressReporter {
  return {
    emit: (): void => undefined,
    end: (): void => undefined,
  }
}

const phase2aDepsHasWriteStdout: Phase2aDepsHasWriteStdout = false
const phase2bDepsHasWriteStdout: Phase2bDepsHasWriteStdout = false
const phase3DepsHasWriteStdout: Phase3DepsHasWriteStdout = false

void phase2aDepsHasWriteStdout
void phase2bDepsHasWriteStdout
void phase3DepsHasWriteStdout

function createRecordingReporter(onEmit?: (event: ProgressEvent) => void): {
  readonly events: ProgressEvent[]
  readonly lines: string[]
  readonly reporter: BehaviorAuditProgressReporter
} {
  const events: ProgressEvent[] = []
  const lines: string[] = []
  const textReporter = createTextProgressReporter({
    log: mock((line: string) => {
      lines.push(line)
    }),
  })

  return {
    events,
    lines,
    reporter: {
      emit(event): void {
        events.push(event)
        onEmit?.(event)
        textReporter.emit(event)
      },
      end(): void {
        textReporter.end()
      },
    },
  }
}

function buildRelativeArtifactPath(directory: 'consolidated' | 'evaluated', featureKey: string): string {
  return path.join('reports', 'audit-behavior', directory, `${featureKey}.json`)
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, JSON.stringify(value, null, 2) + '\n')
}

async function readEvaluatedArtifact(root: string, featureKey: string): Promise<readonly EvaluatedArtifactRecord[]> {
  const filePath = path.join(root, buildRelativeArtifactPath('evaluated', featureKey))
  const EvaluatedArtifactRecordSchema = z
    .object({
      consolidatedId: z.string(),
      maria: z.object({ discover: z.number(), use: z.number(), retain: z.number(), notes: z.string() }),
      dani: z.object({ discover: z.number(), use: z.number(), retain: z.number(), notes: z.string() }),
      viktor: z.object({ discover: z.number(), use: z.number(), retain: z.number(), notes: z.string() }),
      flaws: z.array(z.string()),
      improvements: z.array(z.string()),
      evaluatedAt: z.string(),
    })
    .readonly()
  return z.array(EvaluatedArtifactRecordSchema).parse(JSON.parse(await Bun.file(filePath).text()))
}

function createEvaluationResult(input: {
  readonly maria: NonNullable<MockEvaluationResult>['result']['maria']
  readonly dani: NonNullable<MockEvaluationResult>['result']['dani']
  readonly viktor: NonNullable<MockEvaluationResult>['result']['viktor']
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}): NonNullable<MockEvaluationResult>['result'] {
  return {
    maria: input.maria,
    dani: input.dani,
    viktor: input.viktor,
    flaws: [...input.flaws],
    improvements: [...input.improvements],
  }
}

beforeEach(() => {
  if (originalOpenAiApiKey === undefined) {
    process.env['OPENAI_API_KEY'] = 'test-openai-api-key'
    return
  }

  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  restoreOpenAiApiKey()
  cleanupTempDirs()
})

describe('behavior-audit phase 3 incremental selection', () => {
  let root: string
  let auditRoot: string
  let progressPath: string

  beforeEach(() => {
    root = makeTempDir()
    auditRoot = path.join(root, 'reports', 'audit-behavior')
    progressPath = path.join(auditRoot, 'progress.json')

    mockAuditBehaviorConfig(root, {
      PROGRESS_PATH: progressPath,
    })
  })

  test('runPhase3 writes evaluated artifacts for selected consolidated ids and preserves checkpoint-only progress', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const consolidatedManifest: ConsolidatedManifest = {
      version: 1,
      entries: {
        [selectedId]: createConsolidatedManifestEntry({
          consolidatedId: selectedId,
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
          sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey,
          consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
          evaluatedArtifactPath: null,
          keywords: ['task-create'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'phase2-fp',
          phase3Fingerprint: null,
          lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
          lastEvaluatedAt: null,
        }),
      },
    }

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest,
      },
      {
        evaluateWithRetry: () =>
          Promise.resolve({
            result: createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
              dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
              viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
              flaws: ['Selected flaw'],
              improvements: ['Selected improvement'],
            }),
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
      },
    )

    expect(progress.phase3.completedConsolidatedIds[selectedId]).toBe('done')
    expect(progress.phase3).not.toHaveProperty('evaluations')

    const evaluatedRecords = await readEvaluatedArtifact(root, featureKey)
    expect(evaluatedRecords).toHaveLength(1)
    expect(evaluatedRecords[0]).toMatchObject({
      consolidatedId: selectedId,
      maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
      dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
      viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
      flaws: ['Selected flaw'],
      improvements: ['Selected improvement'],
    })
    expect(typeof evaluatedRecords[0]?.evaluatedAt).toBe('string')
  })

  test('runPhase3 emits reporter events keyed by consolidated id and logs the consolidated item directly', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const consolidatedManifest: ConsolidatedManifest = {
      version: 1,
      entries: {
        [selectedId]: createConsolidatedManifestEntry({
          consolidatedId: selectedId,
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
          sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey,
          consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
          evaluatedArtifactPath: null,
          keywords: ['task-create'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'phase2-fp',
          phase3Fingerprint: null,
          lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
          lastEvaluatedAt: null,
        }),
      },
    }

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    const { events, lines, reporter } = createRecordingReporter()

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest,
      },
      {
        reporter,
        evaluateWithRetry: () =>
          Promise.resolve({
            result: createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
              dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
              viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
              flaws: ['Selected flaw'],
              improvements: ['Selected improvement'],
            }),
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
      },
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      kind: 'item-start',
      phase: 'phase3',
      itemId: selectedId,
      context: 'tools',
      title: 'Selected case',
      index: 1,
      total: 1,
    })
    expect(events[1]).toMatchObject({
      kind: 'item-finish',
      phase: 'phase3',
      itemId: selectedId,
      context: 'tools',
      title: 'Selected case',
      outcome: {
        kind: 'done',
        usage: {
          inputTokens: 200,
          outputTokens: 100,
          toolCalls: 2,
        },
      },
    })
    const finishEvent = expectDoneFinishEvent(events[1])
    expect(typeof finishEvent.outcome.elapsedMs).toBe('number')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[Phase 3\] \[tools\] \[1\/1\] "Selected case" — 2 tools, 300 tok in .+ ✓$/)
  })

  test('runPhase3 emits failed reporter events without split writes', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    progress.phase3.failedConsolidatedIds[selectedId] = {
      error: 'evaluation failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    const { events, lines, reporter } = createRecordingReporter()

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [selectedId]: createConsolidatedManifestEntry({
              consolidatedId: selectedId,
              domain: 'tools',
              featureName: 'Selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        reporter,
        evaluateWithRetry: () => Promise.resolve(null),
      },
    )

    expect(events).toEqual([
      {
        kind: 'item-start',
        phase: 'phase3',
        itemId: selectedId,
        context: 'tools',
        title: 'Selected case',
        index: 1,
        total: 1,
      },
      {
        kind: 'item-finish',
        phase: 'phase3',
        itemId: selectedId,
        context: 'tools',
        title: 'Selected case',
        outcome: {
          kind: 'failed',
          detail: 'evaluation failed after retries',
        },
      },
    ])
    expect(lines).toEqual(['[Phase 3] [tools] [1/1] "Selected case" — evaluation failed after retries ✗'])
    expect(progress.phase3.failedConsolidatedIds[selectedId]?.attempts).toBe(3)
  })

  test('runPhase3 emits success only after evaluated artifacts, manifest, reports, and progress are persisted', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const order: string[] = []

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    const { reporter } = createRecordingReporter((event) => {
      order.push(eventOrderLabel(event))
    })

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [selectedId]: createConsolidatedManifestEntry({
              consolidatedId: selectedId,
              domain: 'tools',
              featureName: 'Selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        reporter,
        evaluateWithRetry: () =>
          Promise.resolve({
            result: createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
              dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
              viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
              flaws: ['Selected flaw'],
              improvements: ['Selected improvement'],
            }),
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
        writeEvaluatedFile: () => {
          order.push('persist:writeEvaluatedFile')
          return Promise.resolve()
        },
        saveConsolidatedManifest: () => {
          order.push('persist:saveConsolidatedManifest')
          return Promise.resolve()
        },
        writeReports: () => {
          order.push('persist:writeReports')
          return Promise.resolve()
        },
        saveProgress: () => {
          order.push('persist:saveProgress')
          return Promise.resolve()
        },
      },
    )

    expect(order).toEqual([
      'persist:saveProgress',
      'reporter:item-start:start',
      'persist:writeEvaluatedFile',
      'persist:saveConsolidatedManifest',
      'persist:writeReports',
      'reporter:item-finish:done',
      'persist:saveProgress',
    ])
  })

  test('runPhase3 persists retry accounting before failed reporter emission', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const order: string[] = []

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    const { reporter } = createRecordingReporter((event) => {
      order.push(eventOrderLabel(event))
    })

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [selectedId]: createConsolidatedManifestEntry({
              consolidatedId: selectedId,
              domain: 'tools',
              featureName: 'Selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        reporter,
        evaluateWithRetry: () => Promise.resolve(null),
        saveConsolidatedManifest: () => {
          order.push('persist:saveConsolidatedManifest')
          return Promise.resolve()
        },
        writeReports: () => {
          order.push('persist:writeReports')
          return Promise.resolve()
        },
        saveProgress: () => {
          order.push('persist:saveProgress')
          return Promise.resolve()
        },
      },
    )

    expect(order).toEqual([
      'persist:saveProgress',
      'reporter:item-start:start',
      'persist:saveProgress',
      'reporter:item-finish:failed',
      'persist:saveConsolidatedManifest',
      'persist:writeReports',
      'persist:saveProgress',
    ])
    expect(progress.phase3.failedConsolidatedIds[selectedId]?.attempts).toBe(1)
  })

  test('runPhase3 persists evaluation artifacts instead of writing user stories into progress checkpoints', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [selectedId]: createConsolidatedManifestEntry({
              consolidatedId: selectedId,
              domain: 'tools',
              featureName: 'Selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        evaluateWithRetry: () =>
          Promise.resolve({
            result: createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
              dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
              viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
              flaws: ['Selected flaw'],
              improvements: ['Selected improvement'],
            }),
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
      },
    )

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).not.toContain('As a user, I get the selected behavior outcome.')
  })

  test('runPhase3 evaluates newly generated consolidated ids even when selection was based on stale ids', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const staleSelectedId = 'task-creation::old-selected-case'
    const freshSelectedId = 'task-creation::fresh-selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: freshSelectedId,
        domain: 'tools',
        featureName: 'Fresh selected case',
        isUserFacing: true,
        behavior: 'When the fresh behavior runs, the bot returns the regenerated output.',
        userStory: 'As a user, I get the regenerated selected behavior outcome.',
        context: 'Fresh context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([staleSelectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [freshSelectedId]: createConsolidatedManifestEntry({
              consolidatedId: freshSelectedId,
              domain: 'tools',
              featureName: 'Fresh selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        evaluateWithRetry: () =>
          Promise.resolve({
            result: createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Fresh Maria notes' },
              dani: { discover: 4, use: 4, retain: 4, notes: 'Fresh Dani notes' },
              viktor: { discover: 4, use: 4, retain: 4, notes: 'Fresh Viktor notes' },
              flaws: ['Fresh flaw'],
              improvements: ['Fresh improvement'],
            }),
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
      },
    )

    expect(progress.phase3.completedConsolidatedIds[freshSelectedId]).toBe('done')
    const evaluatedRecords = await readEvaluatedArtifact(root, featureKey)
    expect(evaluatedRecords[0]?.consolidatedId).toBe(freshSelectedId)
  })

  test('runPhase3 limits stale selected ids to the dirty feature set after reconsolidation', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const staleSelectedId = 'task-creation::old-selected-case'
    const freshSelectedId = 'task-creation::fresh-selected-case'
    const unrelatedId = 'group-routing::stable-case'
    const progress = createEmptyProgressFixture(2)
    const calls: string[] = []

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', 'task-creation')), [
      {
        id: freshSelectedId,
        domain: 'tools',
        featureName: 'Fresh selected case',
        isUserFacing: true,
        behavior: 'When the fresh behavior runs, the bot returns the regenerated output.',
        userStory: 'As a user, I get the regenerated selected behavior outcome.',
        context: 'Fresh context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])
    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', 'group-routing')), [
      {
        id: unrelatedId,
        domain: 'tools',
        featureName: 'Unrelated stable case',
        isUserFacing: true,
        behavior: 'When the unrelated behavior runs, the bot returns the stable output.',
        userStory: 'As a user, I get the unrelated stable behavior outcome.',
        context: 'Unrelated context for phase 3.',
        sourceTestKeys: ['tests/tools/group.test.ts::suite > stable case'],
        sourceBehaviorIds: ['tests/tools/group.test.ts::suite > stable case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([staleSelectedId]),
        selectedFeatureKeys: new Set(['task-creation']),
        consolidatedManifest: {
          version: 1,
          entries: {
            [freshSelectedId]: createConsolidatedManifestEntry({
              consolidatedId: freshSelectedId,
              domain: 'tools',
              featureName: 'Fresh selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey: 'task-creation',
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', 'task-creation'),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
            [unrelatedId]: createConsolidatedManifestEntry({
              consolidatedId: unrelatedId,
              domain: 'tools',
              featureName: 'Unrelated stable case',
              sourceTestKeys: ['tests/tools/group.test.ts::suite > stable case'],
              sourceBehaviorIds: ['tests/tools/group.test.ts::suite > stable case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey: 'group-routing',
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', 'group-routing'),
              evaluatedArtifactPath: null,
              keywords: ['group-route'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp-unrelated',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        evaluateWithRetry: (prompt) => {
          calls.push(prompt)
          return Promise.resolve({
            result: createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Scoped Maria notes' },
              dani: { discover: 4, use: 4, retain: 4, notes: 'Scoped Dani notes' },
              viktor: { discover: 4, use: 4, retain: 4, notes: 'Scoped Viktor notes' },
              flaws: ['Scoped flaw'],
              improvements: ['Scoped improvement'],
            }),
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          })
        },
      },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('Fresh selected case')
    expect(calls[0]).not.toContain('Unrelated stable case')
    expect(progress.phase3.completedConsolidatedIds[freshSelectedId]).toBe('done')
    expect(progress.phase3.completedConsolidatedIds[unrelatedId]).toBeUndefined()

    const selectedFeatureRecords = await readEvaluatedArtifact(root, 'task-creation')
    expect(selectedFeatureRecords).toHaveLength(1)
    expect(selectedFeatureRecords[0]?.consolidatedId).toBe(freshSelectedId)
    const unrelatedFeatureArtifact = Bun.file(path.join(root, buildRelativeArtifactPath('evaluated', 'group-routing')))
    expect(await unrelatedFeatureArtifact.exists()).toBe(false)
  })
})

describe('behavior-audit later phase reporter output', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
    mockAuditBehaviorConfig(root, null)
  })

  test('runPhase2a emits reporter events keyed by behavior id with context and title and preserves reused and failed outcomes', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const testFilePath = 'tests/tools/sample.test.ts'
    const testKey = 'tests/tools/sample.test.ts::suite > selected case'
    const canonicalBehaviorId = 'behavior-task-creation-selected-case'
    const manifest = {
      version: 1 as const,
      lastStartCommit: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > selected case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2aFingerprint: buildPhase2Fingerprint({
            testKey,
            behavior: 'When the user creates a task, the bot saves it.',
            context: 'Calls create_task and returns the new task.',
            keywords: ['task-create'],
            phaseVersion: 'phase2-v1',
          }),
          phase2Fingerprint: null,
          behaviorId: canonicalBehaviorId,
          extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }

    const entry = {
      testKey,
      behavior: {
        behaviorId: canonicalBehaviorId,
        testKey,
        testFile: testFilePath,
        domain: 'tools',
        testName: 'selected case',
        fullPath: 'suite > selected case',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
        extractedAt: '2026-04-21T12:00:00.000Z',
        behaviorEvidence: [],
        contextEvidence: [],
        keywordEvidence: [],
        confidence: { behavior: 'low', context: 'low', keywords: 'low', overall: 'low' },
        trustFlags: [],
        provenance: {
          promptVersion: 'test',
          verifierVersion: 'test',
          evidenceFilesRead: [],
          dependencyPaths: [],
          codeindex: { enabled: false, mode: 'unavailable', indexStatus: 'unknown', queries: [] },
        },
        verification: {
          behaviorVerdict: 'not-verified',
          contextVerdict: 'not-verified',
          keywordVerdict: 'not-verified',
          notes: [],
        },
      },
    }

    const reusedProgress = createEmptyProgressFixture(1)
    reusedProgress.phase2a.completedBehaviors[testKey] = 'done'
    const reusedReporter = createRecordingReporter()

    await classify.runPhase2a(
      {
        progress: reusedProgress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      {
        reporter: reusedReporter.reporter,
        readExtractedFile: () => Promise.resolve([entry.behavior]),
        readClassifiedFile: () => Promise.resolve(null),
        writeClassifiedFile: () => Promise.resolve(),
        saveManifest: () => Promise.resolve(),
        saveProgress: () => Promise.resolve(),
      },
    )

    expect(reusedReporter.events).toEqual([
      {
        kind: 'item-start',
        phase: 'phase2a',
        itemId: canonicalBehaviorId,
        context: 'Calls create_task and returns the new task.',
        title: 'suite > selected case',
        index: 1,
        total: 1,
      },
      {
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: canonicalBehaviorId,
        context: 'Calls create_task and returns the new task.',
        title: 'suite > selected case',
        outcome: {
          kind: 'reused',
          detail: 'already classified',
        },
      },
    ])
    expect(reusedReporter.lines).toEqual([
      '[Phase 2a] [Calls create_task and returns the new task.] [1/1] "suite > selected case" — already classified (reused)',
    ])

    const failedReporter = createRecordingReporter()

    await classify.runPhase2a(
      {
        progress: createEmptyProgressFixture(1),
        selectedTestKeys: new Set([testKey]),
        manifest: {
          ...manifest,
          tests: {
            [testKey]: createManifestTestEntry({
              testFile: testFilePath,
              testName: 'suite > selected case',
              dependencyPaths: [testFilePath],
              phase1Fingerprint: 'phase1-fp',
              phase2aFingerprint: null,
              phase2Fingerprint: null,
              behaviorId: canonicalBehaviorId,
              extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
              classifiedArtifactPath: null,
              domain: 'tools',
              lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
              lastPhase2CompletedAt: null,
            }),
          },
        },
      },
      {
        reporter: failedReporter.reporter,
        classifyBehaviorWithRetry: () => Promise.resolve(null),
        readExtractedFile: () => Promise.resolve([entry.behavior]),
        readClassifiedFile: () => Promise.resolve(null),
        writeClassifiedFile: () => Promise.resolve(),
        saveManifest: () => Promise.resolve(),
        saveProgress: () => Promise.resolve(),
      },
    )

    expect(failedReporter.events).toEqual([
      {
        kind: 'item-start',
        phase: 'phase2a',
        itemId: canonicalBehaviorId,
        context: 'Calls create_task and returns the new task.',
        title: 'suite > selected case',
        index: 1,
        total: 1,
      },
      {
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: canonicalBehaviorId,
        context: 'Calls create_task and returns the new task.',
        title: 'suite > selected case',
        outcome: {
          kind: 'failed',
          detail: 'classification failed after retries',
        },
      },
    ])
    expect(failedReporter.lines).toEqual([
      '[Phase 2a] [Calls create_task and returns the new task.] [1/1] "suite > selected case" — classification failed after retries ✗',
    ])
  })

  test('runPhase2b emits reporter events keyed by feature key and preserves skipped outcomes', async () => {
    const consolidate = await loadConsolidateModule(crypto.randomUUID())
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const reporter = createRecordingReporter()
    progress.phase2b.failedFeatureKeys[featureKey] = {
      error: 'consolidation failed after retries',
      attempts: 3,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await consolidate.runPhase2b(
      progress,
      { version: 1, entries: {} },
      'phase2-v1',
      new Set([featureKey]),
      {
        version: 1,
        lastStartCommit: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
        tests: {
          'tests/tools/sample.test.ts::suite > selected case': createManifestTestEntry({
            testFile: 'tests/tools/sample.test.ts',
            testName: 'suite > selected case',
            dependencyPaths: ['tests/tools/sample.test.ts'],
            phase1Fingerprint: 'phase1-fp',
            phase2aFingerprint: 'phase2a-fp',
            phase2Fingerprint: null,
            behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
            featureKey,
            extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
            classifiedArtifactPath: 'reports/audit-behavior/classified/tools/sample.test.json',
            domain: 'tools',
            lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
            lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
            lastPhase2CompletedAt: null,
          }),
        },
      },
      {
        reporter: reporter.reporter,
        readExtractedFile: () =>
          Promise.resolve([
            {
              behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
              testKey: 'tests/tools/sample.test.ts::suite > selected case',
              testFile: 'tests/tools/sample.test.ts',
              domain: 'tools',
              testName: 'selected case',
              fullPath: 'suite > selected case',
              behavior: 'When the user creates a task, the bot saves it.',
              context: 'Calls create_task and returns the new task.',
              keywords: ['task-create'],
              extractedAt: '2026-04-21T12:00:00.000Z',
              behaviorEvidence: [],
              contextEvidence: [],
              keywordEvidence: [],
              confidence: { behavior: 'low', context: 'low', keywords: 'low', overall: 'low' },
              trustFlags: [],
              provenance: {
                promptVersion: 'test',
                verifierVersion: 'test',
                evidenceFilesRead: [],
                dependencyPaths: [],
                codeindex: { enabled: false, mode: 'unavailable', indexStatus: 'unknown', queries: [] },
              },
              verification: {
                behaviorVerdict: 'not-verified',
                contextVerdict: 'not-verified',
                keywordVerdict: 'not-verified',
                notes: [],
              },
            },
          ]),
        readClassifiedFile: () =>
          Promise.resolve([
            {
              behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
              testKey: 'tests/tools/sample.test.ts::suite > selected case',
              domain: 'tools',
              visibility: 'user-facing',
              featureKey,
              featureLabel: 'Task creation',
              supportingBehaviorRefs: [],
              relatedBehaviorHints: [],
              classificationNotes: 'Matches task creation flow.',
              classifiedAt: '2026-04-21T12:05:00.000Z',
            },
          ]),
        writeConsolidatedFile: () => Promise.resolve(),
      },
    )

    expect(reporter.events).toEqual([
      {
        kind: 'item-start',
        phase: 'phase2b',
        itemId: featureKey,
        context: featureKey,
        title: featureKey,
        index: 1,
        total: 1,
      },
      {
        kind: 'item-finish',
        phase: 'phase2b',
        itemId: featureKey,
        context: featureKey,
        title: featureKey,
        outcome: {
          kind: 'skipped',
          detail: 'max retries reached',
        },
      },
    ])
    expect(reporter.lines).toEqual(['[Phase 2b] [task-creation] [1/1] "task-creation" — max retries reached (skipped)'])
  })

  test('runPhase2b emits success only after phase-owned persistence completes', async () => {
    const consolidate = await loadConsolidateModule(crypto.randomUUID())
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const order: string[] = []
    const { reporter } = createRecordingReporter((event) => {
      order.push(eventOrderLabel(event))
    })

    await consolidate.runPhase2b(
      progress,
      { version: 1, entries: {} },
      'phase2-v1',
      new Set([featureKey]),
      {
        version: 1,
        lastStartCommit: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
        tests: {
          'tests/tools/sample.test.ts::suite > selected case': createManifestTestEntry({
            testFile: 'tests/tools/sample.test.ts',
            testName: 'suite > selected case',
            dependencyPaths: ['tests/tools/sample.test.ts'],
            phase1Fingerprint: 'phase1-fp',
            phase2aFingerprint: 'phase2a-fp',
            phase2Fingerprint: null,
            behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
            featureKey,
            extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
            classifiedArtifactPath: 'reports/audit-behavior/classified/tools/sample.test.json',
            domain: 'tools',
            lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
            lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
            lastPhase2CompletedAt: null,
          }),
        },
      },
      {
        reporter,
        readExtractedFile: () =>
          Promise.resolve([
            {
              behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
              testKey: 'tests/tools/sample.test.ts::suite > selected case',
              testFile: 'tests/tools/sample.test.ts',
              domain: 'tools',
              testName: 'selected case',
              fullPath: 'suite > selected case',
              behavior: 'When the user creates a task, the bot saves it.',
              context: 'Calls create_task and returns the new task.',
              keywords: ['task-create'],
              extractedAt: '2026-04-21T12:00:00.000Z',
              behaviorEvidence: [],
              contextEvidence: [],
              keywordEvidence: [],
              confidence: { behavior: 'low', context: 'low', keywords: 'low', overall: 'low' },
              trustFlags: [],
              provenance: {
                promptVersion: 'test',
                verifierVersion: 'test',
                evidenceFilesRead: [],
                dependencyPaths: [],
                codeindex: { enabled: false, mode: 'unavailable', indexStatus: 'unknown', queries: [] },
              },
              verification: {
                behaviorVerdict: 'not-verified',
                contextVerdict: 'not-verified',
                keywordVerdict: 'not-verified',
                notes: [],
              },
            },
          ]),
        readClassifiedFile: () =>
          Promise.resolve([
            {
              behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
              testKey: 'tests/tools/sample.test.ts::suite > selected case',
              domain: 'tools',
              visibility: 'user-facing',
              featureKey,
              featureLabel: 'Task creation',
              supportingBehaviorRefs: [],
              relatedBehaviorHints: [],
              classificationNotes: 'Matches task creation flow.',
              classifiedAt: '2026-04-21T12:05:00.000Z',
            },
          ]),
        consolidateWithRetry: () =>
          Promise.resolve({
            result: [
              {
                id: `${featureKey}::feature`,
                item: {
                  featureName: 'Task creation',
                  isUserFacing: true,
                  behavior: 'When the user creates a task, the bot saves it.',
                  userStory: 'As a user, I can create a task.',
                  context: 'Calls create_task and returns the new task.',
                  sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
                  sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
                  supportingInternalRefs: [],
                },
              },
            ],
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
        writeConsolidatedFile: () => {
          order.push('persist:writeConsolidatedFile')
          return Promise.resolve()
        },
        saveProgress: () => {
          order.push('persist:saveProgress')
          return Promise.resolve()
        },
      },
    )

    expect(order).toEqual([
      'persist:saveProgress',
      'reporter:item-start:start',
      'persist:writeConsolidatedFile',
      'persist:saveProgress',
      'reporter:item-finish:done',
      'persist:saveProgress',
    ])
  })

  test('runPhase2b preserves phase3 retry history while invalidating phase3 for reevaluation', async () => {
    const consolidate = await loadConsolidateModule(crypto.randomUUID())
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const featureKey = 'task-creation'
    const consolidatedId = `${featureKey}::selected-case`
    const progress = createEmptyProgressFixture(1)
    progress.phase3.status = 'done'
    progress.phase3.failedConsolidatedIds[consolidatedId] = {
      error: 'evaluation failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }
    progress.phase3.stats.consolidatedIdsFailed = 1

    const consolidatedManifest = await consolidate.runPhase2b(
      progress,
      { version: 1, entries: {} },
      'phase2-v1',
      new Set([featureKey]),
      {
        version: 1,
        lastStartCommit: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
        tests: {
          'tests/tools/sample.test.ts::suite > selected case': createManifestTestEntry({
            testFile: 'tests/tools/sample.test.ts',
            testName: 'suite > selected case',
            dependencyPaths: ['tests/tools/sample.test.ts'],
            phase1Fingerprint: 'phase1-fp',
            phase2aFingerprint: 'phase2a-fp',
            phase2Fingerprint: null,
            behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
            featureKey,
            extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
            classifiedArtifactPath: 'reports/audit-behavior/classified/tools/sample.test.json',
            domain: 'tools',
            lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
            lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
            lastPhase2CompletedAt: null,
          }),
        },
      },
      {
        readExtractedFile: () =>
          Promise.resolve([
            {
              behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
              testKey: 'tests/tools/sample.test.ts::suite > selected case',
              testFile: 'tests/tools/sample.test.ts',
              domain: 'tools',
              testName: 'selected case',
              fullPath: 'suite > selected case',
              behavior: 'When the user creates a task, the bot saves it.',
              context: 'Calls create_task and returns the new task.',
              keywords: ['task-create'],
              extractedAt: '2026-04-21T12:00:00.000Z',
              behaviorEvidence: [],
              contextEvidence: [],
              keywordEvidence: [],
              confidence: { behavior: 'low', context: 'low', keywords: 'low', overall: 'low' },
              trustFlags: [],
              provenance: {
                promptVersion: 'test',
                verifierVersion: 'test',
                evidenceFilesRead: [],
                dependencyPaths: [],
                codeindex: { enabled: false, mode: 'unavailable', indexStatus: 'unknown', queries: [] },
              },
              verification: {
                behaviorVerdict: 'not-verified',
                contextVerdict: 'not-verified',
                keywordVerdict: 'not-verified',
                notes: [],
              },
            },
          ]),
        readClassifiedFile: () =>
          Promise.resolve([
            {
              behaviorId: 'tests/tools/sample.test.ts::suite > selected case',
              testKey: 'tests/tools/sample.test.ts::suite > selected case',
              domain: 'tools',
              visibility: 'user-facing',
              featureKey,
              featureLabel: 'Task creation',
              supportingBehaviorRefs: [],
              relatedBehaviorHints: [],
              classificationNotes: 'Matches task creation flow.',
              classifiedAt: '2026-04-21T12:05:00.000Z',
            },
          ]),
        consolidateWithRetry: () =>
          Promise.resolve({
            result: [
              {
                id: consolidatedId,
                item: {
                  featureName: 'Task creation',
                  isUserFacing: true,
                  behavior: 'When the user creates a task, the bot saves it.',
                  userStory: 'As a user, I can create a task.',
                  context: 'Calls create_task and returns the new task.',
                  sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
                  sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
                  supportingInternalRefs: [],
                },
              },
            ],
            usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
        writeConsolidatedFile: (key, records) =>
          writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', key)), records),
      },
    )

    expect(progress.phase3.status as string).toBe('not-started')
    expect(progress.phase3.failedConsolidatedIds[consolidatedId]?.attempts).toBe(2)

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set(),
        selectedFeatureKeys: new Set([featureKey]),
        consolidatedManifest,
      },
      {
        evaluateWithRetry: () => Promise.resolve(null),
        saveConsolidatedManifest: () => Promise.resolve(),
        writeReports: () => Promise.resolve(),
      },
    )

    expect(progress.phase3.failedConsolidatedIds[consolidatedId]?.attempts).toBe(3)
  })
})

test('runPhase3 reads consolidated artifacts using feature keys from manifest entries', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  const featureKey = 'group-targeting'
  const consolidatedId = 'group-targeting::feature'
  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
    {
      id: consolidatedId,
      domain: 'cross-domain',
      featureName: 'Shared group targeting',
      isUserFacing: true,
      behavior: 'When a user targets a group, the bot routes the request correctly.',
      userStory: 'As a user, I can target a group.',
      context: 'Routes through group context selection.',
      sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
      sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
      supportingInternalRefs: [],
    } satisfies ConsolidatedArtifactRecord,
  ])

  const evaluate = await loadEvaluateModule(`phase3-keyword-files-${crypto.randomUUID()}`)
  const progress = createEmptyProgressFixture(1)
  const consolidatedManifest: ConsolidatedManifest = {
    version: 1,
    entries: {
      [consolidatedId]: createConsolidatedManifestEntry({
        consolidatedId,
        domain: 'cross-domain',
        featureName: 'Shared group targeting',
        sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
        sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey,
        consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
        evaluatedArtifactPath: null,
        keywords: ['group-targeting', 'shared-feature'],
        sourceDomains: ['commands', 'tools'],
        phase2Fingerprint: 'phase2-fp',
        phase3Fingerprint: null,
        lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
        lastEvaluatedAt: null,
      }),
    },
  }

  await evaluate.runPhase3(
    {
      progress,
      selectedConsolidatedIds: new Set(),
      consolidatedManifest,
    },
    {
      evaluateWithRetry: () =>
        Promise.resolve({
          result: createEvaluationResult({
            maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            dani: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            viktor: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            flaws: [],
            improvements: [],
          }),
          usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        }),
    },
  )

  expect(progress.phase3.stats.consolidatedIdsTotal).toBe(1)
  expect(progress.phase3.stats.consolidatedIdsDone).toBe(1)
  expect((await readEvaluatedArtifact(root, featureKey))[0]?.consolidatedId).toBe(consolidatedId)
})

describe('behavior-audit entrypoint phase3 manifest passthrough', () => {
  test('main passes the consolidated manifest through to phase3 after phase2 completes', async () => {
    const consolidatedManifest = {
      version: 1 as const,
      entries: {
        'tools::selected-case': createConsolidatedManifestEntry({
          consolidatedId: 'tools::selected-case',
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > first case'],
          sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > first case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey: 'group-targeting',
          consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', 'group-targeting'),
          evaluatedArtifactPath: buildRelativeArtifactPath('evaluated', 'group-targeting'),
          keywords: ['group-targeting'] as readonly string[],
          sourceDomains: ['tools'] as readonly string[],
          phase2Fingerprint: 'phase2-fp' as string | null,
          phase3Fingerprint: 'phase3-fp' as string | null,
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z' as string | null,
          lastEvaluatedAt: '2026-04-20T12:30:00.000Z' as string | null,
        }),
      },
    }

    let phase3ManifestArg: ConsolidatedManifest | null = null

    const deps: BehaviorAuditDeps = {
      requireOpenAiApiKey: () => {},
      prepareIncrementalRun: () =>
        Promise.resolve({
          previousManifest: createIncrementalManifestFixture({
            phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
            tests: {},
          }),
          previousLastStartCommit: null,
          updatedManifest: createIncrementalManifestFixture({
            phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
            tests: {},
          }),
        }),
      selectIncrementalRunWork: () =>
        Promise.resolve({
          parsedFiles: [],
          previousConsolidatedManifest: null,
          selection: {
            phase1SelectedTestKeys: [],
            phase2aSelectedTestKeys: [],
            phase2bSelectedFeatureKeys: ['group-targeting'],
            phase3SelectedConsolidatedIds: [],
            reportRebuildOnly: false,
          } satisfies IncrementalSelection,
        }),
      loadOrCreateProgress: () => Promise.resolve(createEmptyProgressFixture(0)),
      createProgressReporter: () => createNoopProgressReporter(),
      rebuildReportsFromStoredResults: () => Promise.resolve(),
      runPhase1IfNeeded: () => Promise.resolve(),
      runPhase1bIfNeeded: () => Promise.resolve(),
      runPhase2aIfNeeded: () => Promise.resolve(new Set(['group-targeting'])),
      runPhase2bIfNeeded: () => Promise.resolve(consolidatedManifest),
      saveConsolidatedManifest: () => Promise.resolve(),
      runPhase3IfNeeded: (_progress, _selectedConsolidatedIds, _selectedFeatureKeys, manifest) => {
        phase3ManifestArg = manifest
        return Promise.resolve()
      },
      stdout: { isTTY: false },
      isTestEnvironment: true,
      log: { log: mock(() => {}) },
    }

    await runBehaviorAudit(deps)

    expect(phase3ManifestArg).not.toBeNull()
    expect(phase3ManifestArg).toMatchObject(consolidatedManifest)
  })
})

test('writeReports aggregates story output from canonical feature-key maps', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  await writeReports({
    consolidatedByFeatureKey: new Map([
      [
        'task-creation',
        [
          {
            id: 'task-creation::feature',
            domain: 'tools',
            featureName: 'Task creation',
            isUserFacing: true,
            behavior: 'Creates a task from chat.',
            userStory: 'As a user, I can create a task.',
            context: 'Task creation context.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > create task'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > create task'],
            supportingInternalRefs: [],
          },
        ],
      ],
    ]),
    evaluatedByFeatureKey: new Map([
      [
        'task-creation',
        [
          {
            consolidatedId: 'task-creation::feature',
            maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            dani: { discover: 3, use: 4, retain: 3, notes: 'usable' },
            viktor: { discover: 2, use: 3, retain: 2, notes: 'needs polish' },
            flaws: ['Missing shortcut'],
            improvements: ['Add shortcut'],
            evaluatedAt: '2026-04-23T12:00:00.000Z',
          },
        ],
      ],
    ]),
    progress: {
      ...createEmptyProgressFixture(0),
      phase3: {
        ...createEmptyProgressFixture(0).phase3,
        status: 'done',
        stats: { consolidatedIdsTotal: 1, consolidatedIdsDone: 1, consolidatedIdsFailed: 0 },
      },
    },
  })

  const storyMarkdown = await Bun.file(path.join(root, 'reports', 'audit-behavior', 'stories', 'tools.md')).text()
  const indexMarkdown = await Bun.file(path.join(root, 'reports', 'audit-behavior', 'stories', 'index.md')).text()

  expect(storyMarkdown).toContain('As a user, I can create a task.')
  expect(storyMarkdown).toContain('Missing shortcut')
  expect(indexMarkdown).toContain('Add shortcut')
})

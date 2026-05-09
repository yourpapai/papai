import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { Phase2aDeps } from '../../../scripts/behavior-audit/classify.js'
import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import type { ExtractedBehaviorRecord } from '../../../scripts/behavior-audit/extracted-store.js'
import type { IncrementalManifest } from '../../../scripts/behavior-audit/incremental.js'
import {
  createAuditBehaviorPaths,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
} from '../behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from '../behavior-audit-integration.runtime-helpers.js'
import {
  getManifestEntry,
  importWithGuard,
  isClassifyModule,
  loadClassifiedStoreModule,
  loadIncrementalModule,
  loadProgressModule,
  readSavedManifest,
} from '../behavior-audit-integration.support.js'
import { makeExtractedRecord } from './test-fixtures.js'

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

describe('behavior-audit phase 2a classification', () => {
  let root: string
  let progressPath: string
  let manifestPath: string
  let classifyBehaviorWithRetryCalls: number
  let classifyBehaviorWithRetryImpl: Phase2aDeps['classifyBehaviorWithRetry']
  let classifiedStoreTag: string

  beforeEach(() => {
    root = makeTempDir()
    const paths = createAuditBehaviorPaths(root)
    progressPath = paths.progressPath
    manifestPath = paths.incrementalManifestPath
    classifyBehaviorWithRetryCalls = 0
    classifiedStoreTag = crypto.randomUUID()
    const defaultImpl: Phase2aDeps['classifyBehaviorWithRetry'] = (_prompt, _attempt) =>
      Promise.resolve({
        result: {
          visibility: 'user-facing',
          featureKey: 'task-creation',
          featureLabel: 'Task creation',
          supportingBehaviorRefs: [],
          relatedBehaviorHints: [],
          classificationNotes: 'Matches task creation flow.',
        },
        usage: { inputTokens: 100, outputTokens: 50, toolCalls: 1, toolNames: ['readFile'] },
      })
    classifyBehaviorWithRetryImpl = defaultImpl

    mockAuditBehaviorConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      EXCLUDED_PREFIXES: [] as const,
    })
  })

  function createPhase2aDeps(): Pick<Phase2aDeps, 'classifyBehaviorWithRetry'> {
    return {
      classifyBehaviorWithRetry: (prompt: string, attemptOffset: number) => {
        classifyBehaviorWithRetryCalls += 1
        return classifyBehaviorWithRetryImpl(prompt, attemptOffset)
      },
    }
  }

  type ClassifiedArtifactRecord = {
    readonly behaviorId: string
    readonly testKey: string
    readonly domain: string
    readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
    readonly featureKey: string | null
    readonly featureLabel: string | null
    readonly supportingBehaviorRefs: readonly { readonly behaviorId: string; readonly reason: string }[]
    readonly relatedBehaviorHints: readonly {
      readonly testKey: string
      readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
      readonly reason: string
    }[]
    readonly classificationNotes: string
    readonly classifiedAt: string
  }

  function buildRelativeArtifactPath(directory: 'extracted' | 'classified', testFilePath: string): string {
    const domain = testFilePath.split('/')[1]
    const fileName = path.basename(testFilePath).replace('.test.ts', '.test.json')
    return path.join('reports', 'audit-behavior', directory, domain ?? 'tools', fileName)
  }

  function buildAbsoluteArtifactPath(directory: 'extracted' | 'classified', testFilePath: string): string {
    return path.join(root, buildRelativeArtifactPath(directory, testFilePath))
  }

  function createExtractedRecord(input: {
    readonly testKey: string
    readonly testFile: string
    readonly testName: string
    readonly fullPath: string
    readonly behavior: string
    readonly context: string
    readonly keywords: readonly string[]
  }): ExtractedBehaviorRecord {
    return makeExtractedRecord({
      behaviorId: input.testKey,
      testKey: input.testKey,
      testFile: input.testFile,
      domain: input.testFile.split('/')[1] ?? 'tools',
      testName: input.testName,
      fullPath: input.fullPath,
      behavior: input.behavior,
      context: input.context,
      keywords: input.keywords,
    })
  }

  async function writeExtractedArtifact(
    testFilePath: string,
    records: readonly ExtractedBehaviorRecord[],
  ): Promise<void> {
    const filePath = buildAbsoluteArtifactPath('extracted', testFilePath)
    mkdirSync(path.dirname(filePath), { recursive: true })
    await Bun.write(filePath, JSON.stringify(records, null, 2) + '\n')
  }

  async function writeClassifiedArtifact(
    testFilePath: string,
    records: readonly ClassifiedArtifactRecord[],
  ): Promise<void> {
    const filePath = buildAbsoluteArtifactPath('classified', testFilePath)
    mkdirSync(path.dirname(filePath), { recursive: true })
    await Bun.write(filePath, JSON.stringify(records, null, 2) + '\n')
  }

  async function readClassifiedArtifact(testFilePath: string): Promise<unknown> {
    return JSON.parse(await Bun.file(buildAbsoluteArtifactPath('classified', testFilePath)).text())
  }

  async function readTypedClassifiedArtifact(testFilePath: string): Promise<readonly ClassifiedArtifactRecord[]> {
    const store = await loadClassifiedStoreModule(classifiedStoreTag)
    const records = await store.readClassifiedFile(testFilePath)
    if (records === null) {
      throw new Error(`Expected classified artifact for ${testFilePath}`)
    }
    return records
  }

  function expectClassifiedTimestamp(value: unknown): void {
    expect(typeof value).toBe('string')
  }

  test('runPhase2a classifies selected extracted behaviors and returns dirty candidate feature keys', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())

    const testFilePath = 'tests/tools/sample.test.ts'
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'stale-phase2-fp',
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'case',
        fullPath: 'suite > case',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
      }),
    ])

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect([...dirty]).toEqual(['task-creation'])
    expect(progress.phase2a.completedBehaviors[testKey]).toBe('done')
    expect(progress.phase2a).not.toHaveProperty('classifiedBehaviors')

    const classifiedPath = buildAbsoluteArtifactPath('classified', testFilePath)
    expect(await Bun.file(classifiedPath).exists()).toBe(true)

    const classifiedList = await readTypedClassifiedArtifact(testFilePath)
    expect(classifiedList).toHaveLength(1)
    const classifiedEntry = classifiedList[0]
    assert(classifiedEntry !== undefined, 'Expected classified artifact entry')
    expect(classifiedEntry.behaviorId).toBe(testKey)
    expect(classifiedEntry.testKey).toBe(testKey)
    expect(classifiedEntry.domain).toBe('tools')
    expect(classifiedEntry.visibility).toBe('user-facing')
    expect(classifiedEntry.featureKey).toBe('task-creation')
    expect(classifiedEntry.featureLabel).toBe('Task creation')
    expect(classifiedEntry.supportingBehaviorRefs).toEqual([])
    expect(classifiedEntry.relatedBehaviorHints).toEqual([])
    expect(classifiedEntry.classificationNotes).toBe('Matches task creation flow.')
    expectClassifiedTimestamp(classifiedEntry.classifiedAt)

    const savedEntry = getManifestEntry(await readSavedManifest(manifestPath), testKey)
    expect(savedEntry.behaviorId).toBe(testKey)
    expect(savedEntry.featureKey).toBe('task-creation')
    expect(savedEntry.classifiedArtifactPath).toBe(buildRelativeArtifactPath('classified', testFilePath))
    expect(savedEntry.phase2aFingerprint).toBeTruthy()
    expect(savedEntry.phase2Fingerprint).toBe('stale-phase2-fp')
    expect(savedEntry.lastPhase2aCompletedAt).toBeTruthy()
    expect(savedEntry.lastPhase2CompletedAt).toBeNull()
  })

  test('runPhase2a skips already-completed classifications on resumed runs', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const testFilePath = 'tests/tools/sample.test.ts'
    const existingClassified = {
      behaviorId: testKey,
      testKey,
      domain: 'tools',
      visibility: 'user-facing' as const,
      featureKey: 'task-creation',
      featureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'Persisted from a prior run.',
      classifiedAt: '2026-04-21T12:05:00.000Z',
    }

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2aFingerprint: incremental.buildPhase2Fingerprint({
            testKey,
            behavior: 'When the user creates a task, the bot saves it.',
            context: 'Calls create_task and returns the new task.',
            keywords: ['task-create'],
            phaseVersion: 'phase2-v1',
          }),
          phase2Fingerprint: 'phase2-fp',
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: buildRelativeArtifactPath('classified', testFilePath),
          domain: 'tools',
          behaviorId: testKey,
          featureKey: 'task-creation',
          lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: '2026-04-21T12:05:00.000Z',
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'case',
        fullPath: 'suite > case',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
      }),
    ])
    await writeClassifiedArtifact(testFilePath, [existingClassified])
    progress.phase2a.completedBehaviors[testKey] = 'done'

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(0)
    expect([...dirty]).toEqual(['task-creation'])
    expect(await readClassifiedArtifact(testFilePath)).toEqual([existingClassified])
  })

  test('runPhase2a reruns explicitly selected completed classifications when stored phase2a metadata is stale', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const testFilePath = 'tests/tools/sample.test.ts'

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v2', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2aFingerprint: 'stale-phase2a-fp',
          phase2Fingerprint: 'phase2-fp',
          behaviorId: testKey,
          featureKey: 'task-creation',
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: buildRelativeArtifactPath('classified', testFilePath),
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
          lastPhase2CompletedAt: '2026-04-21T12:05:00.000Z',
        }),
      },
    }

    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'case',
        fullPath: 'suite > case',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
      }),
    ])
    progress.phase2a.completedBehaviors[testKey] = 'done'
    await writeClassifiedArtifact(testFilePath, [
      {
        behaviorId: testKey,
        testKey,
        domain: 'tools',
        visibility: 'internal',
        featureKey: 'task-creation',
        featureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Stale prior classification.',
        classifiedAt: '2026-04-21T12:05:00.000Z',
      },
    ])

    classifyBehaviorWithRetryImpl = (_prompt, _attempt): ReturnType<Phase2aDeps['classifyBehaviorWithRetry']> =>
      Promise.resolve({
        result: {
          visibility: 'user-facing',
          featureKey: 'task-creation',
          featureLabel: 'Task creation',
          supportingBehaviorRefs: [],
          relatedBehaviorHints: [],
          classificationNotes: 'Refreshed classification.',
        },
        usage: { inputTokens: 100, outputTokens: 50, toolCalls: 1, toolNames: ['readFile'] },
      })

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    expect([...dirty]).toEqual(['task-creation'])
    expect(progress.phase2a).not.toHaveProperty('classifiedBehaviors')
    const refreshedList = await readTypedClassifiedArtifact(testFilePath)
    expect(refreshedList).toHaveLength(1)
    const refreshedEntry = refreshedList[0]
    assert(refreshedEntry !== undefined, 'Expected refreshed classified artifact entry')
    expect(refreshedEntry.behaviorId).toBe(testKey)
    expect(refreshedEntry.testKey).toBe(testKey)
    expect(refreshedEntry.domain).toBe('tools')
    expect(refreshedEntry.visibility).toBe('user-facing')
    expect(refreshedEntry.featureKey).toBe('task-creation')
    expect(refreshedEntry.featureLabel).toBe('Task creation')
    expect(refreshedEntry.supportingBehaviorRefs).toEqual([])
    expect(refreshedEntry.relatedBehaviorHints).toEqual([])
    expect(refreshedEntry.classificationNotes).toBe('Refreshed classification.')
    expectClassifiedTimestamp(refreshedEntry.classifiedAt)
  })

  test('runPhase2a passes persisted retry attempt offset through to the classifier on resumed failures', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const testFilePath = 'tests/tools/sample.test.ts'
    const classifierArgs: Array<readonly [string, number]> = []

    classifyBehaviorWithRetryImpl = (prompt, attemptOffset): ReturnType<Phase2aDeps['classifyBehaviorWithRetry']> => {
      classifierArgs.push([prompt, attemptOffset])
      return Promise.resolve({
        result: {
          visibility: 'user-facing',
          featureKey: 'task-creation',
          featureLabel: 'Task creation',
          supportingBehaviorRefs: [],
          relatedBehaviorHints: [],
          classificationNotes: 'Resumed from prior failed attempt.',
        },
        usage: { inputTokens: 100, outputTokens: 50, toolCalls: 1, toolNames: ['readFile'] },
      })
    }

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'case',
        fullPath: 'suite > case',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
      }),
    ])
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    expect(classifierArgs).toHaveLength(1)
    const classifierArgsEntry = classifierArgs[0]
    assert(classifierArgsEntry !== undefined, 'Expected classifier args entry')
    expect(classifierArgsEntry[1]).toBe(2)
  })

  test('runPhase2a clears stale phase2a failure state after a later successful classification', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > recovery case'
    const testFilePath = 'tests/tools/sample.test.ts'

    classifyBehaviorWithRetryImpl = (_prompt, _attempt): ReturnType<Phase2aDeps['classifyBehaviorWithRetry']> =>
      Promise.resolve({
        result: {
          visibility: 'user-facing',
          featureKey: 'task-recovery',
          featureLabel: 'Task recovery',
          supportingBehaviorRefs: [],
          relatedBehaviorHints: [],
          classificationNotes: 'Recovered successfully.',
        },
        usage: { inputTokens: 100, outputTokens: 50, toolCalls: 1, toolNames: ['readFile'] },
      })

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > recovery case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'recovery case',
        fullPath: 'suite > recovery case',
        behavior: 'When the user retries task creation, the bot recovers successfully.',
        context: 'Repeats the classification after a transient failure.',
        keywords: ['task-recovery'],
      }),
    ])
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 1,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }
    progress.phase2a.stats.behaviorsFailed = 1

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect([...dirty]).toEqual(['task-recovery'])
    expect(progress.phase2a.failedBehaviors[testKey]).toBeUndefined()
    expect(progress.phase2a.stats.behaviorsFailed).toBe(0)
    const recoveredList = await readTypedClassifiedArtifact(testFilePath)
    expect(recoveredList).toHaveLength(1)
    const recoveredEntry = recoveredList[0]
    assert(recoveredEntry !== undefined, 'Expected recovered classified artifact entry')
    expect(recoveredEntry.behaviorId).toBe(testKey)
    expect(recoveredEntry.testKey).toBe(testKey)
    expect(recoveredEntry.domain).toBe('tools')
    expect(recoveredEntry.visibility).toBe('user-facing')
    expect(recoveredEntry.featureKey).toBe('task-recovery')
    expect(recoveredEntry.featureLabel).toBe('Task recovery')
    expect(recoveredEntry.supportingBehaviorRefs).toEqual([])
    expect(recoveredEntry.relatedBehaviorHints).toEqual([])
    expect(recoveredEntry.classificationNotes).toBe('Recovered successfully.')
    expectClassifiedTimestamp(recoveredEntry.classifiedAt)
  })

  test('runPhase2a does not exceed total retry budget across resumed failed runs', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > exhausted retries'
    const testFilePath = 'tests/tools/sample.test.ts'

    classifyBehaviorWithRetryImpl = (): ReturnType<Phase2aDeps['classifyBehaviorWithRetry']> => Promise.resolve(null)

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > exhausted retries',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'exhausted retries',
        fullPath: 'suite > exhausted retries',
        behavior: 'When classification keeps failing, retries should stop at the total budget.',
        context: 'Exercises resume behavior after all classifier attempts are consumed.',
        keywords: ['classification-retries'],
      }),
    ])

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    const firstFailure = progress.phase2a.failedBehaviors[testKey]
    assert(firstFailure !== undefined, 'Expected failed behavior entry')
    expect(firstFailure.attempts).toBe(3)

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    const repeatedFailure = progress.phase2a.failedBehaviors[testKey]
    assert(repeatedFailure !== undefined, 'Expected repeated failed behavior entry')
    expect(repeatedFailure.attempts).toBe(3)
  })

  test('runPhase2a honors an injected total retry budget for resumed failures', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > custom retry budget'
    const testFilePath = 'tests/tools/sample.test.ts'

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > custom retry budget',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'custom retry budget',
        fullPath: 'suite > custom retry budget',
        behavior: 'When classification keeps failing, the injected retry budget caps resumed runs.',
        context: 'Exercises resume behavior after a custom retry budget is exhausted.',
        keywords: ['classification-retries'],
      }),
    ])
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      {
        ...createPhase2aDeps(),
        maxRetries: 2,
      } as Partial<Phase2aDeps>,
    )

    expect(classifyBehaviorWithRetryCalls).toBe(0)
    const repeatedFailure = progress.phase2a.failedBehaviors[testKey]
    assert(repeatedFailure !== undefined, 'Expected repeated failed behavior entry')
    expect(repeatedFailure.attempts).toBe(2)
  })

  test('runPhase2a default path reads reloaded max retry config after module import', async () => {
    process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '1'
    reloadBehaviorAuditConfig()

    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > reloaded retry budget'
    const testFilePath = 'tests/tools/sample.test.ts'

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > reloaded retry budget',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
          classifiedArtifactPath: null,
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    await writeExtractedArtifact(testFilePath, [
      createExtractedRecord({
        testKey,
        testFile: testFilePath,
        testName: 'reloaded retry budget',
        fullPath: 'suite > reloaded retry budget',
        behavior: 'When retries are disabled after import, phase 2a should short-circuit.',
        context: 'Ensures the default retry budget is read from reloaded config at call time.',
        keywords: ['classification-retries'],
      }),
    ])

    process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '0'
    reloadBehaviorAuditConfig()

    const dirty = await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set([testKey]),
      manifest,
    })

    expect([...dirty]).toEqual([])
    expect(progress.phase2a.failedBehaviors[testKey]).toBeUndefined()
  })
})

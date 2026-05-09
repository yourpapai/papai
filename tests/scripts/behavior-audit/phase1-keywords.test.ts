import { afterEach, beforeEach, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { normalizeKeywordSlug } from '../../../scripts/behavior-audit/keyword-vocabulary.js'
import { parseTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockAuditBehaviorConfig } from '../behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from '../behavior-audit-integration.runtime-helpers.js'
import {
  loadExtractModule,
  loadIncrementalModule,
  loadKeywordVocabularyModule,
} from '../behavior-audit-integration.support.js'

type ExtractResult = NonNullable<
  Awaited<ReturnType<(typeof import('../../../scripts/behavior-audit/extract-agent.js'))['extractWithRetry']>>
>

const ExtractedBehaviorRecordArraySchema = z.array(
  z.object({
    behaviorId: z.string(),
    testKey: z.string(),
    testFile: z.string(),
    domain: z.string(),
    testName: z.string(),
    fullPath: z.string(),
    behavior: z.string(),
    context: z.string(),
    keywords: z.array(z.string()).readonly(),
    extractedAt: z.string(),
    behaviorEvidence: z.array(z.unknown()).readonly(),
    contextEvidence: z.array(z.unknown()).readonly(),
    keywordEvidence: z.array(z.unknown()).readonly(),
    confidence: z.object({
      behavior: z.string(),
      context: z.string(),
      keywords: z.string(),
      overall: z.string(),
    }),
    trustFlags: z.array(z.unknown()).readonly(),
    provenance: z.object({
      promptVersion: z.string(),
      verifierVersion: z.string(),
      evidenceFilesRead: z.array(z.string()).readonly(),
      dependencyPaths: z.array(z.string()).readonly(),
      codeindex: z.object({
        enabled: z.boolean(),
        mode: z.string(),
        indexStatus: z.string(),
        queries: z.array(z.unknown()).readonly(),
      }),
    }),
    verification: z.object({
      behaviorVerdict: z.string(),
      contextVerdict: z.string(),
      keywordVerdict: z.string(),
      notes: z.array(z.string()).readonly(),
    }),
  }),
)

function createExtractResult(input: {
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}): ExtractResult['result'] {
  return {
    behavior: input.behavior,
    context: input.context,
    keywords: [...input.keywords],
    behaviorClaimRefs: [],
    contextClaimRefs: [],
    uncertaintyNotes: [],
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

test('runPhase1 stores keywords from extraction directly', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const extractedArtifactPath = path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json')

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-keywords-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-keywords-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const manifest = incremental.createEmptyManifest()
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest,
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve({
          result: createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Resolves target context and forwards execution through the group routing path.',
            keywords: ['group-routing', 'group-targeting'],
          }),
          usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        }),
    },
  )

  const extractedRecords = ExtractedBehaviorRecordArraySchema.parse(
    JSON.parse(await Bun.file(extractedArtifactPath).text()),
  )
  expect(extractedRecords).toHaveLength(1)
  const firstRecord = extractedRecords[0]
  assert(firstRecord !== undefined, 'Expected first extracted record')
  expect(firstRecord.behaviorId).toBe('tests/tools/sample.test.ts::suite > case')
  expect(firstRecord.testKey).toBe('tests/tools/sample.test.ts::suite > case')
  expect(firstRecord.testFile).toBe('tests/tools/sample.test.ts')
  expect(firstRecord.domain).toBe('tools')
  expect(firstRecord.testName).toBe('case')
  expect(firstRecord.fullPath).toBe('suite > case')
  expect(firstRecord.behavior).toBe('When a user targets a group, the bot routes the request correctly.')
  expect(firstRecord.context).toBe('Resolves target context and forwards execution through the group routing path.')
  expect(firstRecord.keywords).toEqual(['group-routing', 'group-targeting'])
  expect(typeof firstRecord.extractedAt).toBe('string')
})

test('runPhase1 fails cleanly when extracted keywords all normalize to empty slugs', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const extractedArtifactPath = path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json')

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-empty-keywords-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-empty-keywords-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve({
          result: createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            keywords: ['   ', '!!!', '---'],
          }),
          usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        }),
    },
  )

  expect(await Bun.file(extractedArtifactPath).exists()).toBe(false)
  const failedTest = progress.phase1.failedTests['tests/tools/sample.test.ts::suite > case']
  assert(failedTest !== undefined, 'Expected failedTest entry')
  assert(failedTest !== null, 'Expected failedTest entry to be non-null')
  expect(failedTest.error).toContain('keyword')
  expect(progress.phase1.completedTests['tests/tools/sample.test.ts']).toBeUndefined()
})

test('extract-agent exports extractWithRetry', async () => {
  const mod: unknown = await import(
    `../../../scripts/behavior-audit/extract-agent.js?test=shape-${crypto.randomUUID()}`
  )
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('extractWithRetry')
})

test('keyword-vocabulary normalizes duplicate slugs into canonical entries', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockAuditBehaviorConfig(root, {
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const typedVocab = await loadKeywordVocabularyModule(`vocab-${crypto.randomUUID()}`)
  await typedVocab.saveKeywordVocabulary([
    {
      slug: 'Group Targeting',
      description: 'Older description.',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z',
    },
    {
      slug: 'group-targeting',
      description: 'Newest description.',
      createdAt: '2026-04-21T12:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
    },
  ])

  const saved = await typedVocab.loadKeywordVocabulary()
  assert(saved !== null, 'Expected saved vocabulary entries')
  const firstSavedEntry = saved[0]
  assert(firstSavedEntry !== undefined, 'Expected first saved vocabulary entry')
  expect(saved).toHaveLength(1)
  expect(firstSavedEntry).toEqual({
    slug: 'group-targeting',
    description: 'Newest description.',
    createdAt: '2026-04-20T12:00:00.000Z',
    updatedAt: '2026-04-22T12:00:00.000Z',
  })
})

test('loadKeywordVocabulary rewrites legacy vocabulary files into canonical schema on read', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockAuditBehaviorConfig(root, {
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const legacyEntries = [
    {
      slug: 'Task Routing',
      description: 'Routes work through task pipelines.',
      createdAt: '2026-04-19T12:00:00.000Z',
      updatedAt: '2026-04-19T12:00:00.000Z',
      timesUsed: 2,
    },
    {
      slug: 'GROUP TARGETING',
      description: 'Older description.',
      createdAt: '2026-04-22T12:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
      timesUsed: 1,
    },
    {
      slug: 'group-targeting',
      description: 'Newest description.',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-23T12:00:00.000Z',
      timesUsed: 5,
    },
  ]

  await Bun.write(vocabularyPath, JSON.stringify(legacyEntries, null, 4))

  const typedVocab = await loadKeywordVocabularyModule(`vocab-load-${crypto.randomUUID()}`)
  const loaded = await typedVocab.loadKeywordVocabulary()

  const expectedEntries = [
    {
      slug: 'group-targeting',
      description: 'Newest description.',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-23T12:00:00.000Z',
    },
    {
      slug: 'task-routing',
      description: 'Routes work through task pipelines.',
      createdAt: '2026-04-19T12:00:00.000Z',
      updatedAt: '2026-04-19T12:00:00.000Z',
    },
  ]

  expect(loaded).toEqual(expectedEntries)
  expect(normalizeKeywordSlug('Task Routing')).toBe('task-routing')
  expect(await Bun.file(vocabularyPath).text()).toBe(JSON.stringify(expectedEntries, null, 2) + '\n')
})

test('runPhase1 marks test done after extraction completes', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-atomic-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-atomic-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve({
          result: createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            keywords: ['group-targeting'],
          }),
          usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        }),
    },
  )

  const completedTests = progress.phase1.completedTests['tests/tools/sample.test.ts']
  assert(completedTests !== undefined, 'Expected completed tests entry for sample test file')
  expect(completedTests['tests/tools/sample.test.ts::suite > case']).toBe('done')
})

test('runPhase1 re-extracts selected changed tests even when prior extraction exists', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  let extractCalls = 0

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-rerun-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-rerun-${tag}`)

  const progress = createEmptyProgressFixture(1)
  progress.phase1.completedFiles.push('tests/tools/sample.test.ts')
  progress.phase1.completedTests['tests/tools/sample.test.ts'] = {
    'tests/tools/sample.test.ts::suite > case': 'done',
  }
  await Bun.write(
    path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json'),
    JSON.stringify(
      [
        {
          behaviorId: 'tests/tools/sample.test.ts::suite > case',
          testKey: 'tests/tools/sample.test.ts::suite > case',
          testFile: 'tests/tools/sample.test.ts',
          domain: 'tools',
          testName: 'case',
          fullPath: 'suite > case',
          behavior: 'Stale extracted behavior.',
          context: 'Stale context.',
          keywords: ['stale-keyword'],
          extractedAt: '2026-04-20T12:00:00.000Z',
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
      ],
      null,
      2,
    ) + '\n',
  )

  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) => {
        extractCalls += 1
        return Promise.resolve({
          result: createExtractResult({
            behavior: 'When a user targets a group, the bot refreshes the extracted behavior.',
            context: 'Reprocesses changed test dependencies.',
            keywords: ['group-targeting-updated'],
          }),
          usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        })
      },
    },
  )

  expect(extractCalls).toBe(1)
  const extractedRecords: unknown = JSON.parse(
    await Bun.file(path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json')).text(),
  )
  expect(extractedRecords).toEqual([
    expect.objectContaining({
      behavior: 'When a user targets a group, the bot refreshes the extracted behavior.',
      keywords: ['group-targeting-updated'],
    }),
  ])
})

test('runPhase1 stores normalized keywords in the extracted record without mutable usage telemetry', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const extractedArtifactPath = path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json')

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-keyword-count-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-keyword-count-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve({
          result: createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            keywords: ['Group Targeting', 'group-targeting'],
          }),
          usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        }),
    },
  )

  const extractedRecords = ExtractedBehaviorRecordArraySchema.parse(
    JSON.parse(await Bun.file(extractedArtifactPath).text()),
  )
  expect(extractedRecords).toHaveLength(1)
  const firstRecord = extractedRecords[0]
  assert(firstRecord !== undefined, 'Expected extracted record')
  // Duplicates are collapsed and slugs are normalized
  expect(firstRecord.keywords).toEqual(['group-targeting'])
})

// Verify the keyword-vocabulary module still exports its utility functions
// (the module is kept for legacy data migration and normalizeKeywordSlug utility)
test('keyword-vocabulary module still exports loadKeywordVocabulary and saveKeywordVocabulary', async () => {
  const mod: unknown = await import(
    `../../../scripts/behavior-audit/keyword-vocabulary.js?test=shape-${crypto.randomUUID()}`
  )
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('loadKeywordVocabulary')
  expect(mod).toHaveProperty('saveKeywordVocabulary')
  expect(mod).toHaveProperty('normalizeKeywordSlug')
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { ConsolidatedManifest } from '../../../scripts/behavior-audit/incremental.js'
import { createEmptyProgress } from '../../../scripts/behavior-audit/progress.js'
import { mockAuditBehaviorConfig, mockReportsConfig } from '../behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from '../behavior-audit-integration.runtime-helpers.js'
import {
  importWithGuard,
  isResetModule,
  loadEvaluateReportingModule,
  loadClassifiedStoreModule,
  loadProgressModule,
  loadReportWriterModule,
  loadResetModule,
  type ResetModuleShape,
} from '../behavior-audit-integration.support.js'

interface ExtractedStoreModuleShape {
  readonly writeExtractedFile: (testFilePath: string, records: readonly unknown[]) => Promise<void>
  readonly readExtractedFile: (testFilePath: string) => Promise<readonly unknown[] | null>
}

interface EvaluatedStoreModuleShape {
  readonly writeEvaluatedFile: (featureKey: string, records: readonly unknown[]) => Promise<void>
  readonly readEvaluatedFile: (featureKey: string) => Promise<readonly unknown[] | null>
}

function isExtractedStoreModule(value: unknown): value is ExtractedStoreModuleShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'writeExtractedFile' in value &&
    typeof value.writeExtractedFile === 'function' &&
    'readExtractedFile' in value &&
    typeof value.readExtractedFile === 'function'
  )
}

function isEvaluatedStoreModule(value: unknown): value is EvaluatedStoreModuleShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'writeEvaluatedFile' in value &&
    typeof value.writeEvaluatedFile === 'function' &&
    'readEvaluatedFile' in value &&
    typeof value.readEvaluatedFile === 'function'
  )
}

function loadExtractedStoreModule(tag: string): Promise<ExtractedStoreModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/extracted-store.js?test=${tag}`,
    isExtractedStoreModule,
    'Unexpected extracted-store module shape',
  )
}

function loadEvaluatedStoreModule(tag: string): Promise<EvaluatedStoreModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/evaluated-store.js?test=${tag}`,
    isEvaluatedStoreModule,
    'Unexpected evaluated-store module shape',
  )
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

test('behavior-audit-reset phase2 clears downstream state without deleting keyword vocabulary', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')

  mkdirSync(path.join(reportsDir, 'consolidated'), { recursive: true })
  mkdirSync(path.join(reportsDir, 'stories'), { recursive: true })
  await Bun.write(
    path.join(reportsDir, 'keyword-vocabulary.json'),
    JSON.stringify([
      {
        slug: 'group-targeting',
        description: 'Targeting work at a group context.',
        createdAt: '2026-04-20T12:00:00.000Z',
        updatedAt: '2026-04-20T12:00:00.000Z',
      },
    ]),
  )
  await Bun.write(path.join(reportsDir, 'consolidated', 'tools.md'), '# consolidated')
  await Bun.write(path.join(reportsDir, 'stories', 'tools.md'), '# stories')

  mockReportsConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  const reset = await loadResetModule(`phase2-reset-${crypto.randomUUID()}`)
  await reset.resetBehaviorAudit('phase2')

  expect(await Bun.file(path.join(reportsDir, 'keyword-vocabulary.json')).exists()).toBe(true)
  expect(await Bun.file(path.join(reportsDir, 'consolidated', 'tools.md')).exists()).toBe(false)
  expect(await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).exists()).toBe(false)
})

test('classified-store round-trips sorted classified behaviors under audit root', async () => {
  const root = makeTempDir()
  const testFilePath = 'tests/tools/sample.test.ts'

  mockAuditBehaviorConfig(root, null)

  const store = await loadClassifiedStoreModule(crypto.randomUUID())
  await store.writeClassifiedFile(testFilePath, [
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > beta',
      testKey: 'tests/tools/sample.test.ts::suite > beta',
      domain: 'tools',
      visibility: 'user-facing',
      featureKey: 'task-creation',
      featureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'beta',
      classifiedAt: '2026-04-23T12:00:00.000Z',
    },
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > alpha',
      testKey: 'tests/tools/sample.test.ts::suite > alpha',
      domain: 'tools',
      visibility: 'internal',
      featureKey: 'task-creation',
      featureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'alpha',
      classifiedAt: '2026-04-23T12:01:00.000Z',
    },
  ])

  const loaded = await store.readClassifiedFile(testFilePath)
  assert(loaded !== null, 'Expected classified data')
  expect(loaded.map((item) => item.behaviorId)).toEqual([
    'tests/tools/sample.test.ts::suite > alpha',
    'tests/tools/sample.test.ts::suite > beta',
  ])
})

test('classified-store throws for malformed classified data but returns null when file is missing', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const classifiedDir = path.join(auditRoot, 'classified')
  const testFilePath = 'tests/tools/sample.test.ts'

  mockAuditBehaviorConfig(root, {
    CLASSIFIED_DIR: classifiedDir,
  })

  const store = await loadClassifiedStoreModule(crypto.randomUUID())

  expect(await store.readClassifiedFile('tests/tools/missing.test.ts')).toBeNull()

  mkdirSync(path.join(classifiedDir, 'tools'), { recursive: true })
  await Bun.write(path.join(classifiedDir, 'tools', 'sample.test.json'), '{"not":"an array"}\n')

  await expect(store.readClassifiedFile(testFilePath)).rejects.toThrow()
})

test('extracted-store round-trips extracted records under the extracted domain directory', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const store = await loadExtractedStoreModule(crypto.randomUUID())
  const testFilePath = 'tests/tools/sample.test.ts'
  const expectedPath = path.join(root, 'reports', 'audit-behavior', 'extracted', 'tools', 'sample.test.json')
  const records = [
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > create task',
      testKey: 'tests/tools/sample.test.ts::suite > create task',
      testFile: testFilePath,
      domain: 'tools',
      testName: 'create task',
      fullPath: 'suite > create task',
      behavior: 'Creates a task from chat input.',
      context: 'Uses the task provider create flow.',
      keywords: ['task-create'],
      extractedAt: '2026-04-23T12:00:00.000Z',
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
  ] as const

  await store.writeExtractedFile(testFilePath, records)

  expect(await Bun.file(expectedPath).exists()).toBe(true)
  expect(await store.readExtractedFile(testFilePath)).toEqual(records)
})

test('evaluated-store round-trips evaluated records under the evaluated feature path', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const store = await loadEvaluatedStoreModule(crypto.randomUUID())
  const featureKey = 'task-creation'
  const expectedPath = path.join(root, 'reports', 'audit-behavior', 'evaluated', 'task-creation.json')
  const records = [
    {
      consolidatedId: 'task-creation::feature',
      maria: { discover: 4, use: 4, retain: 3, notes: 'Clear primary path.' },
      dani: { discover: 3, use: 4, retain: 3, notes: 'Works once discovered.' },
      viktor: { discover: 2, use: 3, retain: 2, notes: 'Needs stronger affordances.' },
      flaws: ['Validation feedback is easy to miss.'],
      improvements: ['Make failure states more explicit.'],
      evaluatedAt: '2026-04-23T12:00:00.000Z',
    },
  ] as const

  await store.writeEvaluatedFile(featureKey, records)

  expect(await Bun.file(expectedPath).exists()).toBe(true)
  expect(await store.readEvaluatedFile(featureKey)).toEqual(records)
})

test('extracted-store returns null for a missing file and throws on malformed JSON', async () => {
  const root = makeTempDir()
  const extractedDir = path.join(root, 'reports', 'audit-behavior', 'extracted', 'tools')

  mockAuditBehaviorConfig(root, null)

  const store = await loadExtractedStoreModule(crypto.randomUUID())

  expect(await store.readExtractedFile('tests/tools/missing.test.ts')).toBeNull()

  mkdirSync(extractedDir, { recursive: true })
  await Bun.write(path.join(extractedDir, 'sample.test.json'), '{"not":"an array"}\n')

  await expect(store.readExtractedFile('tests/tools/sample.test.ts')).rejects.toThrow()
})

test('extracted-store throws when a stored record includes an unexpected extra key', async () => {
  const root = makeTempDir()
  const extractedDir = path.join(root, 'reports', 'audit-behavior', 'extracted', 'tools')

  mockAuditBehaviorConfig(root, null)

  const store = await loadExtractedStoreModule(crypto.randomUUID())

  mkdirSync(extractedDir, { recursive: true })
  await Bun.write(
    path.join(extractedDir, 'sample.test.json'),
    JSON.stringify([
      {
        behaviorId: 'tests/tools/sample.test.ts::suite > create task',
        testKey: 'tests/tools/sample.test.ts::suite > create task',
        testFile: 'tests/tools/sample.test.ts',
        domain: 'tools',
        testName: 'create task',
        fullPath: 'suite > create task',
        behavior: 'Creates a task from chat input.',
        context: 'Uses the task provider create flow.',
        keywords: ['task-create'],
        extractedAt: '2026-04-23T12:00:00.000Z',
        unexpected: true,
      },
    ]) + '\n',
  )

  await expect(store.readExtractedFile('tests/tools/sample.test.ts')).rejects.toThrow()
})

test('evaluated-store returns null for a missing file and throws on malformed JSON', async () => {
  const root = makeTempDir()
  const evaluatedDir = path.join(root, 'reports', 'audit-behavior', 'evaluated')

  mockAuditBehaviorConfig(root, null)

  const store = await loadEvaluatedStoreModule(crypto.randomUUID())

  expect(await store.readEvaluatedFile('missing-feature')).toBeNull()

  mkdirSync(evaluatedDir, { recursive: true })
  await Bun.write(path.join(evaluatedDir, 'task-creation.json'), '{"not":"an array"}\n')

  await expect(store.readEvaluatedFile('task-creation')).rejects.toThrow()
})

test('evaluated-store throws when a stored record includes an unexpected nested key', async () => {
  const root = makeTempDir()
  const evaluatedDir = path.join(root, 'reports', 'audit-behavior', 'evaluated')

  mockAuditBehaviorConfig(root, null)

  const store = await loadEvaluatedStoreModule(crypto.randomUUID())

  mkdirSync(evaluatedDir, { recursive: true })
  await Bun.write(
    path.join(evaluatedDir, 'task-creation.json'),
    JSON.stringify([
      {
        consolidatedId: 'task-creation::feature',
        maria: { discover: 4, use: 4, retain: 3, notes: 'Clear primary path.', unexpected: true },
        dani: { discover: 3, use: 4, retain: 3, notes: 'Works once discovered.' },
        viktor: { discover: 2, use: 3, retain: 2, notes: 'Needs stronger affordances.' },
        flaws: ['Validation feedback is easy to miss.'],
        improvements: ['Make failure states more explicit.'],
        evaluatedAt: '2026-04-23T12:00:00.000Z',
      },
    ]) + '\n',
  )

  await expect(store.readEvaluatedFile('task-creation')).rejects.toThrow()
})

test('report-writer round-trips supporting internal refs as readonly consolidated data', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const writer = await loadReportWriterModule(crypto.randomUUID())
  await writer.writeConsolidatedFile('tools', [
    {
      id: 'task-creation::feature',
      domain: 'tools',
      featureName: 'Task creation',
      isUserFacing: true,
      behavior: 'When a user creates a task, the bot saves it.',
      userStory: 'As a user, I can create a task through chat.',
      context: 'Calls provider create flow.',
      sourceTestKeys: ['tests/tools/sample.test.ts::suite > create task'],
      sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > create task'],
      supportingInternalRefs: [
        {
          behaviorId: 'tests/tools/sample.test.ts::suite > validate task',
          summary: 'Validates the task payload before submission.',
        },
      ],
    },
  ])

  const loaded = await writer.readConsolidatedFile('tools')
  expect(loaded).not.toBeNull()
  expect(loaded).toHaveLength(1)

  const item = loaded![0]
  assert(item !== undefined, 'Expected consolidated item to exist')
  expect(item.supportingInternalRefs).toEqual([
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > validate task',
      summary: 'Validates the task payload before submission.',
    },
  ])
  expect(Object.isFrozen(item.supportingInternalRefs)).toBe(true)
  expect(Object.isFrozen(item.supportingInternalRefs[0])).toBe(true)
})

test('report-writer throws for malformed consolidated data but returns null when file is missing', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const consolidatedDir = path.join(auditRoot, 'consolidated')

  mockAuditBehaviorConfig(root, {
    CONSOLIDATED_DIR: consolidatedDir,
  })

  const writer = await loadReportWriterModule(crypto.randomUUID())

  expect(await writer.readConsolidatedFile('missing')).toBeNull()

  mkdirSync(consolidatedDir, { recursive: true })
  await Bun.write(path.join(consolidatedDir, 'tools.json'), '{"not":"an array"}\n')

  await expect(writer.readConsolidatedFile('tools')).rejects.toThrow()
})

test('report-writer rebuilds story and index markdown from canonical artifacts only', async () => {
  const root = makeTempDir()
  const paths = path.join(root, 'reports', 'audit-behavior')
  const testKey = 'tests/tools/sample.test.ts::suite > create task'
  const featureKey = 'task-creation'
  const consolidatedId = `${featureKey}::feature`

  mockAuditBehaviorConfig(root, null)

  const writer = await loadReportWriterModule(crypto.randomUUID())

  mkdirSync(path.join(paths, 'extracted', 'tools'), { recursive: true })
  mkdirSync(path.join(paths, 'consolidated'), { recursive: true })
  mkdirSync(path.join(paths, 'evaluated'), { recursive: true })

  await Bun.write(
    path.join(paths, 'extracted', 'tools', 'sample.test.json'),
    JSON.stringify(
      [
        {
          behaviorId: testKey,
          testKey,
          testFile: 'tests/tools/sample.test.ts',
          domain: 'tools',
          testName: 'create task',
          fullPath: 'suite > create task',
          behavior: 'Creates a task from the canonical extracted artifact.',
          context: 'Canonical extracted context.',
          keywords: ['canonical-extracted'],
          extractedAt: '2026-04-23T12:00:00.000Z',
        },
      ],
      null,
      2,
    ) + '\n',
  )
  await Bun.write(
    path.join(paths, 'consolidated', `${featureKey}.json`),
    JSON.stringify(
      [
        {
          id: consolidatedId,
          domain: 'tools',
          featureName: 'Task creation',
          isUserFacing: true,
          behavior: 'Creates a task from the canonical consolidated artifact.',
          userStory: 'As a user, I can create a task from canonical artifacts.',
          context: 'Canonical consolidated context.',
          sourceTestKeys: [testKey],
          sourceBehaviorIds: [testKey],
          supportingInternalRefs: [],
        },
      ],
      null,
      2,
    ) + '\n',
  )
  await Bun.write(
    path.join(paths, 'evaluated', `${featureKey}.json`),
    JSON.stringify(
      [
        {
          consolidatedId,
          maria: { discover: 4, use: 4, retain: 3, notes: 'Canonical Maria note.' },
          dani: { discover: 3, use: 4, retain: 3, notes: 'Canonical Dani note.' },
          viktor: { discover: 2, use: 3, retain: 2, notes: 'Canonical Viktor note.' },
          flaws: ['Canonical flaw'],
          improvements: ['Canonical improvement'],
          evaluatedAt: '2026-04-23T12:05:00.000Z',
        },
      ],
      null,
      2,
    ) + '\n',
  )

  const consolidatedManifest: ConsolidatedManifest = {
    version: 1 as const,
    entries: {
      [consolidatedId]: {
        consolidatedId,
        domain: 'tools',
        featureName: 'Task creation',
        consolidatedArtifactPath: path.join('reports', 'audit-behavior', 'consolidated', `${featureKey}.json`),
        evaluatedArtifactPath: path.join('reports', 'audit-behavior', 'evaluated', `${featureKey}.json`),
        sourceTestKeys: [testKey],
        sourceBehaviorIds: [testKey],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey,
        keywords: ['canonical-extracted'],
        sourceDomains: ['tools'],
        phase2Fingerprint: 'phase2-fp',
        phase3Fingerprint: 'phase3-fp',
        lastConsolidatedAt: '2026-04-23T12:02:00.000Z',
        lastEvaluatedAt: '2026-04-23T12:05:00.000Z',
      },
    },
  }

  await writer.rebuildReportsFromStoredResults({ consolidatedManifest })

  const storyMarkdown = await Bun.file(path.join(paths, 'stories', 'tools.md')).text()
  const indexMarkdown = await Bun.file(path.join(paths, 'stories', 'index.md')).text()

  expect(storyMarkdown).toContain('As a user, I can create a task from canonical artifacts.')
  expect(storyMarkdown).toContain('Canonical flaw')
  expect(storyMarkdown).toContain('Canonical improvement')
  expect(indexMarkdown).toContain('Top 10 Flaws (by frequency)')
  expect(indexMarkdown).toContain('Canonical flaw')
})

test('report-writer rebuild falls back to the canonical evaluated artifact path when manifest metadata is null', async () => {
  const root = makeTempDir()
  const paths = path.join(root, 'reports', 'audit-behavior')
  const testKey = 'tests/tools/sample.test.ts::suite > create task'
  const featureKey = 'task-creation'
  const consolidatedId = `${featureKey}::feature`

  mockAuditBehaviorConfig(root, null)

  const writer = await loadReportWriterModule(crypto.randomUUID())

  mkdirSync(path.join(paths, 'extracted', 'tools'), { recursive: true })
  mkdirSync(path.join(paths, 'consolidated'), { recursive: true })
  mkdirSync(path.join(paths, 'evaluated'), { recursive: true })

  await Bun.write(
    path.join(paths, 'extracted', 'tools', 'sample.test.json'),
    JSON.stringify(
      [
        {
          behaviorId: testKey,
          testKey,
          testFile: 'tests/tools/sample.test.ts',
          domain: 'tools',
          testName: 'create task',
          fullPath: 'suite > create task',
          behavior: 'Creates a task from the canonical extracted artifact.',
          context: 'Canonical extracted context.',
          keywords: ['canonical-extracted'],
          extractedAt: '2026-04-23T12:00:00.000Z',
        },
      ],
      null,
      2,
    ) + '\n',
  )
  await Bun.write(
    path.join(paths, 'consolidated', `${featureKey}.json`),
    JSON.stringify(
      [
        {
          id: consolidatedId,
          domain: 'tools',
          featureName: 'Task creation',
          isUserFacing: true,
          behavior: 'Creates a task from the canonical consolidated artifact.',
          userStory: 'As a user, I can create a task from canonical artifacts.',
          context: 'Canonical consolidated context.',
          sourceTestKeys: [testKey],
          sourceBehaviorIds: [testKey],
          supportingInternalRefs: [],
        },
      ],
      null,
      2,
    ) + '\n',
  )
  await Bun.write(
    path.join(paths, 'evaluated', `${featureKey}.json`),
    JSON.stringify(
      [
        {
          consolidatedId,
          maria: { discover: 4, use: 4, retain: 3, notes: 'Canonical Maria note.' },
          dani: { discover: 3, use: 4, retain: 3, notes: 'Canonical Dani note.' },
          viktor: { discover: 2, use: 3, retain: 2, notes: 'Canonical Viktor note.' },
          flaws: ['Canonical fallback flaw'],
          improvements: ['Canonical fallback improvement'],
          evaluatedAt: '2026-04-23T12:05:00.000Z',
        },
      ],
      null,
      2,
    ) + '\n',
  )

  const consolidatedManifest: ConsolidatedManifest = {
    version: 1 as const,
    entries: {
      [consolidatedId]: {
        consolidatedId,
        domain: 'tools',
        featureName: 'Task creation',
        consolidatedArtifactPath: path.join('reports', 'audit-behavior', 'consolidated', `${featureKey}.json`),
        evaluatedArtifactPath: null,
        sourceTestKeys: [testKey],
        sourceBehaviorIds: [testKey],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey,
        keywords: ['canonical-extracted'],
        sourceDomains: ['tools'],
        phase2Fingerprint: 'phase2-fp',
        phase3Fingerprint: 'phase3-fp',
        lastConsolidatedAt: '2026-04-23T12:02:00.000Z',
        lastEvaluatedAt: '2026-04-23T12:05:00.000Z',
      },
    },
  }

  await writer.rebuildReportsFromStoredResults({ consolidatedManifest })

  const storyMarkdown = await Bun.file(path.join(paths, 'stories', 'tools.md')).text()
  const indexMarkdown = await Bun.file(path.join(paths, 'stories', 'index.md')).text()

  expect(storyMarkdown).toContain('As a user, I can create a task from canonical artifacts.')
  expect(storyMarkdown).toContain('Canonical fallback flaw')
  expect(indexMarkdown).toContain('Canonical fallback improvement')
  expect(indexMarkdown).toContain('**Tests processed:** 1')
})

test('report-writer rebuild counts only joined story evaluations in the rebuilt index', async () => {
  const root = makeTempDir()
  const paths = path.join(root, 'reports', 'audit-behavior')
  const testKey = 'tests/tools/sample.test.ts::suite > create task'
  const featureKey = 'task-creation'
  const consolidatedId = `${featureKey}::feature`

  mockAuditBehaviorConfig(root, null)

  const writer = await loadReportWriterModule(crypto.randomUUID())

  mkdirSync(path.join(paths, 'extracted', 'tools'), { recursive: true })
  mkdirSync(path.join(paths, 'consolidated'), { recursive: true })
  mkdirSync(path.join(paths, 'evaluated'), { recursive: true })

  await Bun.write(
    path.join(paths, 'extracted', 'tools', 'sample.test.json'),
    JSON.stringify(
      [
        {
          behaviorId: testKey,
          testKey,
          testFile: 'tests/tools/sample.test.ts',
          domain: 'tools',
          testName: 'create task',
          fullPath: 'suite > create task',
          behavior: 'Creates a task from the canonical extracted artifact.',
          context: 'Canonical extracted context.',
          keywords: ['canonical-extracted'],
          extractedAt: '2026-04-23T12:00:00.000Z',
        },
      ],
      null,
      2,
    ) + '\n',
  )
  await Bun.write(
    path.join(paths, 'consolidated', `${featureKey}.json`),
    JSON.stringify(
      [
        {
          id: consolidatedId,
          domain: 'tools',
          featureName: 'Task creation',
          isUserFacing: true,
          behavior: 'Creates a task from the canonical consolidated artifact.',
          userStory: 'As a user, I can create a task from canonical artifacts.',
          context: 'Canonical consolidated context.',
          sourceTestKeys: [testKey],
          sourceBehaviorIds: [testKey],
          supportingInternalRefs: [],
        },
      ],
      null,
      2,
    ) + '\n',
  )
  await Bun.write(
    path.join(paths, 'evaluated', `${featureKey}.json`),
    JSON.stringify(
      [
        {
          consolidatedId,
          maria: { discover: 4, use: 4, retain: 3, notes: 'Canonical Maria note.' },
          dani: { discover: 3, use: 4, retain: 3, notes: 'Canonical Dani note.' },
          viktor: { discover: 2, use: 3, retain: 2, notes: 'Canonical Viktor note.' },
          flaws: ['Canonical flaw'],
          improvements: ['Canonical improvement'],
          evaluatedAt: '2026-04-23T12:05:00.000Z',
        },
        {
          consolidatedId: 'task-creation::orphaned-feature',
          maria: { discover: 1, use: 1, retain: 1, notes: 'Orphaned Maria note.' },
          dani: { discover: 1, use: 1, retain: 1, notes: 'Orphaned Dani note.' },
          viktor: { discover: 1, use: 1, retain: 1, notes: 'Orphaned Viktor note.' },
          flaws: ['Orphaned flaw'],
          improvements: ['Orphaned improvement'],
          evaluatedAt: '2026-04-23T12:06:00.000Z',
        },
      ],
      null,
      2,
    ) + '\n',
  )

  const consolidatedManifest: ConsolidatedManifest = {
    version: 1 as const,
    entries: {
      [consolidatedId]: {
        consolidatedId,
        domain: 'tools',
        featureName: 'Task creation',
        consolidatedArtifactPath: path.join('reports', 'audit-behavior', 'consolidated', `${featureKey}.json`),
        evaluatedArtifactPath: path.join('reports', 'audit-behavior', 'evaluated', `${featureKey}.json`),
        sourceTestKeys: [testKey],
        sourceBehaviorIds: [testKey],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey,
        keywords: ['canonical-extracted'],
        sourceDomains: ['tools'],
        phase2Fingerprint: 'phase2-fp',
        phase3Fingerprint: 'phase3-fp',
        lastConsolidatedAt: '2026-04-23T12:02:00.000Z',
        lastEvaluatedAt: '2026-04-23T12:05:00.000Z',
      },
    },
  }

  await writer.rebuildReportsFromStoredResults({ consolidatedManifest })

  const storyMarkdown = await Bun.file(path.join(paths, 'stories', 'tools.md')).text()
  const indexMarkdown = await Bun.file(path.join(paths, 'stories', 'index.md')).text()

  expect(storyMarkdown).toContain('As a user, I can create a task from canonical artifacts.')
  expect(storyMarkdown).not.toContain('Orphaned flaw')
  expect(indexMarkdown).toContain('**Tests processed:** 1')
  expect(indexMarkdown).not.toContain('**Tests processed:** 2')
  expect(indexMarkdown).not.toContain('Orphaned flaw')
})

test('resetBehaviorAudit phase2 clears audit-behavior phase2 outputs but preserves keyword vocabulary', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const consolidatedDir = path.join(auditRoot, 'consolidated')
  const classifiedDir = path.join(auditRoot, 'classified')
  const evaluatedDir = path.join(auditRoot, 'evaluated')
  const storiesDir = path.join(auditRoot, 'stories')
  const vocabularyPath = path.join(auditRoot, 'keyword-vocabulary.json')
  const progressPath = path.join(auditRoot, 'progress.json')

  mkdirSync(consolidatedDir, { recursive: true })
  mkdirSync(classifiedDir, { recursive: true })
  mkdirSync(evaluatedDir, { recursive: true })
  mkdirSync(storiesDir, { recursive: true })

  await Bun.write(path.join(consolidatedDir, 'group-routing.json'), '[]\n')
  await Bun.write(path.join(classifiedDir, 'tools.json'), '[]\n')
  await Bun.write(path.join(evaluatedDir, 'group-routing.json'), '[]\n')
  await Bun.write(path.join(storiesDir, 'tools.md'), '# tools\n')
  await Bun.write(vocabularyPath, '[]\n')
  const progressModule = await loadProgressModule(crypto.randomUUID())
  const progress = createEmptyProgress(0)
  progress.phase2a.status = 'done'
  progress.phase2a.stats = { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 }
  progress.phase2b.status = 'done'
  progress.phase2b.stats = {
    featureKeysTotal: 0,
    featureKeysDone: 0,
    featureKeysFailed: 0,
    behaviorsConsolidated: 0,
  }
  progress.phase3.status = 'done'
  progress.phase3.stats = { consolidatedIdsTotal: 0, consolidatedIdsDone: 0, consolidatedIdsFailed: 0 }
  await progressModule.saveProgress(progress)

  mockAuditBehaviorConfig(root, {
    CLASSIFIED_DIR: classifiedDir,
    CONSOLIDATED_DIR: consolidatedDir,
    EVALUATED_DIR: evaluatedDir,
    STORIES_DIR: storiesDir,
    PROGRESS_PATH: progressPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
  })

  const mod: ResetModuleShape = await importWithGuard(
    `../../scripts/behavior-audit/reset.ts?test=${crypto.randomUUID()}`,
    isResetModule,
    'Unexpected reset module shape',
  )
  await mod.resetBehaviorAudit('phase2')

  expect(await Bun.file(vocabularyPath).exists()).toBe(true)
  expect(await Bun.file(path.join(consolidatedDir, 'group-routing.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(classifiedDir, 'tools.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(evaluatedDir, 'group-routing.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(storiesDir, 'tools.md')).exists()).toBe(false)
})

test('resetBehaviorAudit phase3 clears evaluated and stories outputs only', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const consolidatedDir = path.join(auditRoot, 'consolidated')
  const classifiedDir = path.join(auditRoot, 'classified')
  const evaluatedDir = path.join(auditRoot, 'evaluated')
  const storiesDir = path.join(auditRoot, 'stories')
  const progressPath = path.join(auditRoot, 'progress.json')

  mkdirSync(consolidatedDir, { recursive: true })
  mkdirSync(classifiedDir, { recursive: true })
  mkdirSync(evaluatedDir, { recursive: true })
  mkdirSync(storiesDir, { recursive: true })

  await Bun.write(path.join(consolidatedDir, 'group-routing.json'), '[]\n')
  await Bun.write(path.join(classifiedDir, 'tools.json'), '[]\n')
  await Bun.write(path.join(evaluatedDir, 'group-routing.json'), '[]\n')
  await Bun.write(path.join(storiesDir, 'tools.md'), '# tools\n')

  mockAuditBehaviorConfig(root, {
    CLASSIFIED_DIR: classifiedDir,
    CONSOLIDATED_DIR: consolidatedDir,
    EVALUATED_DIR: evaluatedDir,
    STORIES_DIR: storiesDir,
    PROGRESS_PATH: progressPath,
  })

  const progressModule = await loadProgressModule(crypto.randomUUID())
  const progress = progressModule.createEmptyProgress(1)
  progress.startedAt = '2026-04-21T12:00:00.000Z'
  progress.phase1.status = 'done'
  progress.phase1.stats = { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 }
  progress.phase2a.status = 'done'
  progress.phase2a.completedBehaviors['behavior-1'] = 'done'
  progress.phase2a.failedBehaviors['behavior-2'] = {
    error: 'classification failed once',
    attempts: 1,
    lastAttempt: '2026-04-21T12:05:00.000Z',
  }
  progress.phase2a.stats = { behaviorsTotal: 2, behaviorsDone: 1, behaviorsFailed: 1 }
  progress.phase2b.status = 'done'
  progress.phase2b.completedFeatureKeys['task-creation'] = 'done'
  progress.phase2b.failedFeatureKeys['group-routing'] = {
    error: 'consolidation failed once',
    attempts: 2,
    lastAttempt: '2026-04-21T12:10:00.000Z',
  }
  progress.phase2b.stats = {
    featureKeysTotal: 2,
    featureKeysDone: 1,
    featureKeysFailed: 1,
    behaviorsConsolidated: 3,
  }
  progress.phase3.status = 'done'
  progress.phase3.completedConsolidatedIds['task-creation::feature'] = 'done'
  progress.phase3.failedConsolidatedIds['task-creation::other'] = {
    error: 'evaluation failed once',
    attempts: 1,
    lastAttempt: '2026-04-21T12:15:00.000Z',
  }
  progress.phase3.stats = { consolidatedIdsTotal: 2, consolidatedIdsDone: 1, consolidatedIdsFailed: 1 }
  await progressModule.saveProgress(progress)

  const mod: ResetModuleShape = await importWithGuard(
    `../../scripts/behavior-audit/reset.ts?test=${crypto.randomUUID()}`,
    isResetModule,
    'Unexpected reset module shape',
  )
  await mod.resetBehaviorAudit('phase3')

  expect(await Bun.file(path.join(consolidatedDir, 'group-routing.json')).exists()).toBe(true)
  expect(await Bun.file(path.join(classifiedDir, 'tools.json')).exists()).toBe(true)
  expect(await Bun.file(path.join(evaluatedDir, 'group-routing.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(storiesDir, 'tools.md')).exists()).toBe(false)

  const savedProgress = await progressModule.loadProgress()
  expect(savedProgress).not.toBeNull()
  expect(savedProgress?.phase2a).toEqual(progress.phase2a)
  expect(savedProgress?.phase2b).toEqual(progress.phase2b)
  expect(savedProgress?.phase3.status).toBe('not-started')
  expect(savedProgress?.phase3.completedConsolidatedIds).toEqual({})
  expect(savedProgress?.phase3.failedConsolidatedIds).toEqual({})
  expect(savedProgress?.phase3.stats).toEqual({
    consolidatedIdsTotal: 0,
    consolidatedIdsDone: 0,
    consolidatedIdsFailed: 0,
  })
})

test('progress reset helpers clear checkpoint state without touching canonical artifacts', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const extractedStore = await loadExtractedStoreModule(crypto.randomUUID())
  const evaluatedStore = await loadEvaluatedStoreModule(crypto.randomUUID())
  const progressModule = await loadProgressModule(crypto.randomUUID())

  await extractedStore.writeExtractedFile('tests/tools/sample.test.ts', [
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > create task',
      testKey: 'tests/tools/sample.test.ts::suite > create task',
      testFile: 'tests/tools/sample.test.ts',
      domain: 'tools',
      testName: 'create task',
      fullPath: 'suite > create task',
      behavior: 'Creates a task from chat input.',
      context: 'Uses the task provider create flow.',
      keywords: ['task-create'],
      extractedAt: '2026-04-23T12:00:00.000Z',
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
  ])
  await evaluatedStore.writeEvaluatedFile('task-creation', [
    {
      consolidatedId: 'task-creation::feature',
      maria: { discover: 4, use: 4, retain: 3, notes: 'Clear primary path.' },
      dani: { discover: 3, use: 4, retain: 3, notes: 'Works once discovered.' },
      viktor: { discover: 2, use: 3, retain: 2, notes: 'Needs stronger affordances.' },
      flaws: ['Validation feedback is easy to miss.'],
      improvements: ['Make failure states more explicit.'],
      evaluatedAt: '2026-04-23T12:00:00.000Z',
    },
  ])

  const progress = progressModule.createEmptyProgress(1)
  progress.phase2a.status = 'done'
  progress.phase2a.completedBehaviors['behavior-1'] = 'done'
  progress.phase2a.failedBehaviors['behavior-2'] = {
    error: 'failed classification',
    attempts: 2,
    lastAttempt: '2026-04-23T12:01:00.000Z',
  }
  progress.phase2a.stats = { behaviorsTotal: 2, behaviorsDone: 1, behaviorsFailed: 1 }
  progress.phase2b.status = 'done'
  progress.phase2b.completedFeatureKeys['task-creation'] = 'done'
  progress.phase2b.failedFeatureKeys['task-creation-2'] = {
    error: 'failed consolidation',
    attempts: 1,
    lastAttempt: '2026-04-23T12:02:00.000Z',
  }
  progress.phase2b.stats = {
    featureKeysTotal: 2,
    featureKeysDone: 1,
    featureKeysFailed: 1,
    behaviorsConsolidated: 1,
  }
  progress.phase3.status = 'done'
  progress.phase3.completedConsolidatedIds['task-creation::feature'] = 'done'
  progress.phase3.failedConsolidatedIds['task-creation::other'] = {
    error: 'failed evaluation',
    attempts: 1,
    lastAttempt: '2026-04-23T12:03:00.000Z',
  }
  progress.phase3.stats = { consolidatedIdsTotal: 2, consolidatedIdsDone: 1, consolidatedIdsFailed: 1 }

  progressModule.resetPhase2AndPhase3(progress)
  await progressModule.saveProgress(progress)

  expect(progress.phase2a.status as string).toBe('not-started')
  expect(progress.phase2a.completedBehaviors).toEqual({})
  expect(progress.phase2a.failedBehaviors).toEqual({})
  expect(progress.phase2b.status as string).toBe('not-started')
  expect(progress.phase2b.completedFeatureKeys).toEqual({})
  expect(progress.phase2b.failedFeatureKeys).toEqual({})
  expect(progress.phase3.status as string).toBe('not-started')
  expect(progress.phase3.completedConsolidatedIds).toEqual({})
  expect(progress.phase3.failedConsolidatedIds).toEqual({})
  expect(await extractedStore.readExtractedFile('tests/tools/sample.test.ts')).toEqual([
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > create task',
      testKey: 'tests/tools/sample.test.ts::suite > create task',
      testFile: 'tests/tools/sample.test.ts',
      domain: 'tools',
      testName: 'create task',
      fullPath: 'suite > create task',
      behavior: 'Creates a task from chat input.',
      context: 'Uses the task provider create flow.',
      keywords: ['task-create'],
      extractedAt: '2026-04-23T12:00:00.000Z',
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
  ])
  expect(await evaluatedStore.readEvaluatedFile('task-creation')).toEqual([
    {
      consolidatedId: 'task-creation::feature',
      maria: { discover: 4, use: 4, retain: 3, notes: 'Clear primary path.' },
      dani: { discover: 3, use: 4, retain: 3, notes: 'Works once discovered.' },
      viktor: { discover: 2, use: 3, retain: 2, notes: 'Needs stronger affordances.' },
      flaws: ['Validation feedback is easy to miss.'],
      improvements: ['Make failure states more explicit.'],
      evaluatedAt: '2026-04-23T12:00:00.000Z',
    },
  ])
})

test('loadProgress returns null when the progress file is missing', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const progressModule = await loadProgressModule(crypto.randomUUID())

  await expect(progressModule.loadProgress()).resolves.toBeNull()
})

test('loadProgress rethrows malformed JSON errors', async () => {
  const root = makeTempDir()
  const progressPath = path.join(root, 'reports', 'audit-behavior', 'progress.json')

  mockAuditBehaviorConfig(root, { PROGRESS_PATH: progressPath })
  mkdirSync(path.dirname(progressPath), { recursive: true })
  await Bun.write(progressPath, '{broken json')

  const progressModule = await loadProgressModule(crypto.randomUUID())

  await expect(progressModule.loadProgress()).rejects.toThrow()
})

test('loadProgress rethrows schema-invalid progress errors', async () => {
  const root = makeTempDir()
  const progressPath = path.join(root, 'reports', 'audit-behavior', 'progress.json')

  mockAuditBehaviorConfig(root, { PROGRESS_PATH: progressPath })
  mkdirSync(path.dirname(progressPath), { recursive: true })
  await Bun.write(
    progressPath,
    JSON.stringify({
      phase1: {
        status: 'not-started',
      },
    }) + '\n',
  )

  const progressModule = await loadProgressModule(crypto.randomUUID())

  await expect(progressModule.loadProgress()).rejects.toThrow()
})

test('markFeatureKeyFailed only increments feature failure stats for a newly failed key', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const progressModule = await loadProgressModule(crypto.randomUUID())
  const progress = progressModule.createEmptyProgress(1)

  progressModule.markFeatureKeyFailed(progress, 'task-creation', 'first failure', 1)
  progressModule.markFeatureKeyFailed(progress, 'task-creation', 'updated failure', 2)

  expect(progress.phase2b.failedFeatureKeys['task-creation']?.error).toBe('updated failure')
  expect(progress.phase2b.failedFeatureKeys['task-creation']?.attempts).toBe(2)
  expect(progress.phase2b.stats.featureKeysFailed).toBe(1)
})

test('markFeatureKeyDone clears stale failure state after a successful retry', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const progressModule = await loadProgressModule(crypto.randomUUID())
  const progress = progressModule.createEmptyProgress(1)

  progressModule.markFeatureKeyFailed(progress, 'task-creation', 'first failure', 2)
  progressModule.markFeatureKeyDone(progress, 'task-creation', [])

  expect(progress.phase2b.completedFeatureKeys['task-creation']).toBe('done')
  expect(progress.phase2b.failedFeatureKeys['task-creation']).toBeUndefined()
  expect(progress.phase2b.stats.featureKeysDone).toBe(1)
  expect(progress.phase2b.stats.featureKeysFailed).toBe(0)
})

test('progress module exports only feature-key phase2b helpers', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const progressModule = await loadProgressModule(crypto.randomUUID())

  expect(Object.hasOwn(progressModule, 'markBatchDone')).toBe(false)
  expect(Object.hasOwn(progressModule, 'markBatchFailed')).toBe(false)
  expect(Object.hasOwn(progressModule, 'getFailedBatchAttempts')).toBe(false)
  expect(Object.hasOwn(progressModule, 'isBatchCompleted')).toBe(false)
})

test('markBehaviorFailed only increments consolidated failure stats for a newly failed key', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const progressModule = await loadProgressModule(crypto.randomUUID())
  const progress = progressModule.createEmptyProgress(1)

  progressModule.markBehaviorFailed(progress, 'task-creation::feature', 'first failure', 1)
  progressModule.markBehaviorFailed(progress, 'task-creation::feature', 'updated failure', 2)

  expect(progress.phase3.failedConsolidatedIds['task-creation::feature']?.error).toBe('updated failure')
  expect(progress.phase3.failedConsolidatedIds['task-creation::feature']?.attempts).toBe(2)
  expect(progress.phase3.stats.consolidatedIdsFailed).toBe(1)
})

test('markBehaviorDone clears stale failure state after a successful retry and reporting omits stale failures', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const progressModule = await loadProgressModule(crypto.randomUUID())
  const evaluateReporting = await loadEvaluateReportingModule(crypto.randomUUID())
  const progress = progressModule.createEmptyProgress(1)

  progressModule.markBehaviorFailed(progress, 'task-creation::feature', 'first failure', 2)
  progressModule.markBehaviorDone(progress, 'task-creation::feature')

  expect(progress.phase3.completedConsolidatedIds['task-creation::feature']).toBe('done')
  expect(progress.phase3.failedConsolidatedIds['task-creation::feature']).toBeUndefined()
  expect(progress.phase3.stats.consolidatedIdsDone).toBe(1)
  expect(progress.phase3.stats.consolidatedIdsFailed).toBe(0)

  progress.phase3.status = 'done'
  progress.phase3.stats.consolidatedIdsTotal = 1

  await evaluateReporting.writeReports({
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
            dani: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            viktor: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            flaws: [],
            improvements: [],
            evaluatedAt: '2026-04-23T12:00:00.000Z',
          },
        ],
      ],
    ]),
    progress,
  })

  const indexMarkdown = await Bun.file(path.join(root, 'reports', 'audit-behavior', 'stories', 'index.md')).text()
  expect(indexMarkdown).toContain('**Behaviors failed:** 0')
  expect(indexMarkdown).not.toContain('first failure')
  expect(indexMarkdown).not.toContain('task-creation::feature')
})

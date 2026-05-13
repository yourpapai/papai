import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type { ExtractedBehaviorRecord } from '../../scripts/behavior-audit/extracted-store.js'
import type { KeywordVocabularyEntry } from '../../scripts/behavior-audit/keyword-vocabulary.js'
import { emptyPhase2a, emptyPhase2b, emptyPhase3 } from '../../scripts/behavior-audit/progress.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { createAuditBehaviorConfig, createEmptyProgressFixture } from './behavior-audit-integration.helpers.js'
import {
  applyBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  restoreBehaviorAuditEnv,
} from './behavior-audit-integration.runtime-helpers.js'
import { loadConsolidateKeywordsModule, readSavedManifest } from './behavior-audit-integration.support.js'
import { makeExtractedRecord as makeFixtureRecord } from './behavior-audit/test-fixtures.js'

function makeVocabEntry(slug: string, description = 'desc'): KeywordVocabularyEntry {
  return {
    slug,
    description,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeExtractedRecord(overrides: Partial<ExtractedBehaviorRecord> = {}): ExtractedBehaviorRecord {
  return makeFixtureRecord({
    behaviorId: 'bid-1',
    testKey: 'tests/foo.test.ts::does something',
    testFile: 'tests/foo.test.ts',
    domain: 'foo',
    testName: 'does something',
    fullPath: 'does something',
    behavior: 'When something happens',
    context: 'ctx',
    keywords: ['slug-a', 'slug-b'],
    ...overrides,
  })
}

function makeProgress(phase1Done: boolean): Progress {
  const p = createEmptyProgressFixture(1)
  if (phase1Done) p.phase1.status = 'done'
  return p
}

function writeVocab(vocabPath: string, entries: KeywordVocabularyEntry[]): void {
  mkdirSync(path.dirname(vocabPath), { recursive: true })
  writeFileSync(vocabPath, JSON.stringify(entries, null, 2) + '\n')
}

function writeExtracted(extractedDir: string, testFile: string, records: ExtractedBehaviorRecord[]): void {
  const artifactPath = path.join(extractedDir, testFile.replace(/\.test\.ts$/, '.json'))
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(records, null, 2) + '\n')
}

function writeManifest(manifestPath: string, testFiles: string[]): void {
  const tests: Record<string, unknown> = {}
  for (const testFile of testFiles) {
    tests[`${testFile}::test`] = {
      testFile,
      testName: 'test',
      dependencyPaths: [],
      phase1Fingerprint: null,
      phase2aFingerprint: null,
      phase2Fingerprint: null,
      behaviorId: null,
      featureKey: null,
      extractedArtifactPath: null,
      classifiedArtifactPath: null,
      domain: 'test',
      lastPhase1CompletedAt: null,
      lastPhase2aCompletedAt: null,
      lastPhase2CompletedAt: null,
    }
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true })
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        lastStartCommit: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        phaseVersions: { phase1: '', phase2: '', reports: '' },
        tests,
      },
      null,
      2,
    ) + '\n',
  )
}

let tempRoot: string
const tag = crypto.randomUUID()

beforeEach(() => {
  tempRoot = makeTempDir()
  const config = createAuditBehaviorConfig(tempRoot, {
    EMBEDDING_MODEL: 'test-embed-model',
    CONSOLIDATION_THRESHOLD: 0.95,
    CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
    CONSOLIDATION_DRY_RUN: false,
    CONSOLIDATION_EMBED_BATCH_SIZE: 100,
  })
  applyBehaviorAuditEnv(config)
  reloadBehaviorAuditConfig()
  mkdirSync(config.AUDIT_BEHAVIOR_DIR, { recursive: true })
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

test('runPhase1b skips when phase 1 is not done', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(false)
  const savedProgress: Progress[] = []

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([]),
    saveKeywordVocabulary: () => {
      throw new Error('should not write vocab')
    },
    getOrEmbed: () => {
      throw new Error('should not embed')
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: (p) => {
      savedProgress.push(p)
      return Promise.resolve()
    },
    log: { log: () => {} },
  })

  expect(savedProgress).toHaveLength(0)
  expect(progress.phase1b.status).toBe('not-started')
})

test('runPhase1b soft-skips when EMBEDDING_MODEL is empty', async () => {
  process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL'] = ''
  reloadBehaviorAuditConfig()

  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('slug-a')]),
    saveKeywordVocabulary: () => {
      throw new Error('should not write vocab')
    },
    getOrEmbed: () => {
      throw new Error('should not embed')
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: '',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(progress.phase1b.status).toBe('done')
  expect(progress.phase1b.stats.mergesApplied).toBe(0)
})

test('runPhase1b applies merges, updates vocabulary, remaps extracted files, resets phase2/3', async () => {
  const config = createAuditBehaviorConfig(tempRoot, {
    EMBEDDING_MODEL: 'test-embed-model',
    CONSOLIDATION_THRESHOLD: 0.95,
    CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
    CONSOLIDATION_DRY_RUN: false,
    CONSOLIDATION_EMBED_BATCH_SIZE: 100,
  })

  const vocab = [makeVocabEntry('short'), makeVocabEntry('longer-alias')]
  writeVocab(config.KEYWORD_VOCABULARY_PATH, vocab)

  writeExtracted(config.EXTRACTED_DIR, 'tests/foo.test.ts', [
    makeExtractedRecord({ keywords: ['longer-alias', 'other'] }),
  ])

  writeManifest(config.INCREMENTAL_MANIFEST_PATH, ['tests/foo.test.ts'])

  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase2a.status = 'done'
  progress.phase2b.status = 'done'
  progress.phase3.status = 'done'

  const nearlyIdentical = [1, 0, 0]
  const mag = Math.sqrt(0.99 * 0.99 + 0.1 * 0.1)
  const normalized = [0.99 / mag, 0.1 / mag, 0]

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve(vocab),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: (_cachePath, _model, vocabArg, _deps) => {
      expect(vocabArg).toHaveLength(2)
      return Promise.resolve({
        raw: [nearlyIdentical, normalized],
        normalized: [nearlyIdentical, normalized],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => readSavedManifest(config.INCREMENTAL_MANIFEST_PATH),
    remapKeywordsInExtractedFile: (_testFile, mergeMap) => {
      expect(mergeMap.has('longer-alias')).toBe(true)
      return Promise.resolve({ updated: true, remappedCount: 1 })
    },
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(progress.phase1b.status).toBe('done')
  expect(progress.phase1b.stats.mergesApplied).toBe(1)
  expect(progress.phase1b.stats.behaviorsUpdated).toBe(1)
  expect(progress.phase2a).toEqual(emptyPhase2a())
  expect(progress.phase2b).toEqual(emptyPhase2b())
  expect(progress.phase3).toEqual(emptyPhase3())
})

test('runPhase1b skips when already done and vocabulary size unchanged', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.embeddingModel = 'test-embed-model'
  progress.phase1b.embeddingBaseUrl = 'http://localhost:1234/v1'
  progress.phase1b.embeddingCachePath = null
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('a'), makeVocabEntry('b')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: () => {
      embedCalled = true
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(false)
})

test('runPhase1b re-runs when clustering settings changed despite unchanged vocabulary size', async () => {
  applyBehaviorAuditEnv(
    createAuditBehaviorConfig(tempRoot, {
      EMBEDDING_MODEL: 'test-embed-model',
      CONSOLIDATION_THRESHOLD: 0.95,
      CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
      CONSOLIDATION_LINKAGE: 'average',
      CONSOLIDATION_MAX_CLUSTER_SIZE: 5,
      CONSOLIDATION_GAP_THRESHOLD: 0.15,
      CONSOLIDATION_DRY_RUN: false,
      CONSOLIDATION_EMBED_BATCH_SIZE: 100,
    }),
  )
  reloadBehaviorAuditConfig()

  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-settings-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: () => {
      embedCalled = true
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})

test('runPhase1b re-runs when min cluster size changed despite unchanged vocabulary size', async () => {
  applyBehaviorAuditEnv(
    createAuditBehaviorConfig(tempRoot, {
      EMBEDDING_MODEL: 'test-embed-model',
      CONSOLIDATION_THRESHOLD: 0.95,
      CONSOLIDATION_MIN_CLUSTER_SIZE: 3,
      CONSOLIDATION_DRY_RUN: false,
      CONSOLIDATION_EMBED_BATCH_SIZE: 100,
    }),
  )
  reloadBehaviorAuditConfig()

  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-min-cluster-size-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: () => {
      embedCalled = true
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})

test('runPhase1b re-runs when embedding model changed despite unchanged vocabulary size', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-embedding-model-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.embeddingModel = 'old-embedding-model'
  progress.phase1b.embeddingBaseUrl = 'http://localhost:1234/v1'
  progress.phase1b.embeddingCachePath = null
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: (_cachePath, model) => {
      embedCalled = true
      expect(model).toBe('test-embed-model')
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})

test('runPhase1b re-runs when embedding cache path changed despite unchanged vocabulary size', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-embedding-cache-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.embeddingModel = 'test-embed-model'
  progress.phase1b.embeddingBaseUrl = 'http://localhost:1234/v1'
  progress.phase1b.embeddingCachePath = '/old/cache.json'
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: (cachePath) => {
      embedCalled = true
      expect(cachePath).toBe('/new/cache.json')
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: '/new/cache.json',
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})

test('runPhase1b re-runs when embedding base URL changed despite unchanged vocabulary size', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-embedding-base-url-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.embeddingModel = 'test-embed-model'
  progress.phase1b.embeddingCachePath = null
  progress.phase1b.embeddingBaseUrl = 'http://old-embed.example/v1'
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: () => {
      embedCalled = true
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://new-embed.example/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})

test('runPhase1b skips phase2/3 reset when no merges produced', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase2a.status = 'done'
  progress.phase3.status = 'done'

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: () =>
      Promise.resolve({
        raw: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        normalized: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      }),
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(progress.phase1b.status).toBe('done')
  expect(progress.phase1b.stats.mergesApplied).toBe(0)
  expect(progress.phase2a.status).toBe('done')
  expect(progress.phase3.status).toBe('done')
})

test('runPhase1b dry-run does not save vocabulary or progress', async () => {
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN'] = '1'
  reloadBehaviorAuditConfig()

  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.stats.slugsBefore = 2

  let vocabSaved = false
  let progressSaved = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('short'), makeVocabEntry('longer-alias')]),
    saveKeywordVocabulary: () => {
      vocabSaved = true
      return Promise.resolve()
    },
    getOrEmbed: () => {
      const normVec = [0.99, 0.1, 0].map((v, _, arr) => v / Math.sqrt(arr.reduce((s, x) => s + x * x, 0)))
      return Promise.resolve({
        raw: [
          [1, 0, 0],
          [0.99, 0.1, 0],
        ],
        normalized: [[1, 0, 0], normVec],
      })
    },
    embeddingCachePath: null,
    embeddingBaseUrl: 'http://localhost:1234/v1',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => {
      progressSaved = true
      return Promise.resolve()
    },
    log: { log: () => {} },
  })

  expect(vocabSaved).toBe(false)
  expect(progressSaved).toBe(false)
  expect(progress.phase1b.status).toBe('done')
})

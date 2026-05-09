import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { extractedArtifactPathForTestFile } from '../../../scripts/behavior-audit/artifact-paths.js'
import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import type { ExtractedBehaviorRecord } from '../../../scripts/behavior-audit/extracted-store.js'
import { remapKeywordsInExtractedFile } from '../../../scripts/behavior-audit/extracted-store.js'
import { createAuditBehaviorConfig } from '../behavior-audit-integration.helpers.js'
import {
  applyBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  restoreBehaviorAuditEnv,
} from '../behavior-audit-integration.runtime-helpers.js'
import { makeExtractedRecord } from './test-fixtures.js'

function makeRecord(overrides: Partial<ExtractedBehaviorRecord> = {}): ExtractedBehaviorRecord {
  return makeExtractedRecord({
    behaviorId: 'bid-1',
    testKey: 'tests/foo.test.ts::does something',
    testFile: 'tests/foo.test.ts',
    domain: 'foo',
    testName: 'does something',
    fullPath: 'does something',
    behavior: 'When something happens',
    context: 'test context',
    keywords: ['existing-slug', 'another-slug'],
    ...overrides,
  })
}

function writeExtractedFixture(testFile: string, records: ExtractedBehaviorRecord[]): void {
  const artifactPath = extractedArtifactPathForTestFile(testFile)
  mkdirSync(dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(records, null, 2) + '\n')
}

let tempRoot: string
let extractedDir: string

beforeEach(() => {
  tempRoot = makeTempDir()
  const config = createAuditBehaviorConfig(tempRoot, null)
  extractedDir = config.EXTRACTED_DIR
  applyBehaviorAuditEnv(config)
  reloadBehaviorAuditConfig()
  mkdirSync(extractedDir, { recursive: true })
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

test('remapKeywordsInExtractedFile returns updated=false when file does not exist', async () => {
  const result = await remapKeywordsInExtractedFile('tests/nonexistent.test.ts', new Map())
  expect(result.updated).toBe(false)
  expect(result.remappedCount).toBe(0)
})

test('remapKeywordsInExtractedFile returns updated=false when no keywords match the merge map', async () => {
  const testFile = 'tests/foo.test.ts'
  writeExtractedFixture(testFile, [makeRecord({ keywords: ['a', 'b'] })])

  const mergeMap = new Map([['c', 'd']])
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(false)
  expect(result.remappedCount).toBe(0)
})

test('remapKeywordsInExtractedFile remaps keywords and returns updated=true', async () => {
  const testFile = 'tests/foo.test.ts'
  writeExtractedFixture(testFile, [makeRecord({ keywords: ['old-slug', 'keep-this'] })])

  const mergeMap = new Map([['old-slug', 'new-slug']])
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(true)
  expect(result.remappedCount).toBe(1)
})

test('remapKeywordsInExtractedFile deduplicates after remapping', async () => {
  const testFile = 'tests/foo.test.ts'
  writeExtractedFixture(testFile, [makeRecord({ keywords: ['canonical', 'alias'] })])

  const mergeMap = new Map([['alias', 'canonical']])
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(true)
  expect(result.remappedCount).toBe(1)
})

test('remapKeywordsInExtractedFile counts remapped occurrences across all records', async () => {
  const testFile = 'tests/bar.test.ts'
  writeExtractedFixture(testFile, [
    makeRecord({ behaviorId: 'bid-1', keywords: ['old', 'keep'] }),
    makeRecord({ behaviorId: 'bid-2', keywords: ['other', 'old'] }),
  ])

  const mergeMap = new Map([['old', 'canonical']])
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(true)
  expect(result.remappedCount).toBe(2)
})

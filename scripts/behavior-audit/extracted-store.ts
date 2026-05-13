import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { extractedArtifactPathForTestFile } from './artifact-paths.js'
import { remapKeywords } from './consolidate-keywords-helpers.js'

const EvidenceRefSchema = z
  .object({
    kind: z.enum([
      'test-source',
      'implementation-source',
      'helper-source',
      'manifest-dependency',
      'codeindex-symbol',
      'codeindex-reference',
    ]),
    filePath: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    snippet: z.string(),
    supports: z.enum(['behavior', 'context', 'keyword']),
    symbolKey: z.string().optional(),
    qualifiedName: z.string().optional(),
  })
  .strict()

const KeywordEvidenceSchema = z
  .object({
    keyword: z.string(),
    evidence: z.array(EvidenceRefSchema).readonly(),
    novelty: z.enum(['existing', 'new', 'uncertain']),
  })
  .strict()

const ExtractionConfidenceSchema = z
  .object({
    behavior: z.enum(['high', 'medium', 'low']),
    context: z.enum(['high', 'medium', 'low']),
    keywords: z.enum(['high', 'medium', 'low']),
    overall: z.enum(['high', 'medium', 'low']),
  })
  .strict()

const CodeindexQueryProvenanceSchema = z
  .object({
    tool: z.enum(['code_search', 'code_symbol', 'code_impact', 'code_index']),
    query: z.string(),
    resultCount: z.number(),
  })
  .strict()

const CodeindexProvenanceSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['direct', 'mcp', 'unavailable']),
    indexStatus: z.enum(['fresh', 'stale', 'missing', 'unknown']),
    queries: z.array(CodeindexQueryProvenanceSchema).readonly(),
  })
  .strict()

const ExtractionProvenanceSchema = z
  .object({
    promptVersion: z.string(),
    verifierVersion: z.string(),
    evidenceFilesRead: z.array(z.string()).readonly(),
    dependencyPaths: z.array(z.string()).readonly(),
    codeindex: CodeindexProvenanceSchema,
  })
  .strict()

const ExtractionVerificationSchema = z
  .object({
    behaviorVerdict: z.enum(['supported', 'partially-supported', 'unsupported', 'not-verified']),
    contextVerdict: z.enum(['supported', 'partially-supported', 'unsupported', 'not-verified']),
    keywordVerdict: z.enum(['supported', 'partially-supported', 'unsupported', 'not-verified']),
    notes: z.array(z.string()).readonly(),
  })
  .strict()

const ExtractedBehaviorRecordSchema = z
  .object({
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
    behaviorEvidence: z.array(EvidenceRefSchema).readonly(),
    contextEvidence: z.array(EvidenceRefSchema).readonly(),
    keywordEvidence: z.array(KeywordEvidenceSchema).readonly(),
    confidence: ExtractionConfidenceSchema,
    trustFlags: z
      .array(
        z.enum([
          'evidence-collection-failed',
          'extractor-used-inference',
          'unsupported-behavior-claim',
          'unsupported-context-claim',
          'weak-behavior-evidence',
          'weak-context-evidence',
          'guessed-implementation-path',
          'novel-keyword',
          'weak-keyword-evidence',
          'verification-failed',
          'verifier-disagreed',
        ]),
      )
      .readonly(),
    provenance: ExtractionProvenanceSchema,
    verification: ExtractionVerificationSchema,
  })
  .strict()
  .readonly()

const ExtractedBehaviorRecordArraySchema = z.array(ExtractedBehaviorRecordSchema).readonly()

export type ExtractedBehaviorRecord = z.infer<typeof ExtractedBehaviorRecordSchema>

export async function writeExtractedFile(
  testFilePath: string,
  records: readonly ExtractedBehaviorRecord[],
): Promise<void> {
  const outPath = extractedArtifactPathForTestFile(testFilePath)
  await mkdir(dirname(outPath), { recursive: true })
  const sortedRecords = [...records].toSorted((a, b) => a.behaviorId.localeCompare(b.behaviorId))
  await Bun.write(outPath, JSON.stringify(sortedRecords, null, 2) + '\n')
}

export async function readExtractedFile(testFilePath: string): Promise<readonly ExtractedBehaviorRecord[] | null> {
  const filePath = extractedArtifactPathForTestFile(testFilePath)
  try {
    await access(filePath, constants.F_OK)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }

  const raw: unknown = JSON.parse(await Bun.file(filePath).text())
  return ExtractedBehaviorRecordArraySchema.parse(raw)
}

export async function remapKeywordsInExtractedFile(
  testFilePath: string,
  mergeMap: ReadonlyMap<string, string>,
): Promise<{ readonly updated: boolean; readonly remappedCount: number }> {
  const records = await readExtractedFile(testFilePath)
  if (records === null) return { updated: false, remappedCount: 0 }

  const remapResults = records.map((record) => {
    const remappedCount = record.keywords.filter((kw) => mergeMap.has(kw)).length
    if (remappedCount === 0) return { record, changed: false, remappedCount: 0 }
    const newKeywords = remapKeywords(record.keywords, mergeMap)
    return { record: { ...record, keywords: newKeywords }, changed: true, remappedCount }
  })

  const totalRemapped = remapResults.reduce((sum, r) => sum + r.remappedCount, 0)
  const anyChanged = remapResults.some((r) => r.changed)

  if (!anyChanged) return { updated: false, remappedCount: 0 }

  await writeExtractedFile(
    testFilePath,
    remapResults.map((r) => r.record),
  )
  return { updated: true, remappedCount: totalRemapped }
}

import type { ExtractedBehaviorRecord } from '../../../scripts/behavior-audit/extracted-store.js'

const DEFAULT_TRUST_PROVENANCE = {
  promptVersion: 'test',
  verifierVersion: 'test',
  evidenceFilesRead: [] as readonly string[],
  dependencyPaths: [] as readonly string[],
  codeindex: {
    enabled: false,
    mode: 'unavailable' as const,
    indexStatus: 'unknown' as const,
    queries: [] as readonly never[],
  },
}

const DEFAULT_TRUST_VERIFICATION = {
  behaviorVerdict: 'not-verified' as const,
  contextVerdict: 'not-verified' as const,
  keywordVerdict: 'not-verified' as const,
  notes: [] as readonly string[],
}

const DEFAULT_TRUST_CONFIDENCE = {
  behavior: 'low' as const,
  context: 'low' as const,
  keywords: 'low' as const,
  overall: 'low' as const,
}

type RequiredFields =
  | 'behaviorId'
  | 'testKey'
  | 'testFile'
  | 'domain'
  | 'testName'
  | 'fullPath'
  | 'behavior'
  | 'context'
  | 'keywords'

export function makeExtractedRecord(
  overrides: Partial<ExtractedBehaviorRecord> & Pick<ExtractedBehaviorRecord, RequiredFields>,
): ExtractedBehaviorRecord {
  return {
    extractedAt: new Date().toISOString(),
    behaviorEvidence: [],
    contextEvidence: [],
    keywordEvidence: [],
    confidence: DEFAULT_TRUST_CONFIDENCE,
    trustFlags: [],
    provenance: DEFAULT_TRUST_PROVENANCE,
    verification: DEFAULT_TRUST_VERIFICATION,
    ...overrides,
  }
}

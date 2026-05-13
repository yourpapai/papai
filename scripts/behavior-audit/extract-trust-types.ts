export type EvidenceKind =
  | 'test-source'
  | 'implementation-source'
  | 'helper-source'
  | 'manifest-dependency'
  | 'codeindex-symbol'
  | 'codeindex-reference'

export interface EvidenceRef {
  readonly kind: EvidenceKind
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly snippet: string
  readonly supports: 'behavior' | 'context' | 'keyword'
  readonly symbolKey?: string
  readonly qualifiedName?: string
}

export interface KeywordEvidence {
  readonly keyword: string
  readonly evidence: readonly EvidenceRef[]
  readonly novelty: 'existing' | 'new' | 'uncertain'
}

export interface ExtractionConfidence {
  readonly behavior: 'high' | 'medium' | 'low'
  readonly context: 'high' | 'medium' | 'low'
  readonly keywords: 'high' | 'medium' | 'low'
  readonly overall: 'high' | 'medium' | 'low'
}

export type TrustFlag =
  | 'evidence-collection-failed'
  | 'extractor-used-inference'
  | 'unsupported-behavior-claim'
  | 'unsupported-context-claim'
  | 'weak-behavior-evidence'
  | 'weak-context-evidence'
  | 'guessed-implementation-path'
  | 'novel-keyword'
  | 'weak-keyword-evidence'
  | 'verification-failed'
  | 'verifier-disagreed'

export interface ExtractionProvenance {
  readonly promptVersion: string
  readonly verifierVersion: string
  readonly evidenceFilesRead: readonly string[]
  readonly dependencyPaths: readonly string[]
  readonly codeindex: CodeindexProvenance
}

export interface CodeindexProvenance {
  readonly enabled: boolean
  readonly mode: 'direct' | 'mcp' | 'unavailable'
  readonly indexStatus: 'fresh' | 'stale' | 'missing' | 'unknown'
  readonly queries: readonly CodeindexQueryProvenance[]
}

export interface CodeindexQueryProvenance {
  readonly tool: 'code_search' | 'code_symbol' | 'code_impact' | 'code_index'
  readonly query: string
  readonly resultCount: number
}

export interface ExtractionVerification {
  readonly behaviorVerdict: 'supported' | 'partially-supported' | 'unsupported' | 'not-verified'
  readonly contextVerdict: 'supported' | 'partially-supported' | 'unsupported' | 'not-verified'
  readonly keywordVerdict: 'supported' | 'partially-supported' | 'unsupported' | 'not-verified'
  readonly notes: readonly string[]
}

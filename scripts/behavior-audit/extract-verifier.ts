import type { ExtractionConfidence, ExtractionVerification, TrustFlag, EvidenceRef } from './extract-trust-types.js'

export interface VerifyExtractionInput {
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly behaviorClaimRefs: readonly {
    readonly evidenceIndex: number
    readonly claim: string
  }[]
  readonly contextClaimRefs: readonly {
    readonly evidenceIndex: number
    readonly claim: string
  }[]
  readonly uncertaintyNotes: readonly string[]
  readonly behaviorEvidence: readonly EvidenceRef[]
  readonly contextEvidence: readonly EvidenceRef[]
  readonly codeindexEnabled: boolean
}

export interface VerificationResult {
  readonly verification: ExtractionVerification
  readonly confidence: ExtractionConfidence
  readonly trustFlags: readonly TrustFlag[]
}

const verdictToConfidence = (verdict: ExtractionVerification['behaviorVerdict']): ExtractionConfidence['behavior'] =>
  verdict === 'supported' ? 'high' : verdict === 'partially-supported' ? 'medium' : 'low'

const minConfidence = (
  a: ExtractionConfidence['overall'],
  b: ExtractionConfidence['overall'],
): ExtractionConfidence['overall'] => {
  const rank = (v: ExtractionConfidence['overall']): number => (v === 'high' ? 3 : v === 'medium' ? 2 : 1)
  return rank(a) <= rank(b) ? a : b
}

const downgradeConfidence = (level: ExtractionConfidence['behavior']): ExtractionConfidence['behavior'] =>
  level === 'high' ? 'medium' : level === 'medium' ? 'low' : 'low'

const computeClaimVerdict = (
  claimRefs: readonly { readonly evidenceIndex: number }[],
  evidence: readonly EvidenceRef[],
): ExtractionVerification['behaviorVerdict'] => {
  if (evidence.length === 0) {
    return 'not-verified'
  }
  if (claimRefs.length === 0) {
    return 'unsupported'
  }
  const validCount = claimRefs.filter((ref) => ref.evidenceIndex >= 0 && ref.evidenceIndex < evidence.length).length
  if (validCount === claimRefs.length) {
    return 'supported'
  }
  if (validCount > 0) {
    return 'partially-supported'
  }
  return 'unsupported'
}

const computeContextVerdict = (
  claimRefs: readonly { readonly evidenceIndex: number }[],
  evidence: readonly EvidenceRef[],
  codeindexEnabled: boolean,
): ExtractionVerification['contextVerdict'] => {
  if (evidence.length === 0) {
    return 'not-verified'
  }
  if (claimRefs.length === 0) {
    return 'unsupported'
  }
  const validCount = claimRefs.filter((ref) => ref.evidenceIndex >= 0 && ref.evidenceIndex < evidence.length).length
  if (validCount === claimRefs.length) {
    if (evidence.every((e) => e.kind === 'manifest-dependency')) {
      return codeindexEnabled ? 'supported' : 'partially-supported'
    }
    return 'supported'
  }
  if (validCount > 0) {
    return 'partially-supported'
  }
  return 'unsupported'
}

const computeKeywordVerdict = (keywords: readonly string[]): ExtractionVerification['keywordVerdict'] => {
  if (keywords.length === 0) {
    return 'not-verified'
  }
  if (keywords.length >= 3) {
    return 'supported'
  }
  return 'partially-supported'
}

const computeTrustFlags = (
  input: VerifyExtractionInput,
  behaviorVerdict: ExtractionVerification['behaviorVerdict'],
  contextVerdict: ExtractionVerification['contextVerdict'],
): readonly TrustFlag[] => {
  const flags: readonly TrustFlag[] = [
    ...(input.behaviorEvidence.length === 0 ? (['evidence-collection-failed'] as const) : []),
    ...(input.behaviorClaimRefs.length === 0 && input.behavior.length > 0
      ? (['extractor-used-inference'] as const)
      : []),
    ...(behaviorVerdict === 'unsupported' ? (['unsupported-behavior-claim'] as const) : []),
    ...(contextVerdict === 'unsupported' ? (['unsupported-context-claim'] as const) : []),
    ...(behaviorVerdict === 'partially-supported' ? (['weak-behavior-evidence'] as const) : []),
    ...(contextVerdict === 'partially-supported' ? (['weak-context-evidence'] as const) : []),
    ...(input.codeindexEnabled ? [] : (['guessed-implementation-path'] as const)),
    ...(input.uncertaintyNotes.length > 0 ? (['extractor-used-inference'] as const) : []),
  ]
  return [...new Set(flags)]
}

const computeNotes = (
  input: VerifyExtractionInput,
  behaviorVerdict: ExtractionVerification['behaviorVerdict'],
  contextVerdict: ExtractionVerification['contextVerdict'],
): readonly string[] => [
  ...(input.behaviorEvidence.length === 0 ? (['No behavior evidence collected'] as const) : []),
  ...(input.behaviorClaimRefs.length === 0 && input.behavior.length > 0
    ? (['Extractor inferred behavior without evidence refs'] as const)
    : []),
  ...(behaviorVerdict === 'unsupported' ? (['Behavior claims have no supporting evidence'] as const) : []),
  ...(behaviorVerdict === 'partially-supported' ? (['Some behavior claims lack evidence refs'] as const) : []),
  ...(contextVerdict === 'unsupported' ? (['Context claims have no supporting evidence'] as const) : []),
  ...(contextVerdict === 'partially-supported' ? (['Some context claims lack evidence refs'] as const) : []),
  ...(input.codeindexEnabled ? [] : (['Codeindex unavailable; implementation paths inferred'] as const)),
  ...(input.codeindexEnabled
    ? []
    : input.contextEvidence.length > 0 && input.contextEvidence.every((e) => e.kind === 'manifest-dependency')
      ? (['Context evidence limited to manifest dependencies'] as const)
      : []),
  ...input.uncertaintyNotes,
]

export const verifyExtraction = (input: VerifyExtractionInput): VerificationResult => {
  const behaviorVerdict = computeClaimVerdict(input.behaviorClaimRefs, input.behaviorEvidence)
  const contextVerdict = computeContextVerdict(input.contextClaimRefs, input.contextEvidence, input.codeindexEnabled)
  const keywordVerdict = computeKeywordVerdict(input.keywords)

  const rawBehaviorConfidence = verdictToConfidence(behaviorVerdict)
  const rawContextConfidence = verdictToConfidence(contextVerdict)
  const contextConfidence = input.codeindexEnabled ? rawContextConfidence : downgradeConfidence(rawContextConfidence)
  const keywordConfidence = verdictToConfidence(keywordVerdict)
  const overall = minConfidence(minConfidence(rawBehaviorConfidence, contextConfidence), keywordConfidence)

  const trustFlags = computeTrustFlags(input, behaviorVerdict, contextVerdict)
  const notes = computeNotes(input, behaviorVerdict, contextVerdict)

  return {
    verification: {
      behaviorVerdict,
      contextVerdict,
      keywordVerdict,
      notes,
    },
    confidence: {
      behavior: rawBehaviorConfidence,
      context: contextConfidence,
      keywords: keywordConfidence,
      overall,
    },
    trustFlags,
  }
}

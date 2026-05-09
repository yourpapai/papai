import type * as ClassifiedStoreModule from '../../scripts/behavior-audit/classified-store.js'
import type * as ClassifyAgentModule from '../../scripts/behavior-audit/classify-agent.js'
import type * as ConsolidateKeywordsModule from '../../scripts/behavior-audit/consolidate-keywords.js'
import type * as ConsolidateModule from '../../scripts/behavior-audit/consolidate.js'
import type * as EvaluateReportingModule from '../../scripts/behavior-audit/evaluate-reporting.js'
import type * as EvaluateModule from '../../scripts/behavior-audit/evaluate.js'
import type * as ExtractModule from '../../scripts/behavior-audit/extract.js'
import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'
import type * as KeywordVocabularyModule from '../../scripts/behavior-audit/keyword-vocabulary.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import type * as ProgressModule from '../../scripts/behavior-audit/progress.js'
import type * as ReportWriterModule from '../../scripts/behavior-audit/report-writer.js'
import type * as ResetModule from '../../scripts/behavior-audit/reset.js'

export type IncrementalModuleShape = typeof IncrementalModule
export type ProgressModuleShape = typeof ProgressModule
export type ExtractModuleShape = typeof ExtractModule
export type ClassifyAgentModuleShape = typeof ClassifyAgentModule
export type EvaluateModuleShape = typeof EvaluateModule
export type EvaluateReportingModuleShape = typeof EvaluateReportingModule
export type ConsolidateModuleShape = typeof ConsolidateModule
export type ConsolidateKeywordsModuleShape = typeof ConsolidateKeywordsModule
export type ClassifiedStoreModuleShape = typeof ClassifiedStoreModule
export type KeywordVocabularyModuleShape = typeof KeywordVocabularyModule
export type ReportWriterModuleShape = typeof ReportWriterModule
export type ResetModuleShape = typeof ResetModule
export type ManifestTestEntry = IncrementalManifest['tests'][string]
export type MockEvaluationResult = Awaited<
  ReturnType<(typeof import('../../scripts/behavior-audit/evaluate-agent.js'))['evaluateWithRetry']>
>

export function hasFunctionProperty(value: Record<string, unknown>, key: string): boolean {
  return key in value && typeof value[key] === 'function'
}

export function createEmptyManifest(): IncrementalManifest {
  return {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: '', phase2: '', reports: '' },
    tests: {},
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringOrNull(value: unknown): value is string | null {
  if (typeof value === 'string') {
    return true
  }
  return value === null
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
}

function isManifestTestEntry(value: unknown): value is ManifestTestEntry {
  return (
    isObject(value) &&
    'testFile' in value &&
    typeof value['testFile'] === 'string' &&
    'testName' in value &&
    typeof value['testName'] === 'string' &&
    'dependencyPaths' in value &&
    isStringArray(value['dependencyPaths']) &&
    'phase1Fingerprint' in value &&
    isStringOrNull(value['phase1Fingerprint']) &&
    'phase2aFingerprint' in value &&
    isStringOrNull(value['phase2aFingerprint']) &&
    'phase2Fingerprint' in value &&
    isStringOrNull(value['phase2Fingerprint']) &&
    'behaviorId' in value &&
    isStringOrNull(value['behaviorId']) &&
    'featureKey' in value &&
    isStringOrNull(value['featureKey']) &&
    'extractedArtifactPath' in value &&
    isStringOrNull(value['extractedArtifactPath']) &&
    'classifiedArtifactPath' in value &&
    isStringOrNull(value['classifiedArtifactPath']) &&
    'domain' in value &&
    typeof value['domain'] === 'string' &&
    'lastPhase1CompletedAt' in value &&
    isStringOrNull(value['lastPhase1CompletedAt']) &&
    'lastPhase2aCompletedAt' in value &&
    isStringOrNull(value['lastPhase2aCompletedAt']) &&
    'lastPhase2CompletedAt' in value &&
    isStringOrNull(value['lastPhase2CompletedAt'])
  )
}

function isIncrementalManifest(value: unknown): value is IncrementalManifest {
  if (!isObject(value)) {
    return false
  }
  if (!('version' in value) || value['version'] !== 1) {
    return false
  }
  if (!('lastStartCommit' in value) || !isStringOrNull(value['lastStartCommit'])) {
    return false
  }
  if (!('lastStartedAt' in value) || !isStringOrNull(value['lastStartedAt'])) {
    return false
  }
  if (!('lastCompletedAt' in value) || !isStringOrNull(value['lastCompletedAt'])) {
    return false
  }
  if (!('phaseVersions' in value) || !isObject(value['phaseVersions'])) {
    return false
  }
  const phaseVersions = value['phaseVersions']
  if (
    !('phase1' in phaseVersions) ||
    typeof phaseVersions['phase1'] !== 'string' ||
    !('phase2' in phaseVersions) ||
    typeof phaseVersions['phase2'] !== 'string' ||
    !('reports' in phaseVersions) ||
    typeof phaseVersions['reports'] !== 'string'
  ) {
    return false
  }
  if (!('tests' in value) || !isObject(value['tests'])) {
    return false
  }
  return Object.values(value['tests']).every((entry) => isManifestTestEntry(entry))
}

function isIncrementalModule(value: unknown): value is IncrementalModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'createEmptyManifest') &&
    hasFunctionProperty(value, 'captureRunStart') &&
    hasFunctionProperty(value, 'loadManifest') &&
    hasFunctionProperty(value, 'saveManifest') &&
    hasFunctionProperty(value, 'collectChangedFiles') &&
    hasFunctionProperty(value, 'selectIncrementalWork')
  )
}

function isProgressModule(value: unknown): value is ProgressModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'loadProgress') &&
    hasFunctionProperty(value, 'createEmptyProgress') &&
    hasFunctionProperty(value, 'saveProgress')
  )
}

function isExtractModule(value: unknown): value is ExtractModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase1')
}

function isEvaluateModule(value: unknown): value is EvaluateModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase3')
}

function isEvaluateReportingModule(value: unknown): value is EvaluateReportingModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'writeReports')
}

export async function importWithGuard<T>(
  specifier: string,
  guard: (value: unknown) => value is T,
  errorMessage: string,
): Promise<T> {
  const mod: unknown = await import(specifier)
  if (!guard(mod)) {
    throw new Error(errorMessage)
  }
  return mod
}

export function getArrayItem<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) {
    throw new Error(`Expected array item at index ${index}`)
  }
  return value
}

export function getManifestEntry(manifest: IncrementalManifest, key: string): ManifestTestEntry {
  const entry = manifest.tests[key]
  if (entry === undefined) {
    throw new Error(`Expected manifest entry for ${key}`)
  }
  return entry
}

export async function readSavedManifest(filePath: string): Promise<IncrementalManifest> {
  const raw: unknown = JSON.parse(await Bun.file(filePath).text())
  if (!isIncrementalManifest(raw)) {
    throw new Error('Unexpected manifest shape')
  }
  return raw
}

export function loadIncrementalModule(tag: string): Promise<IncrementalModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/incremental.js?test=${tag}`,
    isIncrementalModule,
    'Unexpected incremental module shape',
  )
}

export function loadProgressModule(tag: string): Promise<ProgressModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/progress.js?test=${tag}`,
    isProgressModule,
    'Unexpected progress module shape',
  )
}

export function loadExtractModule(tag: string): Promise<ExtractModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/extract.js?test=${tag}`,
    isExtractModule,
    'Unexpected extract module shape',
  )
}

export function loadEvaluateModule(tag: string): Promise<EvaluateModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/evaluate.js?test=${tag}`,
    isEvaluateModule,
    'Unexpected evaluate module shape',
  )
}

export function loadEvaluateReportingModule(tag: string): Promise<EvaluateReportingModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/evaluate-reporting.js?test=${tag}`,
    isEvaluateReportingModule,
    'Unexpected evaluate-reporting module shape',
  )
}

function isConsolidateModule(value: unknown): value is ConsolidateModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase2b')
}

export function isClassifyModule(value: unknown): value is {
  readonly runPhase2a: (
    input: {
      readonly progress: Progress
      readonly selectedTestKeys: ReadonlySet<string>
      readonly manifest: IncrementalManifest
    },
    deps?: unknown,
  ) => Promise<ReadonlySet<string>>
} {
  return isObject(value) && hasFunctionProperty(value, 'runPhase2a')
}

function isClassifyAgentModule(value: unknown): value is ClassifyAgentModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'classifyBehaviorWithRetry')
}

function isClassifiedStoreModule(value: unknown): value is ClassifiedStoreModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'writeClassifiedFile') &&
    hasFunctionProperty(value, 'readClassifiedFile')
  )
}

function isKeywordVocabularyModule(value: unknown): value is KeywordVocabularyModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'loadKeywordVocabulary') &&
    hasFunctionProperty(value, 'saveKeywordVocabulary')
  )
}

export function isReportWriterModule(value: unknown): value is ReportWriterModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'writeConsolidatedFile')
}

export function isResetModule(value: unknown): value is ResetModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'resetBehaviorAudit')
}

export function loadConsolidateModule(tag: string): Promise<ConsolidateModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/consolidate.js?test=${tag}`,
    isConsolidateModule,
    'Unexpected consolidate module shape',
  )
}

export function loadClassifyAgentModule(tag: string): Promise<ClassifyAgentModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/classify-agent.js?test=${tag}`,
    isClassifyAgentModule,
    'Unexpected classify-agent module shape',
  )
}

export function loadClassifiedStoreModule(tag: string): Promise<ClassifiedStoreModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/classified-store.js?test=${tag}`,
    isClassifiedStoreModule,
    'Unexpected classified-store module shape',
  )
}

export function loadKeywordVocabularyModule(tag: string): Promise<KeywordVocabularyModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/keyword-vocabulary.js?test=${tag}`,
    isKeywordVocabularyModule,
    'Unexpected keyword vocabulary module shape',
  )
}

export function loadReportWriterModule(tag: string): Promise<ReportWriterModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/report-writer.js?test=${tag}`,
    isReportWriterModule,
    'Unexpected report writer module shape',
  )
}

export function loadResetModule(tag: string): Promise<ResetModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/reset.js?test=${tag}`,
    isResetModule,
    'Unexpected reset module shape',
  )
}

function isConsolidateKeywordsModule(value: unknown): value is ConsolidateKeywordsModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase1b')
}

export function loadConsolidateKeywordsModule(tag: string): Promise<ConsolidateKeywordsModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/consolidate-keywords.js?test=${tag}`,
    isConsolidateKeywordsModule,
    'Unexpected consolidate-keywords module shape',
  )
}

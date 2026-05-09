import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type { ConsolidatedManifest, IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { applyBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'

type ManifestTestEntry = IncrementalManifest['tests'][string]
type ConsolidatedManifestEntry = ConsolidatedManifest['entries'][string]

export interface BehaviorAuditTestPaths {
  readonly root: string
  readonly reportsDir: string
  readonly auditBehaviorDir: string
  readonly extractedDir: string
  readonly classifiedDir: string
  readonly consolidatedDir: string
  readonly evaluatedDir: string
  readonly storiesDir: string
  readonly progressPath: string
  readonly incrementalManifestPath: string
  readonly consolidatedManifestPath: string
  readonly keywordVocabularyPath: string
}

export interface BehaviorAuditTestConfig {
  readonly MODEL: string
  readonly BASE_URL: string
  readonly PROJECT_ROOT: string
  readonly REPORTS_DIR: string
  readonly AUDIT_BEHAVIOR_DIR: string
  readonly EXTRACTED_DIR: string
  readonly CLASSIFIED_DIR: string
  readonly CONSOLIDATED_DIR: string
  readonly EVALUATED_DIR: string
  readonly STORIES_DIR: string
  readonly PROGRESS_PATH: string
  readonly INCREMENTAL_MANIFEST_PATH: string
  readonly CONSOLIDATED_MANIFEST_PATH: string
  readonly KEYWORD_VOCABULARY_PATH: string
  readonly PHASE1_TIMEOUT_MS: number
  readonly PHASE2_TIMEOUT_MS: number
  readonly PHASE3_TIMEOUT_MS: number
  readonly MAX_RETRIES: number
  readonly RETRY_BACKOFF_MS: readonly [number, number, number]
  readonly MAX_STEPS: number
  readonly EXCLUDED_PREFIXES: readonly string[]
  readonly EMBEDDING_MODEL: string
  readonly EMBEDDING_BASE_URL: string
  readonly CONSOLIDATION_THRESHOLD: number
  readonly CONSOLIDATION_MIN_CLUSTER_SIZE: number
  readonly CONSOLIDATION_LINKAGE: 'single' | 'average' | 'complete'
  readonly CONSOLIDATION_MAX_CLUSTER_SIZE: number
  readonly CONSOLIDATION_GAP_THRESHOLD: number
  readonly CONSOLIDATION_DRY_RUN: boolean
  readonly CONSOLIDATION_EMBED_BATCH_SIZE: number
}

const DEFAULT_CONFIG = {
  MODEL: 'qwen3-30b-a3b',
  BASE_URL: 'http://localhost:1234/v1',
  PHASE1_TIMEOUT_MS: 1_200_000,
  PHASE2_TIMEOUT_MS: 300_000,
  PHASE3_TIMEOUT_MS: 600_000,
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: [0, 0, 0] as const,
  MAX_STEPS: 20,
  EXCLUDED_PREFIXES: [
    'tests/e2e/',
    'tests/client/',
    'tests/helpers/',
    'tests/scripts/',
    'tests/review-loop/',
    'tests/types/',
  ] as const,
  EMBEDDING_MODEL: '',
  EMBEDDING_BASE_URL: 'http://localhost:1234/v1',
  CONSOLIDATION_THRESHOLD: 0.92,
  CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
  CONSOLIDATION_LINKAGE: 'single',
  CONSOLIDATION_MAX_CLUSTER_SIZE: 0,
  CONSOLIDATION_GAP_THRESHOLD: 0,
  CONSOLIDATION_DRY_RUN: false,
  CONSOLIDATION_EMBED_BATCH_SIZE: 100,
} satisfies Omit<
  BehaviorAuditTestConfig,
  | 'PROJECT_ROOT'
  | 'REPORTS_DIR'
  | 'AUDIT_BEHAVIOR_DIR'
  | 'EXTRACTED_DIR'
  | 'CLASSIFIED_DIR'
  | 'CONSOLIDATED_DIR'
  | 'EVALUATED_DIR'
  | 'STORIES_DIR'
  | 'PROGRESS_PATH'
  | 'INCREMENTAL_MANIFEST_PATH'
  | 'CONSOLIDATED_MANIFEST_PATH'
  | 'KEYWORD_VOCABULARY_PATH'
>

function createPaths(root: string, auditBehaviorRoot: boolean): BehaviorAuditTestPaths {
  const reportsDir = path.join(root, 'reports')
  const auditBehaviorDir = auditBehaviorRoot ? path.join(reportsDir, 'audit-behavior') : reportsDir

  return {
    root,
    reportsDir,
    auditBehaviorDir,
    extractedDir: path.join(auditBehaviorDir, 'extracted'),
    classifiedDir: path.join(auditBehaviorDir, 'classified'),
    consolidatedDir: path.join(auditBehaviorDir, 'consolidated'),
    evaluatedDir: path.join(auditBehaviorDir, 'evaluated'),
    storiesDir: path.join(auditBehaviorDir, 'stories'),
    progressPath: path.join(auditBehaviorDir, 'progress.json'),
    incrementalManifestPath: path.join(auditBehaviorDir, 'incremental-manifest.json'),
    consolidatedManifestPath: path.join(auditBehaviorDir, 'consolidated-manifest.json'),
    keywordVocabularyPath: path.join(auditBehaviorDir, 'keyword-vocabulary.json'),
  }
}

export function createReportsPaths(root: string): BehaviorAuditTestPaths {
  return createPaths(root, false)
}

export function createAuditBehaviorPaths(root: string): BehaviorAuditTestPaths {
  return createPaths(root, true)
}

function createConfig(
  paths: BehaviorAuditTestPaths,
  overrides: Partial<BehaviorAuditTestConfig> | null,
): BehaviorAuditTestConfig {
  let resolvedOverrides: Partial<BehaviorAuditTestConfig>
  if (overrides === null) {
    resolvedOverrides = {}
  } else {
    resolvedOverrides = overrides
  }
  return {
    ...DEFAULT_CONFIG,
    PROJECT_ROOT: paths.root,
    REPORTS_DIR: paths.reportsDir,
    AUDIT_BEHAVIOR_DIR: paths.auditBehaviorDir,
    EXTRACTED_DIR: paths.extractedDir,
    CLASSIFIED_DIR: paths.classifiedDir,
    CONSOLIDATED_DIR: paths.consolidatedDir,
    EVALUATED_DIR: paths.evaluatedDir,
    STORIES_DIR: paths.storiesDir,
    PROGRESS_PATH: paths.progressPath,
    INCREMENTAL_MANIFEST_PATH: paths.incrementalManifestPath,
    CONSOLIDATED_MANIFEST_PATH: paths.consolidatedManifestPath,
    KEYWORD_VOCABULARY_PATH: paths.keywordVocabularyPath,
    ...resolvedOverrides,
  }
}

export function createReportsConfig(
  root: string,
  overrides: Partial<BehaviorAuditTestConfig> | null,
): BehaviorAuditTestConfig {
  return createConfig(createReportsPaths(root), overrides)
}

export function createAuditBehaviorConfig(
  root: string,
  overrides: Partial<BehaviorAuditTestConfig> | null,
): BehaviorAuditTestConfig {
  return createConfig(createAuditBehaviorPaths(root), overrides)
}

export function mockReportsConfig(root: string, overrides: Partial<BehaviorAuditTestConfig> | null): void {
  applyBehaviorAuditEnv(createReportsConfig(root, overrides))
  reloadBehaviorAuditConfig()
}

export function mockAuditBehaviorConfig(root: string, overrides: Partial<BehaviorAuditTestConfig> | null): void {
  applyBehaviorAuditEnv(createAuditBehaviorConfig(root, overrides))
  reloadBehaviorAuditConfig()
}

export function createEmptyProgressFixture(filesTotal: number): Progress {
  return {
    version: 5,
    startedAt: '2026-04-17T12:00:00.000Z',
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase1b: {
      status: 'not-started',
      lastRunAt: null,
      threshold: 0,
      minClusterSize: 2,
      linkage: 'single',
      maxClusterSize: 0,
      gapThreshold: 0,
      embeddingModel: '',
      embeddingBaseUrl: '',
      embeddingCachePath: null,
      stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
    },
    phase2a: {
      status: 'not-started',
      completedBehaviors: {},
      failedBehaviors: {},
      stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
    },
    phase2b: {
      status: 'not-started',
      completedFeatureKeys: {},
      failedFeatureKeys: {},
      stats: {
        featureKeysTotal: 0,
        featureKeysDone: 0,
        featureKeysFailed: 0,
        behaviorsConsolidated: 0,
      },
    },
    phase3: {
      status: 'not-started',
      completedConsolidatedIds: {},
      failedConsolidatedIds: {},
      stats: {
        consolidatedIdsTotal: 0,
        consolidatedIdsDone: 0,
        consolidatedIdsFailed: 0,
      },
    },
  }
}

export function writeWorkspaceFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

export function createManifestTestEntry(
  input: Omit<
    ManifestTestEntry,
    | 'phase2aFingerprint'
    | 'behaviorId'
    | 'featureKey'
    | 'extractedArtifactPath'
    | 'classifiedArtifactPath'
    | 'lastPhase2aCompletedAt'
  > &
    Partial<
      Pick<
        ManifestTestEntry,
        | 'phase2aFingerprint'
        | 'behaviorId'
        | 'featureKey'
        | 'extractedArtifactPath'
        | 'classifiedArtifactPath'
        | 'lastPhase2aCompletedAt'
      >
    >,
): ManifestTestEntry {
  return {
    phase2aFingerprint: null,
    behaviorId: null,
    featureKey: null,
    extractedArtifactPath: null,
    classifiedArtifactPath: null,
    lastPhase2aCompletedAt: null,
    ...input,
  }
}

export function createIncrementalManifestFixture(
  input:
    | (Partial<Omit<IncrementalManifest, 'tests' | 'phaseVersions'>> & {
        readonly phaseVersions: IncrementalManifest['phaseVersions']
        readonly tests: Record<string, ManifestTestEntry>
      })
    | null,
): IncrementalManifest {
  let resolvedInput: Partial<Omit<IncrementalManifest, 'tests' | 'phaseVersions'>> & {
    readonly phaseVersions: IncrementalManifest['phaseVersions']
    readonly tests: Record<string, ManifestTestEntry>
  }
  if (input === null) {
    resolvedInput = {
      phaseVersions: { phase1: '', phase2: '', reports: '' },
      tests: {},
    }
  } else {
    resolvedInput = input
  }
  return {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    ...resolvedInput,
  }
}

export function createConsolidatedManifestEntry(
  input: Omit<
    ConsolidatedManifestEntry,
    'sourceBehaviorIds' | 'supportingInternalBehaviorIds' | 'featureKey' | 'keywords' | 'sourceDomains'
  > &
    Partial<
      Pick<
        ConsolidatedManifestEntry,
        | 'sourceBehaviorIds'
        | 'supportingInternalBehaviorIds'
        | 'featureKey'
        | 'keywords'
        | 'sourceDomains'
        | 'consolidatedArtifactPath'
        | 'evaluatedArtifactPath'
        | 'phase3Fingerprint'
        | 'lastEvaluatedAt'
      >
    >,
): ConsolidatedManifestEntry {
  return {
    sourceBehaviorIds: [],
    supportingInternalBehaviorIds: [],
    featureKey: 'test-feature',
    consolidatedArtifactPath: null,
    evaluatedArtifactPath: null,
    keywords: [],
    sourceDomains: [],
    phase3Fingerprint: null,
    lastEvaluatedAt: null,
    ...input,
  }
}

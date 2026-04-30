import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type { BehaviorAuditTestConfig } from './behavior-audit-integration.helpers.js'

const tempDirs: string[] = []
const behaviorAuditEnvKeys = [
  'BEHAVIOR_AUDIT_MODEL',
  'BEHAVIOR_AUDIT_BASE_URL',
  'BEHAVIOR_AUDIT_PROJECT_ROOT',
  'BEHAVIOR_AUDIT_REPORTS_DIR',
  'BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR',
  'BEHAVIOR_AUDIT_EXTRACTED_DIR',
  'BEHAVIOR_AUDIT_CLASSIFIED_DIR',
  'BEHAVIOR_AUDIT_CONSOLIDATED_DIR',
  'BEHAVIOR_AUDIT_EVALUATED_DIR',
  'BEHAVIOR_AUDIT_STORIES_DIR',
  'BEHAVIOR_AUDIT_PROGRESS_PATH',
  'BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH',
  'BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH',
  'BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH',
  'BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS',
  'BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS',
  'BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS',
  'BEHAVIOR_AUDIT_MAX_RETRIES',
  'BEHAVIOR_AUDIT_MAX_STEPS',
  'BEHAVIOR_AUDIT_EXCLUDED_PREFIXES',
  'BEHAVIOR_AUDIT_EMBEDDING_MODEL',
  'BEHAVIOR_AUDIT_EMBEDDING_BASE_URL',
  'BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD',
  'BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE',
  'BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN',
  'BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE',
  'BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE',
  'BEHAVIOR_AUDIT_CONSOLIDATION_MAX_CLUSTER_SIZE',
  'BEHAVIOR_AUDIT_CONSOLIDATION_GAP_THRESHOLD',
] as const
const originalBehaviorAuditEnv = new Map(behaviorAuditEnvKeys.map((key) => [key, process.env[key]]))

function clearBehaviorAuditEnvKey(key: (typeof behaviorAuditEnvKeys)[number]): void {
  switch (key) {
    case 'BEHAVIOR_AUDIT_MODEL':
      delete process.env['BEHAVIOR_AUDIT_MODEL']
      return
    case 'BEHAVIOR_AUDIT_BASE_URL':
      delete process.env['BEHAVIOR_AUDIT_BASE_URL']
      return
    case 'BEHAVIOR_AUDIT_PROJECT_ROOT':
      delete process.env['BEHAVIOR_AUDIT_PROJECT_ROOT']
      return
    case 'BEHAVIOR_AUDIT_REPORTS_DIR':
      delete process.env['BEHAVIOR_AUDIT_REPORTS_DIR']
      return
    case 'BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR':
      delete process.env['BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR']
      return
    case 'BEHAVIOR_AUDIT_EXTRACTED_DIR':
      delete process.env['BEHAVIOR_AUDIT_EXTRACTED_DIR']
      return
    case 'BEHAVIOR_AUDIT_CLASSIFIED_DIR':
      delete process.env['BEHAVIOR_AUDIT_CLASSIFIED_DIR']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATED_DIR':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATED_DIR']
      return
    case 'BEHAVIOR_AUDIT_EVALUATED_DIR':
      delete process.env['BEHAVIOR_AUDIT_EVALUATED_DIR']
      return
    case 'BEHAVIOR_AUDIT_STORIES_DIR':
      delete process.env['BEHAVIOR_AUDIT_STORIES_DIR']
      return
    case 'BEHAVIOR_AUDIT_PROGRESS_PATH':
      delete process.env['BEHAVIOR_AUDIT_PROGRESS_PATH']
      return
    case 'BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH':
      delete process.env['BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH']
      return
    case 'BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH':
      delete process.env['BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH']
      return
    case 'BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS':
      delete process.env['BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS']
      return
    case 'BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS':
      delete process.env['BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS']
      return
    case 'BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS':
      delete process.env['BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS']
      return
    case 'BEHAVIOR_AUDIT_MAX_RETRIES':
      delete process.env['BEHAVIOR_AUDIT_MAX_RETRIES']
      return
    case 'BEHAVIOR_AUDIT_MAX_STEPS':
      delete process.env['BEHAVIOR_AUDIT_MAX_STEPS']
      return
    case 'BEHAVIOR_AUDIT_EXCLUDED_PREFIXES':
      delete process.env['BEHAVIOR_AUDIT_EXCLUDED_PREFIXES']
      return
    case 'BEHAVIOR_AUDIT_EMBEDDING_MODEL':
      delete process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL']
      return
    case 'BEHAVIOR_AUDIT_EMBEDDING_BASE_URL':
      delete process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_MAX_CLUSTER_SIZE':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_MAX_CLUSTER_SIZE']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_GAP_THRESHOLD':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_GAP_THRESHOLD']
  }
}

export const originalOpenAiApiKey = process.env['OPENAI_API_KEY']

export function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-audit-integration-'))
  tempDirs.push(dir)
  return dir
}

export function restoreOpenAiApiKey(): void {
  if (originalOpenAiApiKey === undefined) {
    delete process.env['OPENAI_API_KEY']
    return
  }
  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
}

export function applyBehaviorAuditEnv(config: BehaviorAuditTestConfig): void {
  process.env['BEHAVIOR_AUDIT_MODEL'] = config.MODEL
  process.env['BEHAVIOR_AUDIT_BASE_URL'] = config.BASE_URL
  process.env['BEHAVIOR_AUDIT_PROJECT_ROOT'] = config.PROJECT_ROOT
  process.env['BEHAVIOR_AUDIT_REPORTS_DIR'] = config.REPORTS_DIR
  process.env['BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR'] = config.AUDIT_BEHAVIOR_DIR
  process.env['BEHAVIOR_AUDIT_EXTRACTED_DIR'] = config.EXTRACTED_DIR
  process.env['BEHAVIOR_AUDIT_CLASSIFIED_DIR'] = config.CLASSIFIED_DIR
  process.env['BEHAVIOR_AUDIT_CONSOLIDATED_DIR'] = config.CONSOLIDATED_DIR
  process.env['BEHAVIOR_AUDIT_EVALUATED_DIR'] = config.EVALUATED_DIR
  process.env['BEHAVIOR_AUDIT_STORIES_DIR'] = config.STORIES_DIR
  process.env['BEHAVIOR_AUDIT_PROGRESS_PATH'] = config.PROGRESS_PATH
  process.env['BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH'] = config.INCREMENTAL_MANIFEST_PATH
  process.env['BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH'] = config.CONSOLIDATED_MANIFEST_PATH
  process.env['BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH'] = config.KEYWORD_VOCABULARY_PATH
  process.env['BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS'] = String(config.PHASE1_TIMEOUT_MS)
  process.env['BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS'] = String(config.PHASE2_TIMEOUT_MS)
  process.env['BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS'] = String(config.PHASE3_TIMEOUT_MS)
  process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = String(config.MAX_RETRIES)
  process.env['BEHAVIOR_AUDIT_MAX_STEPS'] = String(config.MAX_STEPS)
  process.env['BEHAVIOR_AUDIT_EXCLUDED_PREFIXES'] = config.EXCLUDED_PREFIXES.join('\n')
  process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL'] = config.EMBEDDING_MODEL
  process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL'] = config.EMBEDDING_BASE_URL
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD'] = String(config.CONSOLIDATION_THRESHOLD)
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE'] = String(config.CONSOLIDATION_MIN_CLUSTER_SIZE)
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE'] = config.CONSOLIDATION_LINKAGE
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_MAX_CLUSTER_SIZE'] = String(config.CONSOLIDATION_MAX_CLUSTER_SIZE)
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_GAP_THRESHOLD'] = String(config.CONSOLIDATION_GAP_THRESHOLD)
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN'] = config.CONSOLIDATION_DRY_RUN ? '1' : '0'
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE'] = String(config.CONSOLIDATION_EMBED_BATCH_SIZE)
}

export function restoreBehaviorAuditEnv(): void {
  for (const key of behaviorAuditEnvKeys) {
    const originalValue = originalBehaviorAuditEnv.get(key)
    if (originalValue === undefined) {
      clearBehaviorAuditEnvKey(key)
      continue
    }
    process.env[key] = originalValue
  }

  reloadBehaviorAuditConfig()
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

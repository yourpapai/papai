import { resolve } from 'node:path'

import type { LinkageMode } from './consolidate-keywords-helpers.js'

const DEFAULT_PROJECT_ROOT = resolve(import.meta.dir, '../..')
const DEFAULT_REPORTS_DIR = resolve(DEFAULT_PROJECT_ROOT, 'reports')
const DEFAULT_AUDIT_BEHAVIOR_DIR = resolve(DEFAULT_REPORTS_DIR, 'audit-behavior')
const DEFAULT_EXCLUDED_PREFIXES = [
  'tests/e2e/',
  'tests/client/',
  'tests/helpers/',
  'tests/scripts/',
  'tests/review-loop/',
  'tests/types/',
] as const

function resolveNumberOverride(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return fallback
  }

  const parsedValue = Number(rawValue)
  if (!Number.isFinite(parsedValue)) {
    return fallback
  }
  return parsedValue
}

function resolveStringOverride(name: string, fallback: string): string {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return fallback
  }
  return rawValue
}

function resolveReadonlyStringList(name: string, fallback: readonly string[]): readonly string[] {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return fallback
  }

  const parsedValue = rawValue
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return parsedValue.length > 0 ? parsedValue : fallback
}

export let MODEL = 'Gemma-4-26B-A4B'
export let BASE_URL = 'http://localhost:8000/v1'

export let PROJECT_ROOT = DEFAULT_PROJECT_ROOT

export let REPORTS_DIR = DEFAULT_REPORTS_DIR
export let AUDIT_BEHAVIOR_DIR = DEFAULT_AUDIT_BEHAVIOR_DIR

export let EXTRACTED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'extracted')
export let CLASSIFIED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'classified')
export let CONSOLIDATED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'consolidated')
export let EVALUATED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'evaluated')
export let STORIES_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'stories')
export let PROGRESS_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'progress.json')
export let INCREMENTAL_MANIFEST_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'incremental-manifest.json')
export let CONSOLIDATED_MANIFEST_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'consolidated-manifest.json')
export let KEYWORD_VOCABULARY_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'keyword-vocabulary.json')
export let EMBEDDING_CACHE_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'embedding-cache.json')

export let PHASE1_TIMEOUT_MS = 1_200_000
export let PHASE2_TIMEOUT_MS = 300_000
export let PHASE3_TIMEOUT_MS = 600_000
export let MAX_RETRIES = 3
export const RETRY_BACKOFF_MS = [10_000, 30_000, 90_000] as const
export let MAX_STEPS = 20
export let VERBOSE = false
export let PROGRESS_RENDERER = 'auto'

export let EXCLUDED_PREFIXES: readonly string[] = DEFAULT_EXCLUDED_PREFIXES

export let EMBEDDING_MODEL = 'Qwen3-Embedding-8B'
export let EMBEDDING_BASE_URL = 'http://localhost:8000/v1'
export let CONSOLIDATION_THRESHOLD = 0.92
export let CONSOLIDATION_MIN_CLUSTER_SIZE = 2
export let CONSOLIDATION_DRY_RUN = false
export let CONSOLIDATION_EMBED_BATCH_SIZE = 100
export let CONSOLIDATION_LINKAGE: LinkageMode = 'single'
export let CONSOLIDATION_MAX_CLUSTER_SIZE = 0
export let CONSOLIDATION_GAP_THRESHOLD = 0

function reloadPathConfig(): void {
  PROJECT_ROOT = resolveStringOverride('BEHAVIOR_AUDIT_PROJECT_ROOT', DEFAULT_PROJECT_ROOT)
  REPORTS_DIR = resolveStringOverride('BEHAVIOR_AUDIT_REPORTS_DIR', resolve(PROJECT_ROOT, 'reports'))
  AUDIT_BEHAVIOR_DIR = resolveStringOverride(
    'BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR',
    resolve(REPORTS_DIR, 'audit-behavior'),
  )

  EXTRACTED_DIR = resolveStringOverride('BEHAVIOR_AUDIT_EXTRACTED_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'extracted'))
  CLASSIFIED_DIR = resolveStringOverride('BEHAVIOR_AUDIT_CLASSIFIED_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'classified'))
  CONSOLIDATED_DIR = resolveStringOverride(
    'BEHAVIOR_AUDIT_CONSOLIDATED_DIR',
    resolve(AUDIT_BEHAVIOR_DIR, 'consolidated'),
  )
  EVALUATED_DIR = resolveStringOverride('BEHAVIOR_AUDIT_EVALUATED_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'evaluated'))
  STORIES_DIR = resolveStringOverride('BEHAVIOR_AUDIT_STORIES_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'stories'))
  PROGRESS_PATH = resolveStringOverride('BEHAVIOR_AUDIT_PROGRESS_PATH', resolve(AUDIT_BEHAVIOR_DIR, 'progress.json'))
  INCREMENTAL_MANIFEST_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'incremental-manifest.json'),
  )
  CONSOLIDATED_MANIFEST_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'consolidated-manifest.json'),
  )
  KEYWORD_VOCABULARY_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'keyword-vocabulary.json'),
  )
  EMBEDDING_CACHE_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_EMBEDDING_CACHE_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'embedding-cache.json'),
  )
}

export function reloadBehaviorAuditConfig(): void {
  MODEL = resolveStringOverride('BEHAVIOR_AUDIT_MODEL', 'Gemma-4-26B-A4B')
  BASE_URL = resolveStringOverride('BEHAVIOR_AUDIT_BASE_URL', 'http://localhost:8000/v1')

  reloadPathConfig()

  PHASE1_TIMEOUT_MS = resolveNumberOverride('BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS', 1_200_000)
  PHASE2_TIMEOUT_MS = resolveNumberOverride('BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS', 300_000)
  PHASE3_TIMEOUT_MS = resolveNumberOverride('BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS', 600_000)
  MAX_RETRIES = resolveNumberOverride('BEHAVIOR_AUDIT_MAX_RETRIES', 3)
  MAX_STEPS = resolveNumberOverride('BEHAVIOR_AUDIT_MAX_STEPS', 20)
  VERBOSE = resolveStringOverride('BEHAVIOR_AUDIT_VERBOSE', '0') === '1'
  PROGRESS_RENDERER = resolveStringOverride('BEHAVIOR_AUDIT_PROGRESS_RENDERER', 'auto')
  EXCLUDED_PREFIXES = resolveReadonlyStringList('BEHAVIOR_AUDIT_EXCLUDED_PREFIXES', DEFAULT_EXCLUDED_PREFIXES)
  EMBEDDING_MODEL = resolveStringOverride('BEHAVIOR_AUDIT_EMBEDDING_MODEL', 'Qwen3-Embedding-8B')
  EMBEDDING_BASE_URL = resolveStringOverride('BEHAVIOR_AUDIT_EMBEDDING_BASE_URL', BASE_URL)
  CONSOLIDATION_THRESHOLD = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD', 0.92)
  CONSOLIDATION_MIN_CLUSTER_SIZE = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE', 2)
  CONSOLIDATION_DRY_RUN = resolveStringOverride('BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN', '0') === '1'
  CONSOLIDATION_EMBED_BATCH_SIZE = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE', 100)
  const linkageRaw = resolveStringOverride('BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE', 'single')
  CONSOLIDATION_LINKAGE = linkageRaw === 'average' || linkageRaw === 'complete' ? linkageRaw : 'single'
  CONSOLIDATION_MAX_CLUSTER_SIZE = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_MAX_CLUSTER_SIZE', 0)
  CONSOLIDATION_GAP_THRESHOLD = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_GAP_THRESHOLD', 0)
}

export const formatElapsedMs = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`

reloadBehaviorAuditConfig()

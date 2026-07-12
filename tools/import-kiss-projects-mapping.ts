// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Pure kiss-Project → nerv-Project field mapping for the config importer
 * (`tools/import-kiss-projects.ts`). No I/O — see `tools/import-kiss-projects-run.ts`
 * for the Mongo-facing orchestration.
 */

export interface KissProjectRepoRef {
  projectPath: string
  description: string
  defaultBranch?: string
  worktreeSubdir?: string
  pipelineJobTrackList?: string[] | null
}

export interface KissProjectDoc {
  _id: unknown
  title?: string
  repositories?: KissProjectRepoRef[]
  mcpServers?: unknown[]
  modelProvider?: Record<string, unknown>
  autoReview?: boolean
  selfReviewEnabled?: boolean
  maxTaskCost?: number | null
  proxy?: string
  ignoreFiles?: string
  ephemeralSessionsEnabled?: boolean
  ephemeralModelProvider?: unknown
}

export interface NervProjectRepoDoc {
  projectPath: string
  repoUrl: string
  baseBranch?: string
  worktreeSubdir?: string
  description?: string
}

export interface NervProjectDoc {
  contextIds: string[]
  repositories: NervProjectRepoDoc[]
  mcpServers?: unknown[]
  modelProvider?: Record<string, unknown>
  autoReview: boolean
  selfReviewEnabled: boolean
  costBudgetUsd: number | null
  forge: { kind: 'gitlab'; apiBaseUrl: string }
}

export interface MapImportOptions {
  /** kiss's global GitLab instance base URL (mirrors kiss's own `GITLAB_BASE_URL` env). */
  gitlabBaseUrl: string
}

export interface MapImportResult {
  doc: NervProjectDoc
  warnings: string[]
}

/** Human-readable label for a kiss project in warnings/reports: title, falling back to _id. */
export function kissProjectLabel(kiss: Pick<KissProjectDoc, '_id' | 'title'>): string {
  return kiss.title !== undefined && kiss.title !== '' ? kiss.title : String(kiss['_id'])
}

function isSetValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/u, '')
}

const DROPPED_PROJECT_FIELDS = ['proxy', 'ignoreFiles', 'ephemeralSessionsEnabled', 'ephemeralModelProvider'] as const

function mapRepo(
  repo: KissProjectRepoRef,
  gitlabBaseUrl: string,
  label: string,
  warnings: string[],
): NervProjectRepoDoc {
  if (isSetValue(repo.pipelineJobTrackList)) {
    warnings.push(
      `project "${label}" repo "${repo.projectPath}": dropping kiss field "pipelineJobTrackList" ` +
        '(nerv Project.repositories has no matching field yet)',
    )
  }
  return {
    projectPath: repo.projectPath,
    repoUrl: `${trimTrailingSlash(gitlabBaseUrl)}/${repo.projectPath}.git`,
    description: repo.description,
    ...(repo.defaultBranch === undefined ? {} : { baseBranch: repo.defaultBranch }),
    ...(repo.worktreeSubdir === undefined ? {} : { worktreeSubdir: repo.worktreeSubdir }),
  }
}

/** Maps one kiss Project doc to a nerv Project doc, collecting dropped-field warnings. Pure — no I/O. */
export function mapKissProjectToNervProject(kiss: KissProjectDoc, opts: MapImportOptions): MapImportResult {
  const warnings: string[] = []
  const label = kissProjectLabel(kiss)
  for (const field of DROPPED_PROJECT_FIELDS) {
    if (isSetValue(kiss[field])) warnings.push(`project "${label}": dropping kiss field "${field}" (no nerv target)`)
  }
  const repositories = (kiss.repositories ?? []).map((r) => mapRepo(r, opts.gitlabBaseUrl, label, warnings))
  const doc: NervProjectDoc = {
    contextIds: [],
    repositories,
    ...(kiss.mcpServers === undefined ? {} : { mcpServers: kiss.mcpServers }),
    ...(kiss.modelProvider === undefined ? {} : { modelProvider: kiss.modelProvider }),
    autoReview: kiss.autoReview ?? false,
    selfReviewEnabled: kiss.selfReviewEnabled ?? true,
    costBudgetUsd: kiss.maxTaskCost ?? null,
    forge: { kind: 'gitlab', apiBaseUrl: `${trimTrailingSlash(opts.gitlabBaseUrl)}/api/v4` },
  }
  return { doc, warnings }
}

// ─── Raw-BSON parsing (still pure — takes an already-fetched document, does no I/O) ──────────

function asStringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumberOrNullOrUndefined(v: unknown): number | null | undefined {
  if (v === null) return null
  return typeof v === 'number' ? v : undefined
}

function asBooleanOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function asStringArrayOrNullOrUndefined(v: unknown): string[] | null | undefined {
  if (v === null) return null
  if (!Array.isArray(v)) return undefined
  return v.every((item): item is string => typeof item === 'string') ? v : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function toKissRepoRef(raw: unknown): KissProjectRepoRef | null {
  if (!isRecord(raw)) return null
  const r = raw
  const projectPath = asStringOrUndefined(r['projectPath'])
  const description = asStringOrUndefined(r['description'])
  if (projectPath === undefined || description === undefined) return null
  const defaultBranch = asStringOrUndefined(r['defaultBranch'])
  const worktreeSubdir = asStringOrUndefined(r['worktreeSubdir'])
  const pipelineJobTrackList = asStringArrayOrNullOrUndefined(r['pipelineJobTrackList'])
  return {
    projectPath,
    description,
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    ...(worktreeSubdir === undefined ? {} : { worktreeSubdir }),
    ...(pipelineJobTrackList === undefined ? {} : { pipelineJobTrackList }),
  }
}

/** Parses a raw Mongo document from kiss's `projects` collection into a typed `KissProjectDoc`. */
export function toKissProjectDoc(raw: Record<string, unknown>): KissProjectDoc {
  const rawRepos = raw['repositories']
  const repositories = Array.isArray(rawRepos)
    ? rawRepos.map(toKissRepoRef).filter((r): r is KissProjectRepoRef => r !== null)
    : undefined
  const title = asStringOrUndefined(raw['title'])
  const rawMcpServers = raw['mcpServers']
  const mcpServers = Array.isArray(rawMcpServers) ? rawMcpServers : undefined
  const rawModelProvider = raw['modelProvider']
  const modelProvider = isRecord(rawModelProvider) ? rawModelProvider : undefined
  const autoReview = asBooleanOrUndefined(raw['autoReview'])
  const selfReviewEnabled = asBooleanOrUndefined(raw['selfReviewEnabled'])
  const maxTaskCost = asNumberOrNullOrUndefined(raw['maxTaskCost'])
  const proxy = asStringOrUndefined(raw['proxy'])
  const ignoreFiles = asStringOrUndefined(raw['ignoreFiles'])
  const ephemeralSessionsEnabled = asBooleanOrUndefined(raw['ephemeralSessionsEnabled'])
  const ephemeralModelProvider = raw['ephemeralModelProvider']
  return {
    _id: raw['_id'],
    ...(title === undefined ? {} : { title }),
    ...(repositories === undefined ? {} : { repositories }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
    ...(modelProvider === undefined ? {} : { modelProvider }),
    ...(autoReview === undefined ? {} : { autoReview }),
    ...(selfReviewEnabled === undefined ? {} : { selfReviewEnabled }),
    ...(maxTaskCost === undefined ? {} : { maxTaskCost }),
    ...(proxy === undefined ? {} : { proxy }),
    ...(ignoreFiles === undefined ? {} : { ignoreFiles }),
    ...(ephemeralSessionsEnabled === undefined ? {} : { ephemeralSessionsEnabled }),
    ...(ephemeralModelProvider === undefined ? {} : { ephemeralModelProvider }),
  }
}

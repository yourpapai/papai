// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ShapedUser {
  id?: number
  name?: string
  username?: string
}

export interface ShapedTreeEntry {
  id?: string
  name?: string
  type?: string
  path?: string
  mode?: string
}

export interface ShapedMr {
  title?: string
  description?: string
  state?: string
  web_url?: string
  source_branch?: string
  target_branch?: string
  author?: ShapedUser
  assignee?: ShapedUser
  reviewers?: ShapedUser[]
  labels?: string[]
}

export interface ShapedJob {
  id?: number
  name?: string
  status?: string
  stage?: string
  web_url?: string
  ref?: string
  created_at?: string
  started_at?: string
  finished_at?: string
  duration?: number
  queued_duration?: number
  log: string
  logTruncated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function shapeUser(raw: unknown): ShapedUser | undefined {
  if (!isRecord(raw)) return undefined
  const id = numberOr(raw['id'])
  const name = stringOr(raw['name'])
  const username = stringOr(raw['username'])
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(username === undefined ? {} : { username }),
  }
}

export function shapeTreeEntry(raw: unknown): ShapedTreeEntry {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const name = stringOr(raw['name'])
  const type = stringOr(raw['type'])
  const path = stringOr(raw['path'])
  const mode = stringOr(raw['mode'])
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(type === undefined ? {} : { type }),
    ...(path === undefined ? {} : { path }),
    ...(mode === undefined ? {} : { mode }),
  }
}

export function shapeMr(raw: unknown): ShapedMr {
  if (!isRecord(raw)) return {}
  const title = stringOr(raw['title'])
  const description = stringOr(raw['description'])
  const state = stringOr(raw['state'])
  const web_url = stringOr(raw['web_url'])
  const source_branch = stringOr(raw['source_branch'])
  const target_branch = stringOr(raw['target_branch'])
  const author = shapeUser(raw['author'])
  const assignee = shapeUser(raw['assignee'])
  const reviewersRaw = raw['reviewers']
  const reviewers = Array.isArray(reviewersRaw)
    ? reviewersRaw.map((entry) => shapeUser(entry)).filter((entry): entry is ShapedUser => entry !== undefined)
    : undefined
  const labelsRaw = raw['labels']
  const labels = Array.isArray(labelsRaw)
    ? labelsRaw.filter((entry): entry is string => typeof entry === 'string')
    : undefined

  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(state === undefined ? {} : { state }),
    ...(web_url === undefined ? {} : { web_url }),
    ...(source_branch === undefined ? {} : { source_branch }),
    ...(target_branch === undefined ? {} : { target_branch }),
    ...(author === undefined ? {} : { author }),
    ...(assignee === undefined ? {} : { assignee }),
    ...(reviewers === undefined || reviewers.length === 0 ? {} : { reviewers }),
    ...(labels === undefined ? {} : { labels }),
  }
}

export function shapeJob(raw: unknown, log: string, logTruncated: boolean): ShapedJob {
  if (!isRecord(raw)) return { log, logTruncated }

  const id = numberOr(raw['id'])
  const duration = numberOr(raw['duration'])
  const queued_duration = numberOr(raw['queued_duration'])
  const name = stringOr(raw['name'])
  const status = stringOr(raw['status'])
  const stage = stringOr(raw['stage'])
  const web_url = stringOr(raw['web_url'])
  const ref = stringOr(raw['ref'])
  const created_at = stringOr(raw['created_at'])
  const started_at = stringOr(raw['started_at'])
  const finished_at = stringOr(raw['finished_at'])

  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(status === undefined ? {} : { status }),
    ...(stage === undefined ? {} : { stage }),
    ...(web_url === undefined ? {} : { web_url }),
    ...(ref === undefined ? {} : { ref }),
    ...(created_at === undefined ? {} : { created_at }),
    ...(started_at === undefined ? {} : { started_at }),
    ...(finished_at === undefined ? {} : { finished_at }),
    ...(duration === undefined ? {} : { duration }),
    ...(queued_duration === undefined ? {} : { queued_duration }),
    log,
    logTruncated,
  }
}

export function truncateText(text: string, maxBytes = 1_000_000): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  return { text: text.slice(0, maxBytes), truncated: true }
}

export interface MrQueryOptions {
  state?: string
  search?: string
  labels?: string
  sourceBranch?: string
  targetBranch?: string
  orderBy?: string
  sort?: string
  perPage?: number
  page?: number
}

export function buildMrQuery(opts: MrQueryOptions): string {
  const params = new URLSearchParams()

  if (opts.state !== undefined && opts.state !== 'all') params.set('state', opts.state)
  if (opts.search !== undefined) params.set('search', opts.search)
  if (opts.labels !== undefined) params.set('labels', opts.labels)
  if (opts.sourceBranch !== undefined) params.set('source_branch', opts.sourceBranch)
  if (opts.targetBranch !== undefined) params.set('target_branch', opts.targetBranch)
  if (opts.orderBy !== undefined) params.set('order_by', opts.orderBy)
  if (opts.sort !== undefined) params.set('sort', opts.sort)
  params.set('per_page', String(Math.min(opts.perPage ?? 20, 100)))
  params.set('page', String(opts.page ?? 1))

  return params.toString()
}

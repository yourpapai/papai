// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import {
  buildMrQuery,
  shapeJob,
  shapeMr,
  shapeTreeEntry,
  truncateText,
  type MrQueryOptions,
  type ShapedJob,
  type ShapedMr,
  type ShapedTreeEntry,
} from './format.js'

export interface GitLabClientOptions {
  baseUrl: string
  token: string
  httpFetch: HttpFetch
}

export interface RepositoryTreeOptions {
  path?: string
  ref?: string
  recursive?: boolean
}

export interface FileContentOptions {
  ref?: string
}

export interface MrListResult {
  items: ShapedMr[]
  total: number
  totalPages: number
  page: number
  perPage: number
}

function readIntHeader(res: Response, name: string, fallback: number): number {
  const v = res.headers.get(name)
  const n = v === null ? NaN : Number.parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

export class GitLabClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly httpFetch: HttpFetch

  constructor(options: GitLabClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.token = options.token
    this.httpFetch = options.httpFetch
  }

  private request(path: string): Promise<Response> {
    return this.httpFetch(`${this.baseUrl}/api/v4${path}`, {
      headers: { 'PRIVATE-TOKEN': this.token, Accept: 'application/json' },
    })
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await this.request(path)
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status} for ${path}`)
    }
    return res.json()
  }

  private async getText(path: string): Promise<string> {
    const res = await this.request(path)
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status} for ${path}`)
    }
    return res.text()
  }

  async getRepositoryTree(projectPath: string, opts: RepositoryTreeOptions): Promise<ShapedTreeEntry[]> {
    const params = new URLSearchParams()
    if (opts.path !== undefined) params.set('path', opts.path)
    if (opts.ref !== undefined) params.set('ref', opts.ref)
    if (opts.recursive === true) params.set('recursive', 'true')
    params.set('per_page', '100')

    const json = await this.getJson(`/projects/${encodeURIComponent(projectPath)}/repository/tree?${params}`)
    return Array.isArray(json) ? json.map(shapeTreeEntry) : []
  }

  async getFileContent(projectPath: string, filePath: string, opts?: FileContentOptions): Promise<string> {
    const ref = opts?.ref ?? 'HEAD'
    const raw = await this.getText(
      `/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`,
    )
    const { text, truncated } = truncateText(raw)
    return truncated ? `[WARNING: file truncated to ~1MB]\n\n${text}` : text
  }

  async getMrInfo(projectPath: string, mrIid: string): Promise<ShapedMr> {
    const json = await this.getJson(
      `/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(mrIid)}`,
    )
    return shapeMr(json)
  }

  async getMrs(projectPath: string, opts: MrQueryOptions): Promise<MrListResult> {
    const query = buildMrQuery(opts)
    const res = await this.request(`/projects/${encodeURIComponent(projectPath)}/merge_requests?${query}`)
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status} for merge_requests`)
    }
    const json: unknown = await res.json()
    const items = Array.isArray(json) ? json.map(shapeMr) : []

    return {
      items,
      total: readIntHeader(res, 'x-total', items.length),
      totalPages: readIntHeader(res, 'x-total-pages', 1),
      page: readIntHeader(res, 'x-page', opts.page ?? 1),
      perPage: readIntHeader(res, 'x-per-page', Math.min(opts.perPage ?? 20, 100)),
    }
  }

  async getJob(projectPath: string, jobId: string): Promise<ShapedJob> {
    const p = encodeURIComponent(projectPath)
    const j = encodeURIComponent(jobId)
    const [jobRaw, trace] = await Promise.all([
      this.getJson(`/projects/${p}/jobs/${j}`),
      this.getText(`/projects/${p}/jobs/${j}/trace`),
    ])
    const { text: log, truncated } = truncateText(trace)
    return shapeJob(jobRaw, log, truncated)
  }
}

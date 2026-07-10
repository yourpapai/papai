// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sanitizeObject } from './format.js'

export type HttpFetch = (url: string, init: RequestInit | undefined) => Promise<Response>

export interface SentryClientOptions {
  baseUrl: string
  token: string
  orgSlug: string
  httpFetch: HttpFetch
}

export interface SearchIssuesParams {
  project?: string
  query?: string
  statsPeriod?: string
  environment?: string
  sort?: string
  limit?: number
}

export interface IssueDetailsLimits {
  eventsLimit?: number
  tagValuesLimit?: number
  commentsLimit?: number
  releasesLimit?: number
  commitsLimit?: number
}

export interface IssueDetails {
  issue: unknown
  latestEvents: unknown
  tagValues: Record<string, unknown>
  comments: unknown
  suspectReleases: unknown[]
  releaseCommits: Array<{ version: string; commits: unknown }>
}

type QueryParams = Record<string, string | number | undefined>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function limitOrDefault(n: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(n ?? fallback, 100))
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export class SentryClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly orgSlug: string
  private readonly httpFetch: HttpFetch

  constructor(options: SentryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.token = options.token
    this.orgSlug = options.orgSlug
    this.httpFetch = options.httpFetch
  }

  private async request(path: string, params?: QueryParams): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/0${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === '') continue
        url.searchParams.set(key, String(value))
      }
    }
    const res = await this.httpFetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Sentry API ${res.status} for ${path}: ${body.slice(0, 300)}`)
    }
    return res.json()
  }

  async getProjects(limit?: number): Promise<unknown> {
    const data = await this.request(`/organizations/${encodeURIComponent(this.orgSlug)}/projects/`)
    const items = asUnknownArray(data)
    return items.slice(0, limitOrDefault(limit, 100)).map((item) => sanitizeObject(item))
  }

  async searchIssues(params: SearchIssuesParams): Promise<unknown> {
    const data = await this.request(`/organizations/${encodeURIComponent(this.orgSlug)}/issues/`, {
      query: params.query,
      statsPeriod: params.statsPeriod,
      environment: params.environment,
      sort: params.sort,
      limit: limitOrDefault(params.limit, 20),
      project: params.project,
    })
    return asUnknownArray(data).map((item) => sanitizeObject(item))
  }

  async getIssue(issueId: string): Promise<unknown> {
    const data = await this.request(`/issues/${encodeURIComponent(issueId)}/`)
    return sanitizeObject(data)
  }

  async getIssueEvents(issueId: string, limit?: number): Promise<unknown> {
    const data = await this.request(`/issues/${encodeURIComponent(issueId)}/events/`, {
      limit: limitOrDefault(limit, 5),
    })
    return asUnknownArray(data).map((item) => sanitizeObject(item))
  }

  async getIssueTagValues(issueId: string, tagKey: string, limit?: number): Promise<unknown> {
    const data = await this.request(
      `/issues/${encodeURIComponent(issueId)}/tags/${encodeURIComponent(tagKey)}/values/`,
      { limit: limitOrDefault(limit, 10) },
    )
    return asUnknownArray(data).map((item) => sanitizeObject(item))
  }

  async getIssueComments(issueId: string, limit?: number): Promise<unknown> {
    const data = await this.request(`/issues/${encodeURIComponent(issueId)}/comments/`)
    return asUnknownArray(data)
      .slice(0, limitOrDefault(limit, 20))
      .map((item) => sanitizeObject(item))
  }

  private async getRelease(version: string): Promise<unknown> {
    const data = await this.request(
      `/organizations/${encodeURIComponent(this.orgSlug)}/releases/${encodeURIComponent(version)}/`,
    )
    return sanitizeObject(data)
  }

  private async getReleaseCommits(version: string, limit?: number): Promise<unknown> {
    const data = await this.request(
      `/organizations/${encodeURIComponent(this.orgSlug)}/releases/${encodeURIComponent(version)}/commits/`,
      { limit: limitOrDefault(limit, 20) },
    )
    return asUnknownArray(data).map((item) => sanitizeObject(item))
  }

  async getIssueDetails(issueId: string, limits?: IssueDetailsLimits): Promise<IssueDetails> {
    const issue = await this.getIssue(issueId)

    const [latestEvents, comments] = await Promise.all([
      this.getIssueEvents(issueId, limits?.eventsLimit),
      this.getIssueComments(issueId, limits?.commentsLimit),
    ])

    const tagValues = await this.collectTagValues(issueId, issue, limits?.tagValuesLimit)
    const versions = this.collectSuspectVersions(issue, latestEvents, limits?.releasesLimit)

    const suspectReleases = await this.collectSuspectReleases(versions)
    const releaseCommits = await this.collectReleaseCommits(versions, limits?.commitsLimit)

    return { issue, latestEvents, tagValues, comments, suspectReleases, releaseCommits }
  }

  private async collectTagValues(
    issueId: string,
    issue: unknown,
    tagValuesLimit: number | undefined,
  ): Promise<Record<string, unknown>> {
    const tags = isRecord(issue) ? asUnknownArray(issue['tags']) : []
    const tagKeys: string[] = []
    for (const tag of tags.slice(0, 10)) {
      const key = isRecord(tag) ? stringOrUndefined(tag['key']) : undefined
      if (key !== undefined) tagKeys.push(key)
    }
    const values = await Promise.all(tagKeys.map((key) => this.getIssueTagValues(issueId, key, tagValuesLimit)))
    const tagValues: Record<string, unknown> = {}
    tagKeys.forEach((key, index) => {
      tagValues[key] = values[index]
    })
    return tagValues
  }

  private collectSuspectVersions(issue: unknown, latestEvents: unknown, releasesLimit: number | undefined): string[] {
    const versions = new Set<string>()
    if (isRecord(issue)) {
      const metadata = issue['metadata']
      const release = isRecord(metadata) ? stringOrUndefined(metadata['release']) : undefined
      if (release !== undefined) versions.add(release)
    }
    for (const event of asUnknownArray(latestEvents)) {
      const release = isRecord(event) ? stringOrUndefined(event['release']) : undefined
      if (release !== undefined) versions.add(release)
    }
    return [...versions].slice(0, limitOrDefault(releasesLimit, 10))
  }

  private async collectSuspectReleases(versions: string[]): Promise<unknown[]> {
    const results = await Promise.all(
      versions.map(async (version) => {
        try {
          return await this.getRelease(version)
        } catch {
          return null
        }
      }),
    )
    return results.filter((release) => release !== null)
  }

  private collectReleaseCommits(
    versions: string[],
    commitsLimit: number | undefined,
  ): Promise<Array<{ version: string; commits: unknown }>> {
    return Promise.all(
      versions.map(async (version) => {
        try {
          return { version, commits: await this.getReleaseCommits(version, commitsLimit) }
        } catch {
          return { version, commits: [] }
        }
      }),
    )
  }
}

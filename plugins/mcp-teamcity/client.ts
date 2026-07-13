// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './context.js'
import { sanitizeTeamCityConfig } from './format.js'

export type { HttpFetch } from './context.js'

export interface TeamCityClientOptions {
  baseUrl: string
  token: string
  httpFetch: HttpFetch
}

export const PROJECTS_LIST_FIELDS = 'project(id,name,parentProjectId,archived,webUrl,description)'

export const PROJECT_FIELDS =
  'id,name,parentProjectId,archived,webUrl,description,projects(project(id,name,parentProjectId,archived,webUrl,description)),buildTypes(buildType(id,name,projectId,webUrl,paused,description)),parameters(property(name,value))'

export const BUILD_TYPES_LIST_FIELDS = 'buildType(id,name,projectId,webUrl,paused,description)'

export const BUILD_TYPE_FIELDS =
  'id,name,projectId,projectName,webUrl,paused,description,templates(buildType(id,name,projectId,webUrl)),vcs-root-entries(vcs-root-entry(id,checkout-rules,vcs-root(id,name,href,projectId,properties(property(name,value))))),steps(step(id,name,type,disabled,properties(property(name,value)))),triggers(trigger(id,type,disabled,properties(property(name,value)))),features(feature(id,type,disabled,properties(property(name,value)))),artifact-dependencies(artifact-dependency(id,type,disabled,properties(property(name,value)))),snapshot-dependencies(snapshot-dependency(id,type,disabled,source-buildType(id,name,projectId,webUrl),properties(property(name,value)))),parameters(property(name,value))'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOr(value: unknown, key: string): unknown[] {
  if (isRecord(value) && Array.isArray(value[key])) return value[key]
  return []
}

export class TeamCityClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly httpFetch: HttpFetch

  constructor(options: TeamCityClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.token = options.token
    this.httpFetch = options.httpFetch
  }

  private async request(path: string): Promise<unknown> {
    const res = await this.httpFetch(`${this.baseUrl}/app/rest${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`TeamCity API ${res.status} for ${path}`)
    }
    return res.json()
  }

  async getProjects(): Promise<unknown> {
    const json = await this.request(`/projects?fields=${encodeURIComponent(PROJECTS_LIST_FIELDS)}`)
    return arrayOr(json, 'project')
  }

  async getProjectConfig(projectId: string): Promise<unknown> {
    const json = await this.request(
      `/projects/id:${encodeURIComponent(projectId)}?fields=${encodeURIComponent(PROJECT_FIELDS)}`,
    )
    return sanitizeTeamCityConfig(json)
  }

  async getProjectBuildTypes(projectId: string): Promise<unknown> {
    const json = await this.request(
      `/projects/id:${encodeURIComponent(projectId)}/buildTypes?fields=${encodeURIComponent(BUILD_TYPES_LIST_FIELDS)}`,
    )
    return arrayOr(json, 'buildType')
  }

  async getBuildTypeConfig(buildTypeId: string): Promise<unknown> {
    const json = await this.request(
      `/buildTypes/id:${encodeURIComponent(buildTypeId)}?fields=${encodeURIComponent(BUILD_TYPE_FIELDS)}`,
    )
    return sanitizeTeamCityConfig(json)
  }
}

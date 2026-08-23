// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Project } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'

import { logger } from '../../../src/logger.js'
import { classifyGitHubError, GitHubClassifiedError } from '../classify-error.js'
import type { GitHubConfig } from '../client.js'
import { githubFetch } from '../client.js'
import { mapRepoToProject } from '../mappers.js'
import { GitHubRepoSchema } from '../schemas/repo.js'

const log = logger.child({ scope: 'provider:github:projects' })

/**
 * One instance = one repository: listing fetches the configured repo and
 * returns it as the single project.
 */
export async function githubListProjects(config: GitHubConfig): Promise<Project[]> {
  log.debug({ repo: config.repo }, 'listProjects')
  try {
    const raw = await githubFetch(config, 'GET', `/repos/${config.repo}`)
    const repo = GitHubRepoSchema.parse(raw)
    const project = mapRepoToProject(repo)
    log.info({ projectId: project.id }, 'Projects listed')
    return [project]
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), repo: config.repo },
      'Failed to list projects',
    )
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export async function githubGetProject(config: GitHubConfig, projectId: string): Promise<Project> {
  log.debug({ projectId }, 'getProject')
  if (projectId !== config.repo) {
    log.warn({ projectId }, 'Project id does not match the configured repository')
    throw new GitHubClassifiedError(
      `Project ${projectId} is not the configured repository`,
      providerError.projectNotFound(projectId),
    )
  }
  try {
    const raw = await githubFetch(config, 'GET', `/repos/${config.repo}`)
    const repo = GitHubRepoSchema.parse(raw)
    const project = mapRepoToProject(repo)
    log.info({ projectId: project.id }, 'Project retrieved')
    return project
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to get project')
    throw classifyGitHubError(error, { projectId })
  }
}

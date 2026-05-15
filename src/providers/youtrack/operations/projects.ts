// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../logger.js'
import type { Project } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { PROJECT_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { ProjectSchema } from '../schemas/project.js'

const log = logger.child({ scope: 'provider:youtrack:projects' })

/**
 * Generate a unique shortName from a project name.
 * - Handles non-ASCII characters by using a fallback prefix
 * - Adds a random suffix to avoid collisions
 * - Ensures result is never empty and max 10 chars
 */
export function generateShortName(name: string): string {
  // Normalize Unicode characters (e.g., é → e, ñ → n)
  // Remove diacritics
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Extract ASCII alphanumeric characters
  const alphanumeric = normalized.toUpperCase().replace(/[^A-Z0-9]/g, '')

  // Use first 7 chars of cleaned name, or fallback for non-ASCII names
  const base = alphanumeric.length > 0 ? alphanumeric.slice(0, 7) : 'PROJECT'

  // Generate random 3-char suffix for collision avoidance
  const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase()

  // Combine and ensure max 10 chars
  const shortName = `${base}${randomSuffix}`.slice(0, 10)

  return shortName
}

export async function getYouTrackProject(config: YouTrackConfig, projectId: string): Promise<Project> {
  log.debug({ projectId }, 'getProject')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, {
      query: { fields: PROJECT_FIELDS },
    })
    const project = ProjectSchema.parse(raw)
    log.info({ projectId: project.id, name: project.name }, 'Project retrieved')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to get project')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function listYouTrackProjects(config: YouTrackConfig): Promise<Project[]> {
  log.debug('listProjects')
  try {
    const projects = await paginate(
      config,
      '/api/admin/projects',
      { fields: PROJECT_FIELDS },
      ProjectSchema.array(),
      10,
      100,
    )
    log.info({ count: projects.length }, 'Projects listed')
    return projects
      .filter((p) => p.archived !== true)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        url: `${config.baseUrl}/projects/${p.shortName ?? p.id}`,
      }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list projects')
    throw classifyYouTrackError(error)
  }
}

export async function createYouTrackProject(
  config: YouTrackConfig,
  params: { name: string; description?: string },
): Promise<Project> {
  log.debug({ name: params.name }, 'createProject')
  try {
    // Generate shortName from name with collision avoidance
    const shortName = generateShortName(params.name)
    const body: Record<string, unknown> = {
      name: params.name,
      shortName,
    }
    if (params.description !== undefined) body['description'] = params.description
    const raw = await youtrackFetch(config, 'POST', '/api/admin/projects', {
      body,
      query: { fields: PROJECT_FIELDS },
    })
    const project = ProjectSchema.parse(raw)
    log.info({ projectId: project.id, name: project.name }, 'Project created')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create project')
    throw classifyYouTrackError(error)
  }
}

export async function updateYouTrackProject(
  config: YouTrackConfig,
  projectId: string,
  params: { name?: string; description?: string },
): Promise<Project> {
  log.debug({ projectId, hasName: params.name !== undefined }, 'updateProject')
  try {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.description !== undefined) body['description'] = params.description
    const raw = await youtrackFetch(config, 'POST', `/api/admin/projects/${projectId}`, {
      body,
      query: { fields: PROJECT_FIELDS },
    })
    const project = ProjectSchema.parse(raw)
    log.info({ projectId: project.id }, 'Project updated')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to update project')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function deleteYouTrackProject(config: YouTrackConfig, projectId: string): Promise<{ id: string }> {
  log.debug({ projectId }, 'deleteProject')
  try {
    await youtrackFetch(config, 'DELETE', `/api/admin/projects/${projectId}`)
    log.info({ projectId }, 'Project deleted')
    return { id: projectId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to delete project')
    throw classifyYouTrackError(error, { projectId })
  }
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { providerError } from '../../../errors.js'
import { logger } from '../../../logger.js'
import type { UserRef } from '../../types.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { YouTrackApiError, youtrackFetch } from '../client.js'
import { paginate } from '../helpers.js'
import { resolveYouTrackUserRingId } from './users.js'

const log = logger.child({ scope: 'provider:youtrack:team' })

const PROJECT_LOOKUP_FIELDS = 'id,ringId,shortName,name'
const TEAM_USER_FIELDS = 'id,login,name'
const PAGE_SIZE = 100
const UNBOUNDED_MAX_PAGES = Number.POSITIVE_INFINITY

const ProjectLookupSchema = z.object({
  id: z.string(),
  ringId: z.string().nullable().optional(),
  shortName: z.string().optional(),
  name: z.string().optional(),
  $type: z.string().optional(),
})

const TeamUserSchema = z.object({
  id: z.string(),
  login: z.string().optional(),
  fullName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().nullable().optional(),
  ringId: z.string().nullable().optional(),
  $type: z.string().optional(),
  type: z.string().optional(),
})

type ProjectLookup = z.infer<typeof ProjectLookupSchema>
type TeamUser = z.infer<typeof TeamUserSchema>

const teamUsersPath = (projectRingId: string): string => `/hub/api/rest/projects/${projectRingId}/team/users`

const mapUserRef = (user: TeamUser): UserRef => ({
  id: user.id,
  login: user.login,
  name: user.fullName ?? user.name,
})

const getProjectRingId = (project: ProjectLookup, projectId: string): string => {
  if (project.ringId !== undefined && project.ringId !== null) {
    return project.ringId
  }

  throw new YouTrackClassifiedError(
    `Project "${projectId}" is missing a Hub ringId`,
    providerError.validationFailed('projectId', 'Project is missing a Hub ringId'),
  )
}

const matchesProjectIdentifier = (project: ProjectLookup, projectId: string): boolean => {
  const normalizedProjectId = projectId.trim().toLowerCase()

  return (
    project.id === projectId ||
    project.ringId === projectId ||
    project.shortName?.toLowerCase() === normalizedProjectId ||
    project.name?.toLowerCase() === normalizedProjectId
  )
}

const fetchProjects = (config: YouTrackConfig): Promise<ProjectLookup[]> =>
  paginate(
    config,
    '/api/admin/projects',
    { fields: PROJECT_LOOKUP_FIELDS },
    ProjectLookupSchema.array(),
    UNBOUNDED_MAX_PAGES,
    PAGE_SIZE,
  )

async function resolveProjectRingId(config: YouTrackConfig, projectId: string): Promise<string> {
  log.debug({ projectId }, 'resolveProjectRingId')

  try {
    const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, {
      query: { fields: PROJECT_LOOKUP_FIELDS },
    })

    const project = ProjectLookupSchema.parse(raw)
    const ringId = getProjectRingId(project, projectId)
    log.info({ projectId, ringId }, 'Resolved project Hub ringId')
    return ringId
  } catch (error) {
    if (error instanceof YouTrackApiError && error.statusCode === 404) {
      try {
        const projects = await fetchProjects(config)
        const matchedProject = projects.find((project) => matchesProjectIdentifier(project, projectId))
        if (matchedProject !== undefined) {
          const ringId = getProjectRingId(matchedProject, projectId)
          log.info({ projectId, ringId }, 'Resolved project Hub ringId from project list')
          return ringId
        }
      } catch (fallbackError) {
        log.error(
          {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            projectId,
          },
          'Failed to resolve project Hub ringId from project list',
        )
        throw classifyYouTrackError(fallbackError, { projectId })
      }
    }

    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to resolve project Hub ringId',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function listYouTrackProjectTeam(config: YouTrackConfig, projectId: string): Promise<UserRef[]> {
  log.debug({ projectId }, 'listProjectTeam')

  try {
    const projectRingId = await resolveProjectRingId(config, projectId)
    const users = await paginate(
      config,
      teamUsersPath(projectRingId),
      { fields: TEAM_USER_FIELDS },
      TeamUserSchema.array(),
      UNBOUNDED_MAX_PAGES,
      PAGE_SIZE,
    )
    log.info({ projectId, projectRingId, count: users.length }, 'Project team listed')
    return users.map(mapUserRef)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to list project team',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function addYouTrackProjectMember(
  config: YouTrackConfig,
  projectId: string,
  userId: string,
): Promise<{ projectId: string; userId: string }> {
  log.debug({ projectId, userId }, 'addProjectMember')

  try {
    const projectRingId = await resolveProjectRingId(config, projectId)
    const userRingId = await resolveYouTrackUserRingId(config, userId)

    await youtrackFetch(config, 'POST', teamUsersPath(projectRingId), {
      body: { id: userRingId },
    })

    log.info({ projectId, projectRingId, userId, userRingId }, 'Project member added')
    return { projectId, userId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId, userId },
      'Failed to add project member',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function removeYouTrackProjectMember(
  config: YouTrackConfig,
  projectId: string,
  userId: string,
): Promise<{ projectId: string; userId: string }> {
  log.debug({ projectId, userId }, 'removeProjectMember')

  try {
    const projectRingId = await resolveProjectRingId(config, projectId)
    const userRingId = await resolveYouTrackUserRingId(config, userId)

    await youtrackFetch(config, 'DELETE', `${teamUsersPath(projectRingId)}/${userRingId}`)

    log.info({ projectId, projectRingId, userId, userRingId }, 'Project member removed')
    return { projectId, userId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId, userId },
      'Failed to remove project member',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

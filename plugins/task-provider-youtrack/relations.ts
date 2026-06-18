// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RelationType } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { YouTrackClassifiedError, classifyYouTrackError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { IssueLinkSchema } from './schemas/issue-link.js'

const IssueLinksSchema = z.object({
  id: z.string(),
  links: z.array(IssueLinkSchema).optional(),
})

/** Minimal shape of an item from GET /api/issueLinkTypes. */
const IssueLinkTypeListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    directed: z.boolean().optional(),
  }),
)

/** Minimal shape for resolving an issue's database id. */
const IssueIdSchema = z.object({ id: z.string() })

const log = logger.child({ scope: 'provider:youtrack:relations' })

// YouTrack's built-in link-type names are singular ("Depend", not "Depends"); matched case-insensitively.
function mapRelationTypeToLinkType(type: RelationType): string {
  switch (type) {
    case 'blocks':
    case 'blocked_by':
      return 'Depend'
    case 'duplicate':
    case 'duplicate_of':
      return 'Duplicate'
    case 'parent':
    case 'child':
      return 'Subtask'
    case 'related':
      return 'Relates'
    default:
      return 'Relates'
  }
}

function mapRelationTypeToDirection(type: RelationType): 'OUTWARD' | 'INWARD' {
  switch (type) {
    case 'blocks':
    case 'duplicate':
    case 'parent':
      return 'OUTWARD'
    case 'blocked_by':
    case 'duplicate_of':
    case 'related':
    case 'child':
      return 'INWARD'
    default:
      return 'INWARD'
  }
}

/**
 * Resolve the directed link id used by POST /api/issues/{id}/links/{linkID}/issues.
 *
 * Primary path discovers the id from the issue's own link collection (no suffix guessing,
 * undirected types report direction BOTH). Fallback resolves the link type from
 * /api/issueLinkTypes and constructs the id from the type id plus a direction suffix.
 */
async function resolveYouTrackLinkId(
  config: YouTrackConfig,
  taskId: string,
  linkTypeName: string,
  direction: 'OUTWARD' | 'INWARD',
): Promise<string> {
  const wanted = linkTypeName.toLowerCase()

  const rawLinks = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/links`, {
    query: { fields: 'id,direction,linkType(id,name)' },
  })
  const issue = IssueLinksSchema.parse(rawLinks)
  const discovered = (issue.links ?? []).find(
    (link) =>
      link.id !== undefined &&
      (link.linkType?.name ?? '').toLowerCase() === wanted &&
      (link.direction === direction || link.direction === 'BOTH'),
  )
  if (discovered?.id !== undefined) {
    return discovered.id
  }

  const rawTypes = await youtrackFetch(config, 'GET', '/api/issueLinkTypes', {
    query: { fields: 'id,name,directed' },
  })
  const types = IssueLinkTypeListSchema.parse(rawTypes)
  const match = types.find((t) => t.name.toLowerCase() === wanted)
  if (match === undefined) {
    throw new YouTrackClassifiedError(
      `Link type "${linkTypeName}" not found on this YouTrack instance`,
      providerError.linkTypeNotFound(
        linkTypeName,
        types.map((t) => t.name),
      ),
    )
  }

  const suffix = match.directed === false ? 's' : direction === 'OUTWARD' ? 's' : 't'
  return `${match.id}${suffix}`
}

export async function updateYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'updateRelation')

  await removeYouTrackRelation(config, taskId, relatedTaskId)

  const result = await addYouTrackRelation(config, taskId, relatedTaskId, type)

  log.info({ taskId, relatedTaskId, type }, 'Relation updated')
  return result
}

export async function addYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'addRelation')

  try {
    const linkTypeName = mapRelationTypeToLinkType(type)
    const direction = mapRelationTypeToDirection(type)

    const linkId = await resolveYouTrackLinkId(config, taskId, linkTypeName, direction)

    // The POST body is an Issue; YouTrack expects the database id, not the readable id.
    const rawRelated = await youtrackFetch(config, 'GET', `/api/issues/${relatedTaskId}`, {
      query: { fields: 'id' },
    })
    const relatedDbId = IssueIdSchema.parse(rawRelated).id

    await youtrackFetch(config, 'POST', `/api/issues/${taskId}/links/${linkId}/issues`, {
      body: { id: relatedDbId },
      query: { fields: 'id' },
    })

    log.info({ taskId, relatedTaskId, type }, 'Relation added')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId, type },
      'Failed to add relation',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function removeYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string }> {
  log.debug({ taskId, relatedTaskId }, 'removeRelation')

  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,links(id,direction,linkType(name),issues(id,idReadable))' },
  })
  const issue = IssueLinksSchema.parse(raw)

  const matchingLink = (issue.links ?? []).find((link) =>
    (link.issues ?? []).some((i) => i.id === relatedTaskId || i.idReadable === relatedTaskId),
  )

  if (matchingLink === undefined) {
    const err = providerError.relationNotFound(taskId, relatedTaskId)
    throw new YouTrackClassifiedError(`Relation not found: ${taskId} -> ${relatedTaskId}`, err)
  }

  await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/links/${matchingLink.id}`)

  log.info({ taskId, relatedTaskId }, 'Relation removed')
  return { taskId, relatedTaskId }
}

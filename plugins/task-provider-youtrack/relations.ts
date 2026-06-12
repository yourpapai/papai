// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RelationType } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { YouTrackClassifiedError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { IssueLinkSchema } from './schemas/issue-link.js'

const IssueLinksSchema = z.object({
  id: z.string(),
  links: z.array(IssueLinkSchema).optional(),
})

const log = logger.child({ scope: 'provider:youtrack:relations' })

function mapRelationTypeToLinkType(type: RelationType): string {
  switch (type) {
    case 'blocks':
    case 'blocked_by':
      return 'depends'
    case 'duplicate':
    case 'duplicate_of':
      return 'duplicate'
    case 'parent':
    case 'child':
      return 'subtask'
    case 'related':
      return 'relates'
    default:
      return 'relates'
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

  const linkTypeName = mapRelationTypeToLinkType(type)
  const direction = mapRelationTypeToDirection(type)

  await youtrackFetch(config, 'POST', `/api/issues/${taskId}/links`, {
    body: {
      linkType: { name: linkTypeName },
      direction,
      issues: [{ id: relatedTaskId }],
    },
    query: { fields: 'id' },
  })

  log.info({ taskId, relatedTaskId, type }, 'Relation added')
  return { taskId, relatedTaskId, type }
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

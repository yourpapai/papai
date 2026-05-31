// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import type { RelationType, TaskRelation } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:task-relations' })

const KaneoRelationTypeSchema = z.enum(['blocks', 'related', 'subtask'])

const KaneoRelationSchema = z.object({
  id: z.string(),
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  relationType: KaneoRelationTypeSchema,
  createdAt: z.iso.datetime({ offset: true }),
  sourceTask: z.unknown().optional(),
  targetTask: z.unknown().optional(),
})

const KaneoTaskRelationsResponseSchema = z.array(KaneoRelationSchema)

type KaneoRelation = z.infer<typeof KaneoRelationSchema>

const mapOutgoingRelationType = (type: RelationType): z.infer<typeof KaneoRelationTypeSchema> => {
  if (type === 'blocks') return 'blocks'
  if (type === 'related') return 'related'
  if (type === 'parent' || type === 'child') return 'subtask'

  throw new KaneoClassifiedError(
    `Kaneo does not document relation type: ${type}`,
    providerError.unsupportedOperation(`Kaneo relation type ${type}`),
  )
}

const mapIncomingRelation = (taskId: string, relation: KaneoRelation): TaskRelation => {
  if (relation.relationType === 'blocks') {
    return relation.sourceTaskId === taskId
      ? { type: 'blocks', taskId: relation.targetTaskId }
      : { type: 'blocked_by', taskId: relation.sourceTaskId }
  }

  if (relation.relationType === 'related') {
    return relation.sourceTaskId === taskId
      ? { type: 'related', taskId: relation.targetTaskId }
      : { type: 'related', taskId: relation.sourceTaskId }
  }

  return relation.sourceTaskId === taskId
    ? { type: 'parent', taskId: relation.targetTaskId }
    : { type: 'child', taskId: relation.sourceTaskId }
}

const findMatchingRelation = (
  taskId: string,
  relatedTaskId: string,
  relations: readonly KaneoRelation[],
): KaneoRelation | undefined =>
  relations.find((relation) => relation.sourceTaskId === taskId && relation.targetTaskId === relatedTaskId) ??
  relations.find((relation) => relation.sourceTaskId === relatedTaskId && relation.targetTaskId === taskId)

export async function getTaskRelations(config: KaneoConfig, taskId: string): Promise<TaskRelation[]> {
  log.debug({ taskId }, 'Getting task relations')

  try {
    const result = await kaneoFetch(
      config,
      'GET',
      `/task-relation/${taskId}`,
      undefined,
      undefined,
      KaneoTaskRelationsResponseSchema,
    )
    const relations = result.map((relation) => mapIncomingRelation(taskId, relation))
    log.info({ taskId, relationCount: relations.length }, 'Task relations fetched')
    return relations
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get relations')
    throw classifyKaneoError(error, { taskId })
  }
}

export async function addTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'Adding task relation')

  try {
    const relationType = mapOutgoingRelationType(type)
    await kaneoFetch(
      config,
      'POST',
      '/task-relation',
      { sourceTaskId: taskId, targetTaskId: relatedTaskId, relationType },
      undefined,
      KaneoRelationSchema,
    )

    log.info({ taskId, relatedTaskId, type }, 'Relation added')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to add relation')
    throw classifyKaneoError(error, { taskId, relatedTaskId })
  }
}

export async function removeTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
  log.debug({ taskId, relatedTaskId }, 'Removing task relation')

  try {
    const result = await kaneoFetch(
      config,
      'GET',
      `/task-relation/${taskId}`,
      undefined,
      undefined,
      KaneoTaskRelationsResponseSchema,
    )
    const relation = findMatchingRelation(taskId, relatedTaskId, result)
    if (relation === undefined) {
      throw new KaneoClassifiedError(
        `Relation between task ${taskId} and ${relatedTaskId} not found`,
        providerError.relationNotFound(taskId, relatedTaskId),
      )
    }

    await kaneoFetch(config, 'DELETE', `/task-relation/${relation.id}`, undefined, undefined, KaneoRelationSchema)

    log.info({ taskId, relatedTaskId }, 'Relation removed')
    return { taskId, relatedTaskId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove relation')
    throw classifyKaneoError(error, { taskId, relatedTaskId })
  }
}

export async function updateTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'Updating task relation')

  try {
    const relationType = mapOutgoingRelationType(type)
    const result = await kaneoFetch(
      config,
      'GET',
      `/task-relation/${taskId}`,
      undefined,
      undefined,
      KaneoTaskRelationsResponseSchema,
    )
    const relation = findMatchingRelation(taskId, relatedTaskId, result)
    if (relation === undefined) {
      throw new KaneoClassifiedError(
        `Relation between task ${taskId} and ${relatedTaskId} not found`,
        providerError.relationNotFound(taskId, relatedTaskId),
      )
    }

    await kaneoFetch(config, 'DELETE', `/task-relation/${relation.id}`, undefined, undefined, KaneoRelationSchema)
    await kaneoFetch(
      config,
      'POST',
      '/task-relation',
      { sourceTaskId: taskId, targetTaskId: relatedTaskId, relationType },
      undefined,
      KaneoRelationSchema,
    )

    log.info({ taskId, relatedTaskId, type }, 'Relation updated')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update relation')
    throw classifyKaneoError(error, { taskId, relatedTaskId })
  }
}

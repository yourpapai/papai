// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CreateWorkItemParams, UpdateWorkItemParams, WorkItem } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'

import { logger } from '../../../src/logger.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { WORK_ITEM_FIELDS } from '../constants.js'
import { isoToMinutes, minutesToIso, paginate, parseDuration, resolveWorkItemTypeId } from '../helpers.js'
import { YouTrackWorkItemSchema } from '../schemas/work-item.js'
import type { YouTrackWorkItem } from '../schemas/work-item.js'

const log = logger.child({ scope: 'provider:youtrack:work-items' })

const mapWorkItem = (wi: YouTrackWorkItem, taskId: string): WorkItem => ({
  id: wi.id,
  taskId,
  author: wi.author?.login ?? wi.author?.name ?? 'unknown',
  date: new Date(wi.date).toISOString().slice(0, 10),
  duration: minutesToIso(wi.duration.minutes),
  description: wi.text ?? undefined,
  type: wi.type?.name,
})

const dateToTimestamp = (date: string): number => {
  // date is "YYYY-MM-DD", convert to ms since epoch (start of day UTC)
  return new Date(`${date}T00:00:00.000Z`).getTime()
}

const getTodayUtcTimestamp = (): number => dateToTimestamp(new Date().toISOString().slice(0, 10))

const parseDurationMinutes = (input: string): number => {
  try {
    return isoToMinutes(parseDuration(input))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new YouTrackClassifiedError(reason, providerError.validationFailed('duration', reason))
  }
}

const resolveWorkItemType = async (config: YouTrackConfig, input: string): Promise<{ id: string }> => {
  const typeId = await resolveWorkItemTypeId(config, input)
  if (typeId === undefined) {
    const reason = `Unknown work item type "${input}"`
    throw new YouTrackClassifiedError(reason, providerError.validationFailed('type', reason))
  }
  return { id: typeId }
}

export async function listYouTrackWorkItems(
  config: YouTrackConfig,
  taskId: string,
  params?: { limit?: number; offset?: number },
): Promise<WorkItem[]> {
  log.debug({ taskId, params }, 'listWorkItems')
  try {
    if (params?.limit !== undefined) {
      const query: Record<string, string> = { fields: WORK_ITEM_FIELDS }
      if (params.limit !== undefined) query['$top'] = String(params.limit)
      if (params.offset !== undefined) query['$skip'] = String(params.offset)

      const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/timeTracking/workItems`, { query })
      const items = YouTrackWorkItemSchema.array().parse(raw)
      log.info({ taskId, count: items.length }, 'Work items listed')
      return items.map((wi) => mapWorkItem(wi, taskId))
    }

    const items = await paginate(
      config,
      `/api/issues/${taskId}/timeTracking/workItems`,
      { fields: WORK_ITEM_FIELDS },
      YouTrackWorkItemSchema.array(),
      undefined,
      undefined,
      params?.offset ?? 0,
    )
    log.info({ taskId, count: items.length }, 'Work items listed')
    return items.map((wi) => mapWorkItem(wi, taskId))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list work items')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function createYouTrackWorkItem(
  config: YouTrackConfig,
  taskId: string,
  params: CreateWorkItemParams,
): Promise<WorkItem> {
  log.debug({ taskId, duration: params.duration }, 'createWorkItem')
  try {
    const minutes = parseDurationMinutes(params.duration)
    const date = params.date === undefined ? getTodayUtcTimestamp() : dateToTimestamp(params.date)

    const body: Record<string, unknown> = {
      duration: { minutes },
      date,
    }

    if (params.description !== undefined) body['text'] = params.description
    if (params.author !== undefined) body['author'] = { login: params.author }

    if (params.type !== undefined) {
      body['type'] = await resolveWorkItemType(config, params.type)
    }

    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/timeTracking/workItems`, {
      body,
      query: { fields: WORK_ITEM_FIELDS },
    })
    const wi = YouTrackWorkItemSchema.parse(raw)
    log.info({ taskId, workItemId: wi.id }, 'Work item created')
    return mapWorkItem(wi, taskId)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to create work item')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function updateYouTrackWorkItem(
  config: YouTrackConfig,
  taskId: string,
  workItemId: string,
  params: UpdateWorkItemParams,
): Promise<WorkItem> {
  log.debug({ taskId, workItemId }, 'updateWorkItem')
  try {
    const body: Record<string, unknown> = {}

    if (params.duration !== undefined) {
      body['duration'] = { minutes: parseDurationMinutes(params.duration) }
    }

    if (params.date !== undefined) {
      body['date'] = dateToTimestamp(params.date)
    }

    if (params.description !== undefined) body['text'] = params.description

    if (params.type !== undefined) {
      body['type'] = await resolveWorkItemType(config, params.type)
    }

    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/timeTracking/workItems/${workItemId}`, {
      body,
      query: { fields: WORK_ITEM_FIELDS },
    })
    const wi = YouTrackWorkItemSchema.parse(raw)
    log.info({ taskId, workItemId: wi.id }, 'Work item updated')
    return mapWorkItem(wi, taskId)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, workItemId },
      'Failed to update work item',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function deleteYouTrackWorkItem(
  config: YouTrackConfig,
  taskId: string,
  workItemId: string,
): Promise<{ id: string }> {
  log.debug({ taskId, workItemId }, 'deleteWorkItem')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/timeTracking/workItems/${workItemId}`)
    log.info({ taskId, workItemId }, 'Work item deleted')
    return { id: workItemId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, workItemId },
      'Failed to delete work item',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

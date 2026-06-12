// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
import { classifyYouTrackError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { TAG_FIELDS } from './constants.js'
import { paginate } from './helpers.js'
import { TagSchema } from './schemas/tag.js'

const log = logger.child({ scope: 'provider:youtrack:labels' })

export async function listYouTrackLabels(config: YouTrackConfig): Promise<Label[]> {
  log.debug('listLabels')
  try {
    const raw = await youtrackFetch(config, 'GET', '/api/tags', {
      query: { fields: TAG_FIELDS, $top: '100' },
    })
    const tags = TagSchema.array().parse(raw)
    log.info({ count: tags.length }, 'Tags listed')
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color?.background }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list labels')
    throw classifyYouTrackError(error)
  }
}

export async function findYouTrackLabelsByName(config: Readonly<YouTrackConfig>, labelName: string): Promise<Label[]> {
  log.debug({ labelName }, 'findLabelsByName')
  try {
    const tags = await paginate(
      config,
      '/api/tags',
      { fields: TAG_FIELDS, query: labelName },
      TagSchema.array(),
      10,
      100,
    )
    const labels = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color?.background,
    }))
    log.info({ labelName, count: labels.length }, 'Tags looked up by name')
    return labels.filter((label) => label.name === labelName)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), labelName },
      'Failed to look up labels by name',
    )
    throw classifyYouTrackError(error)
  }
}

export async function createYouTrackLabel(
  config: YouTrackConfig,
  params: { name: string; color?: string },
): Promise<Label> {
  log.debug({ name: params.name, color: params.color }, 'createLabel')
  try {
    const body: Record<string, unknown> = { name: params.name }
    if (params.color !== undefined) {
      body['color'] = { background: params.color }
    }
    const raw = await youtrackFetch(config, 'POST', '/api/tags', {
      body,
      query: { fields: TAG_FIELDS },
    })
    const tag = TagSchema.parse(raw)
    log.info({ tagId: tag.id, name: tag.name }, 'Tag created')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create label')
    throw classifyYouTrackError(error)
  }
}

export async function updateYouTrackLabel(
  config: YouTrackConfig,
  labelId: string,
  params: { name?: string; color?: string },
): Promise<Label> {
  log.debug({ labelId }, 'updateLabel')
  try {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.color !== undefined) {
      body['color'] = { background: params.color }
    }
    const raw = await youtrackFetch(config, 'POST', `/api/tags/${labelId}`, {
      body,
      query: { fields: TAG_FIELDS },
    })
    const tag = TagSchema.parse(raw)
    log.info({ tagId: tag.id }, 'Tag updated')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'Failed to update label')
    throw classifyYouTrackError(error, { labelId })
  }
}

export async function removeYouTrackLabel(config: YouTrackConfig, labelId: string): Promise<{ id: string }> {
  log.debug({ labelId }, 'removeLabel')
  try {
    await youtrackFetch(config, 'DELETE', `/api/tags/${labelId}`)
    log.info({ labelId }, 'Tag deleted')
    return { id: labelId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'Failed to remove label')
    throw classifyYouTrackError(error, { labelId })
  }
}

export async function addYouTrackTaskLabel(
  config: YouTrackConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'addTaskLabel')
  try {
    await youtrackFetch(config, 'POST', `/api/issues/${taskId}/tags`, {
      body: { id: labelId },
      query: { fields: TAG_FIELDS },
    })
    log.info({ taskId, labelId }, 'Tag added to issue')
    return { taskId, labelId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, labelId },
      'Failed to add label to task',
    )
    throw classifyYouTrackError(error, { taskId, labelId })
  }
}

export async function removeYouTrackTaskLabel(
  config: YouTrackConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'removeTaskLabel')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/tags/${labelId}`)
    log.info({ taskId, labelId }, 'Tag removed from issue')
    return { taskId, labelId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, labelId },
      'Failed to remove label from task',
    )
    throw classifyYouTrackError(error, { taskId, labelId })
  }
}

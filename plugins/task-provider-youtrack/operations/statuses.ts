// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Column } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { resolveStateBundle } from '../bundle-cache.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { StateValueSchema } from '../schemas/bundle.js'

const log = logger.child({ scope: 'provider:youtrack:statuses' })

const STATE_VALUE_FIELDS = 'id,name,isResolved,ordinal'

const StateValueArraySchema = z.array(StateValueSchema)

export type ConfirmationRequiredResult = {
  status: 'confirmation_required'
  message: string
}

export async function listYouTrackStatuses(config: YouTrackConfig, projectId: string): Promise<Column[]> {
  log.debug({ projectId }, 'listYouTrackStatuses')

  try {
    const bundleInfo = await resolveStateBundle(config, projectId)
    if (bundleInfo === null) {
      log.warn({ projectId }, 'State bundle not found for project')
      return []
    }

    const raw = await youtrackFetch(
      config,
      'GET',
      `/api/admin/customFieldSettings/bundles/state/${bundleInfo.bundleId}/values`,
      {
        query: { fields: STATE_VALUE_FIELDS },
      },
    )

    const values = StateValueArraySchema.parse(raw)

    log.info({ projectId, count: values.length }, 'States listed')

    return values.map((v) => ({
      id: v.id,
      name: v.name,
      order: v.ordinal,
      isFinal: v.isResolved,
    }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to list statuses')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function createYouTrackStatus(
  config: YouTrackConfig,
  projectId: string,
  params: { name: string; isFinal?: boolean },
  confirm?: boolean,
): Promise<Column | ConfirmationRequiredResult> {
  log.debug({ projectId, name: params.name }, 'createYouTrackStatus')

  try {
    const bundleInfo = await resolveStateBundle(config, projectId)
    if (bundleInfo === null) {
      const reason = 'State bundle not found for project'
      throw new YouTrackClassifiedError(reason, providerError.notFound('State bundle', projectId))
    }

    if (bundleInfo.isShared && confirm !== true) {
      return {
        status: 'confirmation_required',
        message: `This project uses a shared state bundle. Creating a new state will affect other projects. Set confirm=true to proceed.`,
      }
    }

    const body: Record<string, unknown> = { name: params.name }
    if (params.isFinal !== undefined) body['isResolved'] = params.isFinal

    const raw = await youtrackFetch(
      config,
      'POST',
      `/api/admin/customFieldSettings/bundles/state/${bundleInfo.bundleId}/values`,
      {
        body,
        query: { fields: STATE_VALUE_FIELDS },
      },
    )

    const value = StateValueSchema.parse(raw)

    log.info({ projectId, statusId: value.id, name: value.name }, 'State created')

    return {
      id: value.id,
      name: value.name,
      order: value.ordinal,
      isFinal: value.isResolved,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to create status')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function updateYouTrackStatus(
  config: YouTrackConfig,
  projectId: string,
  statusId: string,
  params: { name?: string; isFinal?: boolean },
  confirm?: boolean,
): Promise<Column | ConfirmationRequiredResult> {
  log.debug({ projectId, statusId }, 'updateYouTrackStatus')
  try {
    const bundleInfo = await resolveStateBundle(config, projectId)
    if (bundleInfo === null) {
      throw new YouTrackClassifiedError(
        'State bundle not found for project',
        providerError.notFound('State bundle', projectId),
      )
    }
    if (bundleInfo.isShared && confirm !== true) {
      return {
        status: 'confirmation_required',
        message: `This project uses a shared state bundle. Updating this state will affect other projects. Set confirm=true to proceed.`,
      }
    }
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.isFinal !== undefined) body['isResolved'] = params.isFinal
    const raw = await youtrackFetch(
      config,
      'POST',
      `/api/admin/customFieldSettings/bundles/state/${bundleInfo.bundleId}/values/${statusId}`,
      { body, query: { fields: STATE_VALUE_FIELDS } },
    )
    const value = StateValueSchema.parse(raw)
    log.info({ projectId, statusId: value.id }, 'State updated')
    return { id: value.id, name: value.name, order: value.ordinal, isFinal: value.isResolved }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId, statusId },
      'Failed to update status',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function deleteYouTrackStatus(
  config: YouTrackConfig,
  projectId: string,
  statusId: string,
  confirm?: boolean,
): Promise<{ id: string } | ConfirmationRequiredResult> {
  log.debug({ projectId, statusId }, 'deleteYouTrackStatus')

  try {
    const bundleInfo = await resolveStateBundle(config, projectId)
    if (bundleInfo === null) {
      throw new YouTrackClassifiedError(
        'State bundle not found for project',
        providerError.notFound('State bundle', projectId),
      )
    }

    if (bundleInfo.isShared && confirm !== true) {
      return {
        status: 'confirmation_required',
        message: `This project uses a shared state bundle. Deleting this state will affect other projects. Set confirm=true to proceed.`,
      }
    }

    await youtrackFetch(
      config,
      'DELETE',
      `/api/admin/customFieldSettings/bundles/state/${bundleInfo.bundleId}/values/${statusId}`,
    )

    log.info({ projectId, statusId }, 'State deleted')

    return { id: statusId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId, statusId },
      'Failed to delete status',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

async function updateStatusOrdinals(
  config: YouTrackConfig,
  bundleId: string,
  projectId: string,
  statuses: Array<{ id: string; position: number }>,
): Promise<void> {
  const results = await Promise.allSettled(
    statuses.map((status) =>
      youtrackFetch(config, 'POST', `/api/admin/customFieldSettings/bundles/state/${bundleId}/values/${status.id}`, {
        body: { ordinal: status.position },
        query: { fields: STATE_VALUE_FIELDS },
      }),
    ),
  )

  const failures: Array<{ statusId: string; error: unknown }> = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result !== undefined && result.status === 'rejected') {
      failures.push({ statusId: statuses[i]!.id, error: result.reason })
    }
  }

  if (failures.length > 0) {
    const failureDetails = failures
      .map((f) => `${f.statusId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
      .join(', ')
    log.error(
      { projectId, failureCount: failures.length, failures: failureDetails },
      'Partial failure reordering statuses',
    )

    const enhancedError = new Error(
      `Failed to reorder ${failures.length} of ${statuses.length} statuses: ${failureDetails}`,
    )
    throw classifyYouTrackError(enhancedError, { projectId })
  }
}

export async function reorderYouTrackStatuses(
  config: YouTrackConfig,
  projectId: string,
  statuses: Array<{ id: string; position: number }>,
  confirm?: boolean,
): Promise<undefined | ConfirmationRequiredResult> {
  log.debug({ projectId, count: statuses.length }, 'reorderYouTrackStatuses')
  try {
    const bundleInfo = await resolveStateBundle(config, projectId)
    if (bundleInfo === null) {
      const reason = 'State bundle not found for project'
      throw new YouTrackClassifiedError(reason, providerError.notFound('State bundle', projectId))
    }
    if (bundleInfo.isShared && confirm !== true) {
      return {
        status: 'confirmation_required',
        message: `This project uses a shared state bundle. Reordering states will affect other projects. Set confirm=true to proceed.`,
      }
    }

    await updateStatusOrdinals(config, bundleInfo.bundleId, projectId, statuses)

    log.info({ projectId, count: statuses.length }, 'States reordered')
    return undefined
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to reorder statuses',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}

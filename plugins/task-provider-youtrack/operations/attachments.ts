// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Attachment } from 'papai/plugin-types'

import { logger } from '../../../src/logger.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch, youtrackUpload } from '../client.js'
import { ATTACHMENT_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { mapAttachment } from '../mappers.js'
import { YouTrackAttachmentSchema } from '../schemas/attachment.js'

const log = logger.child({ scope: 'provider:youtrack:attachments' })

export async function listYouTrackAttachments(config: YouTrackConfig, taskId: string): Promise<Attachment[]> {
  log.debug({ taskId }, 'listAttachments')
  try {
    const attachments = await paginate(
      config,
      `/api/issues/${taskId}/attachments`,
      { fields: ATTACHMENT_FIELDS },
      YouTrackAttachmentSchema.array(),
    )
    log.info({ taskId, count: attachments.length }, 'Attachments listed')
    return attachments.map(mapAttachment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list attachments')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function uploadYouTrackAttachment(
  config: YouTrackConfig,
  taskId: string,
  file: { name: string; content: Uint8Array | Blob; mimeType?: string },
): Promise<Attachment> {
  log.debug({ taskId, fileName: file.name }, 'uploadAttachment')
  try {
    const raw = await youtrackUpload(config, `/api/issues/${taskId}/attachments`, file, {
      fields: ATTACHMENT_FIELDS,
    })
    // YouTrack returns an array of uploaded attachments
    const attachments = YouTrackAttachmentSchema.array().parse(raw)
    const uploaded = attachments[0]
    if (uploaded === undefined) {
      throw new Error('No attachment returned from upload')
    }
    log.info({ taskId, attachmentId: uploaded.id, fileName: uploaded.name }, 'Attachment uploaded')
    return mapAttachment(uploaded)
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        taskId,
        fileName: file.name,
      },
      'Failed to upload attachment',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function deleteYouTrackAttachment(
  config: YouTrackConfig,
  taskId: string,
  attachmentId: string,
): Promise<{ id: string }> {
  log.debug({ taskId, attachmentId }, 'deleteAttachment')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/attachments/${attachmentId}`)
    log.info({ taskId, attachmentId }, 'Attachment deleted')
    return { id: attachmentId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, attachmentId },
      'Failed to delete attachment',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

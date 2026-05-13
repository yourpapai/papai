import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { loadAttachmentRecord } from '../attachments/index.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:upload-attachment' })

export type UploadAttachmentStatus = { status: 'attachment_not_found'; message: string }

async function executeUpload(
  provider: TaskProvider,
  contextId: string,
  taskId: string,
  attachmentId: string,
): Promise<unknown> {
  const record = await loadAttachmentRecord(contextId, attachmentId)

  if (record === null) {
    log.warn({ taskId, attachmentId }, 'upload_attachment: attachmentId not found in workspace')
    return {
      status: 'attachment_not_found',
      message: `Attachment "${attachmentId}" is not available in this context. Ask the user to resend the file.`,
    } satisfies UploadAttachmentStatus
  }

  const result = await provider.uploadAttachment!(taskId, {
    name: record.filename,
    content: record.content,
    mimeType: record.mimeType,
  })
  log.info({ taskId, attachmentId: result.id, filename: record.filename }, 'Attachment uploaded')
  return result
}

export function makeUploadAttachmentTool(provider: TaskProvider, contextId: string): ToolSet[string] {
  return tool({
    description:
      'Upload a file attachment to a task. The file must already be in the current conversation attachment workspace (sent by the user during this conversation).',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to attach the file to'),
      attachmentId: z
        .string()
        .describe('Stable papai attachment ID from the current conversation context (e.g. att_<uuid>)'),
    }),
    execute: async ({ taskId, attachmentId }) => {
      log.debug({ taskId, attachmentId, contextId }, 'upload_attachment called')
      try {
        return await executeUpload(provider, contextId, taskId, attachmentId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            attachmentId,
            tool: 'upload_attachment',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}

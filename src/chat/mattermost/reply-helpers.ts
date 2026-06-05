// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ButtonReplyOptions, ReplyFn, ReplyOptions } from '../types.js'
import type { MattermostActionContextInput, MattermostSignedActionContext } from './action-signing.js'

const ACTION_TTL_MS = 5 * 60 * 1000
const MATTERMOST_MAX_BUTTONS = 5

type MattermostButtonAction = Readonly<{
  id: string
  type: 'button'
  name: string
  style: string
  integration: { url: string; context: MattermostSignedActionContext }
}>

interface MattermostReplyHelpersParams {
  channelId: string
  postId?: string
  threadId?: string
  getWsSeq: () => number
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
  wsSend: (message: { seq: number; action: string; data: Record<string, unknown> }) => void
  uploadFile: (channelId: string, content: Buffer | string, filename: string) => Promise<string>
  platformInstanceId: string
  callbackBaseUrl: string | null
  createActionContext: (input: MattermostActionContextInput) => MattermostSignedActionContext
}

const callbackUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/u, '')}/mattermost/actions`

const mattermostStyle = (style: 'primary' | 'secondary' | 'danger' | undefined): string => {
  if (style === 'primary') return 'primary'
  if (style === 'danger') return 'danger'
  return 'default'
}

const buildActions = (
  content: string,
  options: ButtonReplyOptions,
  platformInstanceId: string,
  baseUrl: string,
  createActionContext: (input: MattermostActionContextInput) => MattermostSignedActionContext,
): MattermostButtonAction[] => {
  const buttons = options.buttons ?? []
  if (buttons.length > MATTERMOST_MAX_BUTTONS) {
    throw new Error(`too many Mattermost buttons: got ${String(buttons.length)}, max ${String(MATTERMOST_MAX_BUTTONS)}`)
  }
  return buttons.map((button, index) => ({
    id: `action${String(index)}`,
    type: 'button',
    name: button.text,
    style: mattermostStyle(button.style),
    integration: {
      url: callbackUrl(baseUrl),
      context: createActionContext({
        platformInstanceId,
        callbackData: button.callbackData,
        sourceMessageText: content,
        expiresAt: Date.now() + ACTION_TTL_MS,
      }),
    },
  }))
}

export function createMattermostReplyFn(params: MattermostReplyHelpersParams): ReplyFn {
  const {
    channelId,
    postId,
    threadId,
    getWsSeq,
    apiFetch,
    wsSend,
    uploadFile,
    platformInstanceId,
    callbackBaseUrl,
    createActionContext,
  } = params

  const post = async (message: string, options?: ReplyOptions, extra?: Record<string, unknown>): Promise<void> => {
    await apiFetch('POST', '/api/v4/posts', {
      channel_id: channelId,
      message,
      root_id: options?.threadId ?? threadId ?? '',
      ...extra,
    })
  }

  return {
    text: (content: string, options?: ReplyOptions) => post(content, options),
    formatted: (markdown: string, options?: ReplyOptions) => post(markdown, options),
    file: async (file, options?: ReplyOptions) => {
      const fileId = await uploadFile(channelId, file.content, file.filename)
      await post('', options, { file_ids: [fileId] })
    },
    typing: () => {
      wsSend({ seq: getWsSeq(), action: 'user_typing', data: { channel_id: channelId } })
    },
    redactMessage: async (replacementText: string) => {
      if (postId !== undefined) {
        await apiFetch('PUT', `/api/v4/posts/${postId}/patch`, { message: replacementText }).catch(() => undefined)
      }
    },
    deleteMessage: async (messageId: string) => {
      await apiFetch('DELETE', `/api/v4/posts/${messageId}`, undefined)
    },
    buttons: (content: string, options: ButtonReplyOptions): Promise<void> => {
      if (callbackBaseUrl === null) {
        return Promise.reject(new Error('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL'))
      }
      const actions = buildActions(content, options, platformInstanceId, callbackBaseUrl, createActionContext)
      return post(content, options, { props: { attachments: [{ actions }] } })
    },
  }
}

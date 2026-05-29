// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ButtonReplyOptions, ReplyFn, ReplyOptions } from '../types.js'

interface KonturTalkReplyHelpersParams {
  roomId: string
  threadId?: string
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
}

export function createKonturTalkReplyFn(params: KonturTalkReplyHelpersParams): ReplyFn {
  const { roomId, threadId, apiFetch } = params

  const send = async (message: string, format: string, options?: ReplyOptions): Promise<void> => {
    await apiFetch('POST', '/send_message', {
      room_id: roomId,
      message,
      format,
      thread_id: options?.threadId ?? threadId ?? null,
      mentions: [],
    })
  }

  return {
    text: (content: string, options?: ReplyOptions) => send(content, 'plain', options),
    formatted: (markdown: string, options?: ReplyOptions) => send(markdown, 'markdown', options),
    typing: () => {
      // no-op: Kontur Talk has no typing indicator API
    },
    buttons: (_content: string, _options: ButtonReplyOptions): Promise<void> => {
      return Promise.reject(
        new Error(
          'Kontur Talk does not support interactive buttons. Use supportsInteractiveButtons() to check before calling reply.buttons().',
        ),
      )
    },
  }
}

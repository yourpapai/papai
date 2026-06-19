// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { PromptHandle } from '../types.js'

const log = logger.child({ scope: 'chat:discord:reply' })

type SentMessage = {
  id: string
  edit: (arg: Partial<{ content: string; components: unknown[] }>) => Promise<unknown>
} & Partial<{ delete: () => Promise<unknown> }>

/** Build a PromptHandle for the given sent Discord message. */
export function buildPromptHandle(sent: SentMessage): PromptHandle {
  return {
    redact: async (editText: string): Promise<void> => {
      await sent.edit({ content: editText, components: [] }).catch((err: unknown) => {
        log.warn({ id: sent.id, error: err instanceof Error ? err.message : String(err) }, 'Failed to redact prompt')
      })
    },
    remove: async (): Promise<void> => {
      if (sent.delete === undefined) return
      await sent.delete().catch((err: unknown) => {
        log.warn({ id: sent.id, error: err instanceof Error ? err.message : String(err) }, 'Failed to remove prompt')
      })
    },
  }
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { appendHistory } from './history.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'proactive-history' })

export interface RecordProactiveDeps {
  persist: (storageContextId: string, messages: readonly ModelMessage[]) => void
}

const defaultDeps: RecordProactiveDeps = { persist: appendHistory }

/**
 * Record a proactively-sent bot message into the thread's conversation history
 * so the LLM sees it on the next turn.
 *
 * Call ONLY after the message was successfully delivered, and ONLY with a
 * correctly-scoped storage context id (the `pi:<inst>:ctx:<native>[:thread:...]`
 * form produced by `toScopedContextId` / `getThreadScopedStorageContextId` — the
 * same bucket the user's normal conversation uses). Never pass a bare native id.
 *
 * Best-effort: a persistence failure is logged and swallowed so it can never
 * affect delivery. Does not trigger history trimming — the next normal turn does.
 */
export function recordProactiveInHistory(
  storageContextId: string,
  markdown: string,
  deps: RecordProactiveDeps = defaultDeps,
): void {
  try {
    deps.persist(storageContextId, [{ role: 'assistant', content: markdown }])
    log.debug({ storageContextId }, 'proactive message recorded to history')
  } catch (error) {
    log.warn(
      { storageContextId, error: error instanceof Error ? error.message : String(error) },
      'failed to record proactive message to history',
    )
  }
}

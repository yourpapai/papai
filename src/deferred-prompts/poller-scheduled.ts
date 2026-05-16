// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { nextOccurrence } from '../recurrence.js'
import { advanceScheduledPrompt, completeScheduledPrompt } from './scheduled.js'
import type { ExecutionMetadata, ExecutionMode, ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller:scheduled' })

const MODE_PRIORITY: Record<ExecutionMode, number> = { lightweight: 0, context: 1, full: 2 }
const MODE_BY_PRIORITY: ExecutionMode[] = ['lightweight', 'context', 'full']

export function mergeExecutionMetadata(prompts: ScheduledPrompt[]): ExecutionMetadata {
  let maxPriority = 0
  const briefs: string[] = []
  const snapshots: string[] = []

  for (const prompt of prompts) {
    const metadata = prompt.executionMetadata
    maxPriority = Math.max(maxPriority, MODE_PRIORITY[metadata.mode])
    if (metadata.delivery_brief !== '') briefs.push(metadata.delivery_brief)
    if (metadata.context_snapshot !== null) snapshots.push(metadata.context_snapshot)
  }

  return {
    mode: MODE_BY_PRIORITY[maxPriority]!,
    delivery_brief: briefs.join('\n---\n'),
    context_snapshot: snapshots.length > 0 ? snapshots.join('\n---\n') : null,
  }
}

function finalizeRecurring(prompt: ScheduledPrompt, now: string, timezone: string): void {
  const next = nextOccurrence(
    { rrule: prompt.rrule!, dtstartUtc: prompt.dtstartUtc!, timezone: prompt.timezone ?? timezone },
    new Date(now),
  )
  if (next === null) {
    completeScheduledPrompt(prompt.id, prompt.createdByUserId, now)
    log.warn({ id: prompt.id, userId: prompt.createdByUserId }, 'Could not compute next occurrence, completing prompt')
    return
  }

  advanceScheduledPrompt(prompt.id, prompt.createdByUserId, next.toISOString(), now)
  log.info(
    { id: prompt.id, userId: prompt.createdByUserId, nextFireAt: next.toISOString() },
    'Recurring scheduled prompt advanced',
  )
}

export function finalizeAllPrompts(prompts: ScheduledPrompt[], now: string, timezone: string): void {
  for (const prompt of prompts) {
    if (prompt.rrule === null) {
      completeScheduledPrompt(prompt.id, prompt.createdByUserId, now)
      log.info({ id: prompt.id, userId: prompt.createdByUserId }, 'One-shot scheduled prompt completed')
      continue
    }

    finalizeRecurring(prompt, now, timezone)
  }
}

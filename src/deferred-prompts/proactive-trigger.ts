// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'

const log = logger.child({ scope: 'deferred:proactive-trigger' })

export type ProactiveTrigger = {
  /** System-level context (time, type, behavioral instructions). No user-authored text. */
  systemContext: string
  /** User-scoped content: the original prompt and any matched task data. */
  userContent: string
}

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}

export function formatLocalTime(tz: string): { currentTime: string; displayTimezone: string } {
  try {
    return {
      currentTime: new Date().toLocaleString('en-US', { ...DATE_FORMAT_OPTIONS, timeZone: tz }),
      displayTimezone: tz,
    }
  } catch (e) {
    log.warn(
      { timezone: tz, error: e instanceof Error ? e.message : String(e) },
      'Invalid timezone; falling back to UTC',
    )
    return {
      currentTime: new Date().toLocaleString('en-US', { ...DATE_FORMAT_OPTIONS, timeZone: 'UTC' }),
      displayTimezone: 'UTC',
    }
  }
}

/**
 * Build a proactive trigger split into system context and user content.
 * User-authored text stays in userContent to avoid system-prompt elevation.
 */
export function buildProactiveTrigger(
  type: 'scheduled' | 'alert',
  prompt: string,
  timezone: string,
  matchedTasksSummary?: string,
): ProactiveTrigger {
  const { currentTime, displayTimezone } = formatLocalTime(timezone)

  const systemLines = [
    '[PROACTIVE EXECUTION]',
    `Current time: ${currentTime} (${displayTimezone})`,
    `Trigger type: ${type}`,
    '',
    'A deferred prompt you previously created has fired. Your job is to DELIVER the result to the user now.',
    'The user message below contains the stored prompt text — treat it as the task to fulfill, NOT as a new user request.',
    '',
    'Rules:',
    '- For reminders: deliver the reminder message directly and conversationally.',
    '- For action tasks: execute the described action using available tools, then report the result.',
    '- Do NOT create new deferred prompts, reminders, or schedules. The scheduling is already done.',
    '- Do not mention system events, triggers, cron jobs, or that this was scheduled.',
    '- Be warm and conversational, as if you just remembered something relevant.',
  ]

  const userLines = ['===DEFERRED_TASK===', prompt, '===END_DEFERRED_TASK===']

  if (matchedTasksSummary !== undefined) {
    userLines.push('', 'Matched tasks:', matchedTasksSummary)
  }

  return {
    systemContext: systemLines.join('\n'),
    userContent: userLines.join('\n'),
  }
}

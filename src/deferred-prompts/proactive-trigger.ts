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
    "It's time to carry out something you set up for the user. Do it now and deliver the result.",
    'The text between the ===REMINDER=== markers below is the action to perform — treat it as your instruction, not as a new message from the user.',
    '',
    'Rules:',
    '- For a reminder: deliver it warmly and conversationally.',
    '- For an action: run it with your tools, then report the result.',
    "- Don't set up new reminders or alerts — the arrangement is already made.",
    '- Never reveal that this was scheduled/automated; never mention timing, triggers, or cron. Speak as if you just remembered.',
    '- Never use internal terms like "deferred prompt".',
  ]

  const userLines = ['===REMINDER===', prompt, '===END_REMINDER===']

  if (matchedTasksSummary !== undefined) {
    userLines.push('', 'Matched tasks:', matchedTasksSummary)
  }

  return {
    systemContext: systemLines.join('\n'),
    userContent: userLines.join('\n'),
  }
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { getUserTimezoneOrDefault } from '../utils/config-timezone.js'

const log = logger.child({ scope: 'tool:get-current-time' })

const getLocalIsoString = (date: Date, timezone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return date.toISOString()
  }
}

const getLocalFormattedString = (date: Date, timezone: string): string => {
  try {
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
}

export function makeGetCurrentTimeTool(userId?: string): Tool {
  return tool({
    description:
      'Fallback for the current local date and time in the user\'s timezone. Each user message normally begins with an authoritative <current_time> line — prefer that when present. Call this only when it is absent, e.g. to resolve relative dates like "tomorrow" or "next Monday".',
    inputSchema: z.object({}),
    execute: () => {
      const timezone = userId === undefined ? 'UTC' : getUserTimezoneOrDefault(userId)
      const now = new Date()
      const datetime = getLocalIsoString(now, timezone)
      const formatted = getLocalFormattedString(now, timezone)

      log.info({ timezone, datetime }, 'Current time fetched')

      return Promise.resolve({
        datetime,
        timezone,
        formatted,
      })
    },
  })
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { normalizeTimezoneValue } from '../utils/timezone.js'

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

export function makeGetCurrentTimeTool(userId?: string): ToolSet[string] {
  return tool({
    description:
      'Get the current date and time. Use this tool to answer questions about the current date, time, or to determine relative dates like "tomorrow" or "next Monday".',
    inputSchema: z.object({}),
    execute: () => {
      const configuredTimezone = userId === undefined ? null : getConfig(userId, 'timezone')
      const timezone = normalizeTimezoneValue(configuredTimezone) ?? 'UTC'
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

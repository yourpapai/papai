// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfig } from '../config.js'
import { normalizeTimezoneValue } from './timezone.js'

const INVALID_TIMEZONE_ERROR =
  'Your configured timezone is invalid. Please update it in /config or rerun /setup and try again.'

export function getUserTimezoneOrDefault(userId: string, fallback = 'UTC'): string {
  return normalizeTimezoneValue(getConfig(userId, 'timezone')) ?? fallback
}

export function getUserTimezoneOrError(userId: string): string | { error: string } {
  const configuredTimezone = getConfig(userId, 'timezone')
  if (configuredTimezone === null) return 'UTC'

  const timezone = normalizeTimezoneValue(configuredTimezone)
  return timezone ?? { error: INVALID_TIMEZONE_ERROR }
}

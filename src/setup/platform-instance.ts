// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformInstances } from '../instances/platform-store.js'
import type { PlatformInstance } from '../instances/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'setup:platform-instance' })

const getCurrentChatProvider = (): string | null => {
  const value = process.env['CHAT_PROVIDER']
  if (value === undefined || value.trim() === '') return null
  return value.trim()
}

export function resolveCurrentPlatformInstanceId(): string | null {
  const chatProvider = getCurrentChatProvider()
  if (chatProvider === null) {
    log.warn('Cannot assign setup context: CHAT_PROVIDER is missing')
    return null
  }

  const matches: PlatformInstance[] = listPlatformInstances().filter(
    (instance) => instance.status === 'active' && instance.type === chatProvider,
  )
  if (matches.length !== 1) {
    log.warn({ chatProvider, activeMatches: matches.length }, 'Cannot determine unique active platform instance')
    return null
  }
  return matches[0]!.id
}

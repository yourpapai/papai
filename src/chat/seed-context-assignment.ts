// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ensureContextPlatformInstance } from '../instances/context-store.js'
import { logger } from '../logger.js'
import type { AuthorizationResult } from './authorization-types.js'

const log = logger.child({ scope: 'chat:seed-context-assignment' })

// Records the context's platform assignment the first time it is seen, so new users are
// visible in admin/settings before /config. Best-effort; never blocks the turn. Guests are
// never provisioned, so they are not seeded. Idempotent and non-clobbering downstream.
export const maybeSeedContextAssignment = (auth: AuthorizationResult, platformInstanceId: string): void => {
  if (auth.isGuest === true || auth.configContextId === undefined) return
  try {
    ensureContextPlatformInstance(auth.configContextId, platformInstanceId)
  } catch (error: unknown) {
    log.warn(
      {
        configContextId: auth.configContextId,
        platformInstanceId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to seed context platform instance',
    )
  }
}

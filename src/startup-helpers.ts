// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from './logger.js'

export const warnIfLegacyDebugToken = (): void => {
  if (process.env['DEBUG_TOKEN'] !== undefined && process.env['DEBUG_TOKEN'] !== '') {
    logger.warn(
      'DEBUG_TOKEN is ignored — dashboard auth is now chat-issued. Remove DEBUG_TOKEN from your env and DM /dashboard to sign in.',
    )
  }
}

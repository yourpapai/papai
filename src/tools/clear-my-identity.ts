// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getDrizzleDb as defaultGetDrizzleDb } from '../db/drizzle.js'
import {
  clearIdentityMapping as defaultClearIdentityMapping,
  getIdentityMapping as defaultGetIdentityMapping,
  type IdentityMappingDeps,
} from '../identity/mapping.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:clear-my-identity' })

export interface ClearMyIdentityDeps extends IdentityMappingDeps {
  getIdentityMapping: typeof defaultGetIdentityMapping
  clearIdentityMapping: typeof defaultClearIdentityMapping
}

const defaultDeps: ClearMyIdentityDeps = {
  getIdentityMapping: defaultGetIdentityMapping,
  clearIdentityMapping: defaultClearIdentityMapping,
  getDrizzleDb: defaultGetDrizzleDb,
}

export function makeClearMyIdentityTool(
  provider: TaskProvider,
  chatUserId: string,
  deps: ClearMyIdentityDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      "Clear the user's task tracker identity mapping. Use when user says things like 'I'm not Alice', 'That's not me', 'These aren't my tasks', or 'Unlink my account'.",
    inputSchema: z.object({}),
    execute: () => {
      log.debug({ chatUserId }, 'clear_my_identity called')

      const existing = deps.getIdentityMapping(chatUserId, provider.name, deps)
      if (existing === null || existing.providerUserId === null) {
        return {
          status: 'info',
          message: 'No identity mapping to clear.',
        }
      }

      deps.clearIdentityMapping(chatUserId, provider.name, deps)

      log.info({ chatUserId }, 'Identity cleared via NL')
      return {
        status: 'success',
        message: "Okay, I've unlinked you. Tell me your correct login (e.g., 'I'm jsmith').",
      }
    },
  })
}

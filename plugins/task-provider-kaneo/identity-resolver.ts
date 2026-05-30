// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IdentityUser, UserIdentityResolver } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
import type { KaneoConfig } from './client.js'
import { kaneoListUsers } from './operations/users.js'

const log = logger.child({ scope: 'provider:kaneo:identity' })

export function createKaneoIdentityResolver(config: KaneoConfig, workspaceId: string): UserIdentityResolver {
  log.debug('createKaneoIdentityResolver called')

  return {
    async searchUsers(query: string, limit?: number) {
      log.debug({ query, limit }, 'Kaneo searchUsers called')

      try {
        const users = await kaneoListUsers(config, workspaceId, query, limit ?? 10)
        return users.map(
          (u): IdentityUser => ({
            id: u.id,
            login: u.login ?? u.id,
            name: u.name ?? u.login ?? u.id,
          }),
        )
      } catch (error) {
        log.error({ error: error instanceof Error ? error.message : String(error), query }, 'Kaneo searchUsers failed')
        throw error
      }
    },
  }
}

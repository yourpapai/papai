// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IdentityUser, UserIdentityResolver } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
import type { YouTrackConfig } from './client.js'
import { listYouTrackUsers, resolveYouTrackUserRingId } from './operations/users.js'

const log = logger.child({ scope: 'provider:youtrack:identity' })

/** Extended identity resolver with YouTrack-specific user lookup. */
export interface YouTrackIdentityResolver extends UserIdentityResolver {
  getUserByLogin(login: string): Promise<IdentityUser | null>
}

export function createYouTrackIdentityResolver(config: YouTrackConfig): YouTrackIdentityResolver {
  log.debug('createYouTrackIdentityResolver called')

  return {
    async searchUsers(query: string, limit?: number) {
      log.debug({ query, limit }, 'YouTrack searchUsers called')

      try {
        const users = await listYouTrackUsers(config, query, limit ?? 10)
        return users.map(
          (u): IdentityUser => ({
            id: u.id,
            login: u.login ?? u.id,
            name: u.name ?? u.login ?? u.id,
          }),
        )
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query },
          'YouTrack searchUsers failed',
        )
        throw error
      }
    },

    async getUserByLogin(login: string) {
      log.debug({ login }, 'YouTrack getUserByLogin called')

      try {
        const ringId = await resolveYouTrackUserRingId(config, login)
        const result: IdentityUser = {
          id: ringId,
          login,
          name: login,
        }
        return result
      } catch (error) {
        log.warn({ login, error: error instanceof Error ? error.message : String(error) }, 'User not found')
        return null
      }
    },
  }
}

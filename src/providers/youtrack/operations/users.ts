// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { providerError } from '../../../errors.js'
import { logger } from '../../../logger.js'
import type { UserRef } from '../../types.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { YouTrackApiError, youtrackFetch } from '../client.js'

const log = logger.child({ scope: 'provider:youtrack:users' })

const USER_FIELDS = 'id,login,fullName,name,email,ringId'

const DirectoryUserSchema = z.object({
  id: z.string(),
  login: z.string(),
  fullName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().nullable().optional(),
  ringId: z.string().nullable().optional(),
  $type: z.string().optional(),
})

type DirectoryUser = z.infer<typeof DirectoryUserSchema>

const getUserName = (user: DirectoryUser): string | undefined => user.fullName ?? user.name

const mapUserRef = (user: DirectoryUser): UserRef => ({
  id: user.id,
  login: user.login,
  name: getUserName(user),
})

const matchesQuery = (user: DirectoryUser, query: string | undefined): boolean => {
  if (query === undefined) {
    return true
  }

  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) {
    return true
  }

  return [user.login, getUserName(user), user.email]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

const matchesIdentifier = (user: DirectoryUser, identifier: string): boolean => {
  const normalizedIdentifier = identifier.trim().toLowerCase()

  return (
    user.id === identifier ||
    user.ringId === identifier ||
    user.login.toLowerCase() === normalizedIdentifier ||
    getUserName(user)?.toLowerCase() === normalizedIdentifier
  )
}

const getUserRingId = (user: DirectoryUser, userId: string): string => {
  if (user.ringId !== undefined && user.ringId !== null) {
    return user.ringId
  }

  throw new YouTrackClassifiedError(
    `User "${userId}" is missing a Hub ringId`,
    providerError.validationFailed('userId', 'User is missing a Hub ringId'),
  )
}

/**
 * Build a YouTrack query string for user search.
 * Uses nameStartsWith for prefix matching on login or name.
 */
const buildUserQuery = (searchQuery: string | undefined): string | undefined => {
  if (searchQuery === undefined) {
    return undefined
  }
  const trimmed = searchQuery.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  // nameStartsWith matches users whose name or login starts with the given prefix
  return `nameStartsWith:${trimmed}`
}

/**
 * Fetch users from YouTrack API with server-side filtering.
 * Uses query parameter for prefix search and $top for limiting results.
 */
const fetchUsersWithQuery = async (
  config: YouTrackConfig,
  query?: string,
  limit?: number,
): Promise<DirectoryUser[]> => {
  const youtrackQuery = buildUserQuery(query)
  const queryParams: Record<string, string> = { fields: USER_FIELDS }

  if (youtrackQuery !== undefined) {
    queryParams['query'] = youtrackQuery
  }
  if (limit !== undefined) {
    queryParams['$top'] = String(limit)
  }

  const raw = await youtrackFetch(config, 'GET', '/api/users', { query: queryParams })
  return DirectoryUserSchema.array().parse(raw)
}

export async function listYouTrackUsers(config: YouTrackConfig, query?: string, limit?: number): Promise<UserRef[]> {
  log.debug({ query, limit }, 'listUsers')

  try {
    const users = await fetchUsersWithQuery(config, query, limit)
    // Apply client-side filtering as a refinement on top of server-side results
    const filteredUsers = users.filter((user) => matchesQuery(user, query)).map(mapUserRef)
    log.info({ count: filteredUsers.length }, 'Users listed')
    return filteredUsers
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query, limit }, 'Failed to list users')
    throw classifyYouTrackError(error)
  }
}

export async function resolveYouTrackUserRingId(config: YouTrackConfig, userId: string): Promise<string> {
  log.debug({ userId }, 'resolveUserRingId')

  try {
    const raw = await youtrackFetch(config, 'GET', `/api/users/${userId}`, {
      query: { fields: USER_FIELDS },
    })

    const user = DirectoryUserSchema.parse(raw)
    const ringId = getUserRingId(user, userId)
    log.info({ userId, ringId }, 'Resolved user Hub ringId')
    return ringId
  } catch (error) {
    if (error instanceof YouTrackApiError && error.statusCode === 404) {
      try {
        // Fall back to server-side search by login using nameStartsWith prefix match
        const users = await fetchUsersWithQuery(config, userId, 50)
        const matchedUser = users.find((user) => matchesIdentifier(user, userId))
        if (matchedUser !== undefined) {
          const ringId = getUserRingId(matchedUser, userId)
          log.info({ userId, ringId }, 'Resolved user Hub ringId from query search')
          return ringId
        }
        throw new YouTrackClassifiedError(`User "${userId}" not found`, providerError.notFound('User', userId))
      } catch (fallbackError) {
        log.error(
          { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError), userId },
          'Failed to resolve user Hub ringId from query search',
        )
        throw classifyYouTrackError(fallbackError)
      }
    }

    log.error(
      { error: error instanceof Error ? error.message : String(error), userId },
      'Failed to resolve user Hub ringId',
    )
    throw classifyYouTrackError(error)
  }
}

export async function getYouTrackCurrentUser(config: YouTrackConfig): Promise<UserRef> {
  log.debug('getCurrentUser')

  try {
    const raw = await youtrackFetch(config, 'GET', '/api/users/me', {
      query: { fields: USER_FIELDS },
    })

    const user = DirectoryUserSchema.parse(raw)
    log.info({ userId: user.id, login: user.login }, 'Current user retrieved')
    return mapUserRef(user)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get current user')
    throw classifyYouTrackError(error)
  }
}

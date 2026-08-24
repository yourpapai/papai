// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IdentityUser, UserIdentityResolver } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { classifyGitHubError } from './classify-error.js'
import type { GitHubConfig } from './client.js'
import { githubFetch, githubPaginate } from './client.js'
import { GitHubNamedUserSchema } from './schemas/user.js'
import type { GitHubNamedUser } from './schemas/user.js'

const DEFAULT_IDENTITY_LIMIT = 10

// The child logger is created inside the factory, not at module scope: a
// module-scope child pins whatever logger was installed at first evaluation,
// which breaks combined test runs where another file loads this module before
// the logger mock is installed (see tests/mock-reset.ts for the same trap).
const identityLog = (): ReturnType<typeof logger.child> => logger.child({ scope: 'provider:github:identity' })

const collaboratorPageSchema = z.array(GitHubNamedUserSchema)
const searchUsersPageSchema = z.object({ items: z.array(GitHubNamedUserSchema) })

const normalize = (value: string): string => value.trim().toLowerCase()

const toIdentityUser = (user: GitHubNamedUser): IdentityUser => ({
  id: String(user.id),
  login: user.login,
  name: user.name,
})

/**
 * Pure collaborator matcher: trim + lowercase on both sides, then rank by
 * tier — exact login, name equality or whole-word name match, substring
 * containment on login or name — keeping listing order within a tier.
 */
export function matchGitHubUsers(
  query: string,
  users: readonly GitHubNamedUser[],
  limit = DEFAULT_IDENTITY_LIMIT,
): IdentityUser[] {
  const normalizedQuery = normalize(query)
  if (normalizedQuery === '') return []
  const ranked = users.map((user, index) => {
    const login = normalize(user.login)
    const name = user.name === undefined ? null : normalize(user.name)
    let tier = 0
    if (login === normalizedQuery) tier = 1
    else if (name !== null && (name === normalizedQuery || name.split(/\s+/u).includes(normalizedQuery))) tier = 2
    else if (login.includes(normalizedQuery) || (name !== null && name.includes(normalizedQuery))) tier = 3
    return { user, index, tier }
  })
  return ranked
    .filter((entry) => entry.tier > 0)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, limit)
    .map((entry) => toIdentityUser(entry.user))
}

/**
 * Collaborator-first identity resolution: write-capable collaborators are
 * matched locally (pure matcher); only on zero matches does one
 * `/search/users` request run, its items passed through capped at the limit.
 * Upstream failures are classified and rethrown — never an empty list.
 */
export function createGitHubIdentityResolver(config: GitHubConfig): UserIdentityResolver {
  const log = identityLog()
  log.debug({ repo: config.repo }, 'createGitHubIdentityResolver')

  return {
    async searchUsers(query: string, limit?: number): Promise<IdentityUser[]> {
      const effectiveLimit = limit ?? DEFAULT_IDENTITY_LIMIT
      log.debug({ repo: config.repo, query, limit }, 'GitHub searchUsers')

      try {
        const collaborators = await githubPaginate(config, `/repos/${config.repo}/collaborators`, {
          query: { permission: 'push' },
          extractPage: (data: unknown): GitHubNamedUser[] => collaboratorPageSchema.parse(data),
        })
        const matches = matchGitHubUsers(query, collaborators, effectiveLimit)
        if (matches.length > 0) {
          log.info({ count: matches.length, source: 'collaborators' }, 'Identity candidates found')
          return matches
        }

        const raw = await githubFetch(config, 'GET', '/search/users', {
          query: { q: query, per_page: effectiveLimit },
        })
        const results = searchUsersPageSchema.parse(raw).items.slice(0, effectiveLimit).map(toIdentityUser)
        log.info({ count: results.length, source: 'search' }, 'Identity candidates found')
        return results
      } catch (error) {
        log.error({ error: error instanceof Error ? error.message : String(error), query }, 'Identity search failed')
        throw classifyGitHubError(error, { projectId: config.repo })
      }
    },
  }
}

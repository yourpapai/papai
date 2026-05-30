// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { UserRef } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { classifyKaneoError } from '../classify-error.js'
import { type KaneoConfig, kaneoFetch } from '../client.js'

const log = logger.child({ scope: 'provider:kaneo:users' })

const KaneoUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable().optional(),
  role: z.string(),
})

type KaneoUser = z.infer<typeof KaneoUserSchema>

const mapUserRef = (user: KaneoUser): UserRef => ({
  id: user.id,
  login: user.email,
  name: user.name,
})

const matchesQuery = (user: KaneoUser, query: string | undefined): boolean => {
  if (query === undefined) {
    return true
  }

  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) {
    return true
  }

  return [user.name, user.email].some((value) => value.toLowerCase().includes(normalizedQuery))
}

export async function kaneoListUsers(
  config: KaneoConfig,
  workspaceId: string,
  query?: string,
  limit?: number,
): Promise<UserRef[]> {
  log.debug({ workspaceId, query, limit }, 'kaneoListUsers called')

  try {
    const members = await kaneoFetch(
      config,
      'GET',
      `/workspace/${workspaceId}/members`,
      undefined,
      undefined,
      z.array(KaneoUserSchema),
    )

    const filteredMembers = members.filter((user) => matchesQuery(user, query)).map(mapUserRef)

    const result = limit === undefined ? filteredMembers : filteredMembers.slice(0, limit)

    log.info({ workspaceId, count: result.length }, 'Users listed')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, query },
      'kaneoListUsers failed',
    )
    throw classifyKaneoError(error)
  }
}

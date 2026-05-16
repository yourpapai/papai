// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import {
  getIdentityMapping as defaultGetIdentityMapping,
  setIdentityMapping as defaultSetIdentityMapping,
  type IdentityMappingDeps,
} from './mapping.js'
import type { IdentityResolutionResult, UserIdentity } from './types.js'

const log = logger.child({ scope: 'identity:resolver' })

export interface SearchResultUser {
  id: string
  login: string
  name?: string
}

interface FoundResultInput {
  providerUserId: string
  providerUserLogin: string | null
  displayName: string | null
}

/**
 * Build found result from identity mapping.
 */
function buildFoundResult(existing: FoundResultInput): Extract<IdentityResolutionResult, { type: 'found' }> {
  const identity: UserIdentity = {
    userId: existing.providerUserId,
    login: existing.providerUserLogin ?? '',
    displayName: existing.displayName ?? '',
  }
  return { type: 'found', identity }
}

/**
 * Check if login matches username (exact or email prefix).
 */
function isLoginMatch(login: string, normalizedUsername: string): boolean {
  const normalizedLogin = login.toLowerCase()
  if (normalizedLogin === normalizedUsername) return true
  if (normalizedLogin.includes('@')) {
    const localPart = normalizedLogin.split('@')[0]
    if (localPart === normalizedUsername) return true
  }
  return false
}

/**
 * Search for exact match and store mapping if found.
 */
async function tryStoreExactMatch(
  contextId: string,
  chatUsername: string,
  providerName: string,
  resolver: { searchUsers(q: string, limit?: number): Promise<SearchResultUser[]> },
  setIdentityMappingFn: (params: {
    contextId: string
    providerName: string
    providerUserId: string
    providerUserLogin: string
    displayName: string
    matchMethod: 'auto' | 'manual_nl' | 'unmatched'
    confidence: number
  }) => void,
): Promise<IdentityResolutionResult | null> {
  const users = await resolver.searchUsers(chatUsername, 10)
  const normalizedUsername = chatUsername.toLowerCase()

  const exactMatch = users.find((u: SearchResultUser) => isLoginMatch(u.login, normalizedUsername))

  if (exactMatch === undefined) return null

  setIdentityMappingFn({
    contextId,
    providerName,
    providerUserId: exactMatch.id,
    providerUserLogin: exactMatch.login,
    displayName: exactMatch.name ?? exactMatch.login,
    matchMethod: 'auto',
    confidence: 100,
  })

  log.info({ contextId, login: exactMatch.login }, 'Auto-linked user')
  return {
    type: 'found',
    identity: {
      userId: exactMatch.id,
      login: exactMatch.login,
      displayName: exactMatch.name ?? exactMatch.login,
    },
  }
}

/**
 * Store unmatched mapping and return result.
 */
function storeUnmatched(
  contextId: string,
  providerName: string,
  chatUsername: string,
  setIdentityMappingFn: (params: {
    contextId: string
    providerName: string
    providerUserId: null
    providerUserLogin: null
    displayName: null
    matchMethod: 'auto' | 'manual_nl' | 'unmatched'
    confidence: number
  }) => void,
): Extract<IdentityResolutionResult, { type: 'unmatched' }> {
  setIdentityMappingFn({
    contextId,
    providerName,
    providerUserId: null,
    providerUserLogin: null,
    displayName: null,
    matchMethod: 'unmatched',
    confidence: 0,
  })

  log.info({ contextId, chatUsername }, 'No exact match for auto-link')
  return {
    type: 'unmatched',
    message: `I couldn't find a user matching '${chatUsername}'. Tell me your login (e.g., 'I'm jsmith').`,
  }
}

export interface ResolverDeps extends IdentityMappingDeps {
  getIdentityMapping: typeof defaultGetIdentityMapping
  setIdentityMapping: typeof defaultSetIdentityMapping
}

const defaultDeps: ResolverDeps = {
  getIdentityMapping: defaultGetIdentityMapping,
  setIdentityMapping: defaultSetIdentityMapping,
  getDrizzleDb: defaultGetDrizzleDb,
}

/**
 * Resolve "me" reference to actual task tracker user identity.
 * Checks cache first, then attempts auto-link if no mapping exists.
 *
 * Note: This function is async to support future auto-link integration.
 * When auto-link is wired, the six tool call sites will need await added.
 */
export async function resolveMeReference(
  contextId: string,
  provider: TaskProvider,
  deps: ResolverDeps = defaultDeps,
): Promise<IdentityResolutionResult> {
  log.debug({ contextId, providerName: provider.name }, 'resolveMeReference called')

  // getIdentityMapping is synchronous; wrapping in Promise.resolve()
  // makes this function properly async for future compatibility when
  // auto-link is wired and actual async operations are needed.
  const existing = await Promise.resolve(deps.getIdentityMapping(contextId, provider.name, deps))

  if (existing === null) {
    log.debug({ contextId }, 'No identity mapping exists')
    return {
      type: 'not_found',
      message: "I don't know who you are in the task tracker. Tell me your login (e.g., 'I'm jsmith').",
    }
  }

  if (existing.providerUserId === null) {
    log.debug({ contextId }, 'Identity mapping marked unmatched')
    return {
      type: 'unmatched',
      message: "I couldn't automatically match you. What's your login?",
    }
  }

  const result = buildFoundResult({
    providerUserId: existing.providerUserId,
    providerUserLogin: existing.providerUserLogin,
    displayName: existing.displayName,
  })
  log.debug({ contextId, login: result.identity.login }, 'Identity resolved')
  return result
}

/**
 * Attempt to auto-link based on username match.
 * Called on first interaction in group chats by llm-orchestrator.ts.
 *
 * @param contextId - The storage context ID (group ID in groups)
 * @param chatUsername - The username from the chat platform
 * @param provider - The task provider with optional identity resolver
 * @returns IdentityResolutionResult indicating found, not_found, or unmatched
 */
export async function attemptAutoLink(
  contextId: string,
  chatUsername: string,
  provider: TaskProvider,
  deps: ResolverDeps = defaultDeps,
): Promise<IdentityResolutionResult> {
  log.debug({ contextId, chatUsername, providerName: provider.name }, 'attemptAutoLink called')

  if (provider.identityResolver === undefined) {
    log.warn({ providerName: provider.name }, 'Provider has no identity resolver')
    return {
      type: 'not_found',
      message: 'Auto-link not available for this provider.',
    }
  }

  try {
    const result = await tryStoreExactMatch(
      contextId,
      chatUsername,
      provider.name,
      provider.identityResolver,
      (params): void => {
        deps.setIdentityMapping(params, deps)
      },
    )
    if (result !== null) {
      return result
    }

    return storeUnmatched(contextId, provider.name, chatUsername, (params): void => {
      deps.setIdentityMapping(params, deps)
    })
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), contextId }, 'Auto-link failed')
    return {
      type: 'not_found',
      message: 'Unable to search for users. Please tell me your login manually.',
    }
  }
}

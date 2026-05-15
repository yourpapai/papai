// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getDrizzleDb as defaultGetDrizzleDb } from '../db/drizzle.js'
import { setIdentityMapping as defaultSetIdentityMapping, type IdentityMappingDeps } from '../identity/mapping.js'
import { extractIdentityClaim } from '../identity/nl-detection.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:set-my-identity' })

interface ErrorResult {
  status: 'error'
  message: string
}

interface SuccessResult {
  status: 'success'
  message: string
  identity: {
    login: string
    displayName: string
  }
}

function validateResolver(provider: TaskProvider): ErrorResult | null {
  if (provider.identityResolver === undefined) {
    log.warn({ providerName: provider.name }, 'Provider has no identity resolver')
    return {
      status: 'error',
      message: 'Identity resolution not supported for this provider.',
    }
  }
  return null
}

function parseClaim(claim: string): { result: ErrorResult | null; login: string | null } {
  const claimedLogin = extractIdentityClaim(claim)
  if (claimedLogin === null) {
    log.warn({ claim }, 'Could not extract identity from claim')
    return {
      result: {
        status: 'error',
        message: "I couldn't understand your identity claim. Try saying 'I'm jsmith'.",
      },
      login: null,
    }
  }
  return { result: null, login: claimedLogin }
}

async function findUser(
  resolver: NonNullable<TaskProvider['identityResolver']>,
  claimedLogin: string,
  _providerName: string,
): Promise<{ id: string; login: string; name?: string } | null> {
  const users = await resolver.searchUsers(claimedLogin, 5)
  const normalizedClaim = claimedLogin.toLowerCase()

  return (
    users.find((u) => {
      const normalizedLogin = u.login.toLowerCase()
      // Exact match
      if (normalizedLogin === normalizedClaim) {
        return true
      }
      // Email prefix match: if login is email and claim matches local part
      if (normalizedLogin.includes('@')) {
        const localPart = normalizedLogin.split('@')[0]
        if (localPart === normalizedClaim) {
          return true
        }
      }
      return false
    }) ?? null
  )
}

function storeIdentity(
  chatUserId: string,
  providerName: string,
  matched: { id: string; login: string; name?: string },
  setIdentityMappingFn: (params: {
    contextId: string
    providerName: string
    providerUserId: string
    providerUserLogin: string
    displayName: string
    matchMethod: 'auto' | 'manual_nl' | 'unmatched'
    confidence: number
  }) => void,
): SuccessResult {
  setIdentityMappingFn({
    contextId: chatUserId,
    providerName,
    providerUserId: matched.id,
    providerUserLogin: matched.login,
    displayName: matched.name ?? matched.login,
    matchMethod: 'manual_nl',
    confidence: 100,
  })

  log.info({ chatUserId, login: matched.login }, 'Identity set via NL')
  return {
    status: 'success',
    message: `Linked you to ${matched.login} (${matched.name ?? matched.login}) in ${providerName}.`,
    identity: {
      login: matched.login,
      displayName: matched.name ?? matched.login,
    },
  }
}

export interface SetMyIdentityDeps extends IdentityMappingDeps {
  setIdentityMapping: typeof defaultSetIdentityMapping
}

const defaultDeps: SetMyIdentityDeps = {
  setIdentityMapping: defaultSetIdentityMapping,
  getDrizzleDb: defaultGetDrizzleDb,
}

export function makeSetMyIdentityTool(
  provider: TaskProvider,
  chatUserId: string,
  deps: SetMyIdentityDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      "Set or correct the user's task tracker identity. Use when user says things like 'I'm jsmith', 'My login is john.smith', or 'Link me to user jsmith'.",
    inputSchema: z.object({
      claim: z.string().describe("The user's natural language claim about their identity"),
    }),
    execute: async ({ claim }) => {
      log.debug({ chatUserId, claim }, 'set_my_identity called')

      const resolverError = validateResolver(provider)
      if (resolverError !== null) return resolverError

      const { result, login } = parseClaim(claim)
      if (result !== null) return result
      if (login === null) return { status: 'error', message: 'Failed to parse identity claim.' }

      try {
        const resolver = provider.identityResolver!
        const matched = await findUser(resolver, login, provider.name)

        if (matched === null) {
          log.warn({ claimedLogin: login }, 'User not found in provider')
          return {
            status: 'error',
            message: `I couldn't find user '${login}' in ${provider.name}. Check the username and try again.`,
          }
        }

        return storeIdentity(chatUserId, provider.name, matched, (params): void => {
          deps.setIdentityMapping(params, deps)
        })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), chatUserId, claimedLogin: login },
          'Failed to set identity',
        )
        return {
          status: 'error',
          message: 'Failed to set identity. Please try again.',
        }
      }
    },
  })
}

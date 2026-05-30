// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  getIdentityMapping as defaultGetIdentityMapping,
  setIdentityMapping as defaultSetIdentityMapping,
} from '../identity/mapping.js'

export type PluginIdentityFacade = {
  /** Resolve the recorded provider account for a chat context, or null. */
  lookupForChatUser(chatUserId: string): { providerUserId: string; providerLogin: string; verified: boolean } | null
  /** Record an unverified ('manual_nl') claim. Never marks the mapping verified. */
  recordClaim(providerUserId: string, providerLogin: string, displayName?: string): void
}

export interface IdentityFacadeDeps {
  getIdentityMapping: typeof defaultGetIdentityMapping
  setIdentityMapping: typeof defaultSetIdentityMapping
}

const defaultDeps: IdentityFacadeDeps = {
  getIdentityMapping: defaultGetIdentityMapping,
  setIdentityMapping: defaultSetIdentityMapping,
}

export function buildIdentityFacade(
  providerName: string,
  chatUserId: string,
  deps: IdentityFacadeDeps = defaultDeps,
): PluginIdentityFacade {
  return Object.freeze({
    lookupForChatUser(
      targetChatUserId: string,
    ): { providerUserId: string; providerLogin: string; verified: boolean } | null {
      const mapping = deps.getIdentityMapping(targetChatUserId, providerName)
      if (mapping === null || mapping.providerUserId === null || mapping.providerUserLogin === null) {
        return null
      }
      return {
        providerUserId: mapping.providerUserId,
        providerLogin: mapping.providerUserLogin,
        verified: mapping.matchMethod === 'auto',
      }
    },
    recordClaim(providerUserId: string, providerLogin: string, displayName?: string): void {
      deps.setIdentityMapping({
        contextId: chatUserId,
        providerName,
        providerUserId,
        providerUserLogin: providerLogin,
        displayName: displayName ?? null,
        matchMethod: 'manual_nl',
        confidence: 100,
      })
    },
  })
}

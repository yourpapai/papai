// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'

const log = logger.child({ scope: 'identity:nl-detection' })

/** Patterns that indicate user is claiming an identity */
const IDENTITY_CLAIM_PATTERNS = [
  // "I'm jsmith" or "I am jsmith"
  /(?:i['']?m|i am)\s+(?:not\s+\w+,?\s*)?(?:i['']?m|i am)?\s*(\w+)/iu,
  // "My login is jsmith" or "My username is jsmith"
  /my\s+(?:login|username|user)\s+is\s+(\w+)/iu,
  // "Link me to user jsmith" or "Link me to jsmith"
  /link\s+me\s+(?:to\s+)?(?:user\s+)?(\w+)/iu,
  // "I'm actually jsmith" or "I am actually jsmith"
  /(?:i['']?m|i am)\s+actually\s+(\w+)/iu,
  // "These aren't my tasks, I'm jsmith"
  /these\s+(?:aren['']?t|are not)\s+my\s+\w+,?\s*(?:i['']?m|i am)\s+(\w+)/iu,
]

/**
 * Extract claimed identity from natural language message.
 * Returns the claimed login/username or null if not a claim.
 */
export function extractIdentityClaim(text: string): string | null {
  log.debug({ text }, 'extractIdentityClaim called')

  for (const pattern of IDENTITY_CLAIM_PATTERNS) {
    const match = text.match(pattern)
    if (match !== null && match[1] !== undefined) {
      const claimed = match[1].trim().toLowerCase()
      log.debug({ claimed }, 'Identity claim detected')
      return claimed
    }
  }

  return null
}

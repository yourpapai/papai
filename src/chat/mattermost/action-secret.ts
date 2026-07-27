// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../db/drizzle.js'
import { systemConfig } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:mattermost:action-secret' })

export const MATTERMOST_ACTION_SIGNING_SECRET_KEY = 'mattermost_action_signing_secret'
const UPDATED_BY = 'mattermost-action-signing'

const generateSecret = (): string => randomBytes(32).toString('base64url')

const readSecret = (): string | null => {
  const row = getDrizzleDb()
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, MATTERMOST_ACTION_SIGNING_SECRET_KEY))
    .get()
  return row?.value ?? null
}

export function getMattermostActionSigningSecret(): string {
  const existing = readSecret()
  if (existing !== null) return existing

  const value = generateSecret()
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY, value, updatedAt: Date.now(), updatedBy: UPDATED_BY })
    .onConflictDoNothing({ target: systemConfig.key })
    .run()

  const stored = readSecret()
  if (stored === null) {
    throw new Error('Failed to initialize Mattermost action signing secret')
  }
  log.info({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY }, 'Mattermost action signing secret initialized')
  return stored
}

const getTrimmedEnv = (name: string): string | undefined => {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Optionally pin the Mattermost action signing secret from the environment.
 * When PAPAI_MATTERMOST_ACTION_SIGNING_SECRET is set, seed it into system_config
 * once. `onConflictDoNothing` means an already-stored (operator-chosen or
 * previously generated) secret is never overwritten. No-op when the env var is
 * absent, leaving the lazy random-generate path in getMattermostActionSigningSecret.
 */
export function seedMattermostActionSigningSecretFromEnv(): void {
  const configured = getTrimmedEnv('PAPAI_MATTERMOST_ACTION_SIGNING_SECRET')
  if (configured === undefined) return
  getDrizzleDb()
    .insert(systemConfig)
    .values({
      key: MATTERMOST_ACTION_SIGNING_SECRET_KEY,
      value: configured,
      updatedAt: Date.now(),
      updatedBy: UPDATED_BY,
    })
    .onConflictDoNothing({ target: systemConfig.key })
    .run()
  log.info({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY }, 'Mattermost action signing secret seeded from environment')
}

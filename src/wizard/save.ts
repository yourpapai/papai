// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard save logic. After Phase 1, the wizard only collects task-provider
 * credentials + timezone — LLM credentials are admin-owned in `system_config`,
 * not per-user — so no live LLM validation runs here.
 */

import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { deleteWizardSession, getWizardSession } from './state.js'

const log = logger.child({ scope: 'wizard:save' })

interface SaveWizardResult {
  readonly success: boolean
  readonly message: string
  readonly buttons?: Array<{ text: string; action: string }>
}

function saveValidatedConfig(
  session: NonNullable<ReturnType<typeof getWizardSession>>,
  userId: string,
  storageContextId: string,
): SaveWizardResult {
  let savedCount = 0
  for (const [key, value] of Object.entries(session.data)) {
    if (value !== undefined && value !== '' && isConfigKey(key)) {
      setConfig(session.storageContextId, key, value)
      savedCount++
    }
  }

  deleteWizardSession(userId, storageContextId)
  log.info({ userId, storageContextId, savedCount }, 'Configuration saved')

  return {
    success: true,
    message: `✅ Configuration saved successfully! ${savedCount} setting(s) configured.\n\nYou can use /config to view your settings or /setup to modify them.`,
  }
}

export function validateAndSaveWizardConfig(userId: string, storageContextId: string): Promise<SaveWizardResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    return Promise.resolve({ success: false, message: 'Error: Wizard session not found' })
  }

  return Promise.resolve(saveValidatedConfig(session, userId, storageContextId))
}

// src/llm-providers/env-bootstrap.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { createLlmProvider, getAdminRoleBindings, setAdminRoleBindings } from './store.js'

const log = logger.child({ scope: 'llm-providers:env-bootstrap' })

export function seedDefaultLlmProviderFromEnv(): void {
  if (getAdminRoleBindings() !== null) {
    log.debug('admin role bindings already configured; skipping env seed')
    return
  }
  const apiKey = process.env['LLM_API_KEY']?.trim()
  const baseUrl = process.env['LLM_BASE_URL']?.trim()
  const mainModel = process.env['MAIN_MODEL']?.trim()
  if (apiKey === undefined || apiKey === '') return
  if (baseUrl === undefined || baseUrl === '') return
  if (mainModel === undefined || mainModel === '') return
  const provider = createLlmProvider({ label: 'Default (env)', providerType: 'custom', baseUrl, apiKey }, 'env')
  const smallModel = process.env['SMALL_MODEL']?.trim()
  const embeddingModel = process.env['EMBEDDING_MODEL']?.trim()
  setAdminRoleBindings(
    {
      main: { providerId: provider.id, model: mainModel },
      small: smallModel !== undefined && smallModel !== '' ? { providerId: provider.id, model: smallModel } : null,
      embedding:
        embeddingModel !== undefined && embeddingModel !== ''
          ? { providerId: provider.id, model: embeddingModel }
          : null,
    },
    'env',
  )
  log.info({ providerId: provider.id, mainModel }, 'default LLM provider seeded from env')
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { validateChatProviderEnv } from '../env-validation.js'
import { logger } from '../logger.js'
import { DiscordChatProvider } from './discord/index.js'
import { MattermostChatProvider } from './mattermost/index.js'
import { TelegramChatProvider } from './telegram/index.js'
import type { ChatProvider } from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type ChatProviderFactory = (deps: RegistryDeps) => ChatProvider

export interface RegistryDeps {
  env: Record<string, string | undefined>
}

const defaultDeps: RegistryDeps = { env: process.env }

const providers = new Map<string, ChatProviderFactory>()

registerChatProvider('telegram', (deps) => new TelegramChatProvider(deps.env['TELEGRAM_BOT_TOKEN']))
registerChatProvider('mattermost', () => new MattermostChatProvider())
registerChatProvider('discord', (deps) => new DiscordChatProvider(undefined, deps.env['DISCORD_BOT_TOKEN']))

function registerChatProvider(name: string, factory: ChatProviderFactory): void {
  providers.set(name, factory)
}

export function createChatProvider(name: string, deps: RegistryDeps = defaultDeps): ChatProvider {
  const validation = validateChatProviderEnv(name, deps.env)
  if (!validation.ok) {
    log.error({ reason: validation.reason, missing: validation.missing }, 'Invalid chat provider configuration')
    throw new Error(validation.reason)
  }
  const factory = providers.get(name)!
  log.debug({ name }, 'Creating chat provider instance')
  return factory(deps)
}

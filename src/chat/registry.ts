// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { validateChatProviderEnv } from '../env-validation.js'
import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import { DiscordChatProvider } from './discord/index.js'
import { discordCapabilities, discordTraits } from './discord/metadata.js'
import { MattermostChatProvider } from './mattermost/index.js'
import { mattermostCapabilities, mattermostTraits } from './mattermost/metadata.js'
import { TelegramChatProvider } from './telegram/index.js'
import { telegramCapabilities, telegramTraits } from './telegram/metadata.js'
import type { ChatProvider, ChatProviderDescriptor } from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type ChatProviderFactory = (deps: RegistryDeps) => ChatProvider

export interface RegistryDeps {
  env: Record<string, string | undefined>
  platformInstanceId?: string
}

const defaultDeps: RegistryDeps = { env: process.env }

const providers = new Map<string, ChatProviderFactory>()

const platformDescriptors = [
  {
    type: 'telegram',
    displayName: 'Telegram',
    source: 'builtin',
    instanceConfigSchema: [
      { key: 'token', label: 'Telegram Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
    contextConfigSchema: [],
    capabilities: telegramCapabilities,
    traits: telegramTraits,
  },
  {
    type: 'mattermost',
    displayName: 'Mattermost',
    source: 'builtin',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'Mattermost URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'token', label: 'Mattermost Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
    contextConfigSchema: [],
    capabilities: mattermostCapabilities,
    traits: mattermostTraits,
  },
  {
    type: 'discord',
    displayName: 'Discord',
    source: 'builtin',
    instanceConfigSchema: [
      { key: 'token', label: 'Discord Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
    contextConfigSchema: [],
    capabilities: discordCapabilities,
    traits: discordTraits,
  },
] as const satisfies readonly ChatProviderDescriptor[]

registerChatProvider(
  'telegram',
  (deps) => new TelegramChatProvider(deps.env['TELEGRAM_BOT_TOKEN'], deps.platformInstanceId),
)
registerChatProvider(
  'mattermost',
  (deps) =>
    new MattermostChatProvider({
      url: deps.env['MATTERMOST_URL'],
      token: deps.env['MATTERMOST_BOT_TOKEN'],
      platformInstanceId: deps.platformInstanceId,
    }),
)
registerChatProvider(
  'discord',
  (deps) => new DiscordChatProvider(undefined, deps.env['DISCORD_BOT_TOKEN'], deps.platformInstanceId),
)

function registerChatProvider(name: string, factory: ChatProviderFactory): void {
  providers.set(name, factory)
}

export const listPlatformProviderTypes = (): readonly ChatProviderDescriptor[] => platformDescriptors

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

const configToEnv = (type: PlatformInstanceType, config: InstanceConfig): Record<string, string | undefined> => {
  if (type === 'telegram') return { TELEGRAM_BOT_TOKEN: config['token'] }
  if (type === 'mattermost') {
    return { MATTERMOST_URL: config['baseUrl'] ?? config['url'], MATTERMOST_BOT_TOKEN: config['token'] }
  }
  return { DISCORD_BOT_TOKEN: config['token'] }
}

const missingConfigMessage = (type: PlatformInstanceType): string => `Missing ${type} instance config`

export function createChatProviderFromConfig(
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
): ChatProvider {
  const deps: RegistryDeps = { env: configToEnv(type, config), platformInstanceId: id }
  const validation = validateChatProviderEnv(type, deps.env)
  if (!validation.ok) {
    log.error(
      { reason: validation.reason, missing: validation.missing, type, id },
      'Invalid chat provider instance config',
    )
    throw new Error(missingConfigMessage(type))
  }
  return createChatProvider(type, deps)
}

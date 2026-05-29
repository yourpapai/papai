// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import { DiscordChatProvider } from './discord/index.js'
import { discordCapabilities, discordTraits } from './discord/metadata.js'
import { KonturTalkChatProvider } from './kontur-talk/index.js'
import { konturTalkCapabilities, konturTalkTraits } from './kontur-talk/metadata.js'
import { MattermostChatProvider } from './mattermost/index.js'
import { mattermostCapabilities, mattermostTraits } from './mattermost/metadata.js'
import { TelegramChatProvider } from './telegram/index.js'
import { telegramCapabilities, telegramTraits } from './telegram/metadata.js'
import type { ChatProvider, ChatProviderDescriptor } from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type InstanceChatProviderFactory = (id: string, config: InstanceConfig) => ChatProvider

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
  {
    type: 'kontur-talk',
    displayName: 'Kontur Talk',
    source: 'builtin',
    instanceConfigSchema: [{ key: 'jwtToken', label: 'JWT Token', required: true, sensitive: true, scope: 'instance' }],
    contextConfigSchema: [],
    capabilities: konturTalkCapabilities,
    traits: konturTalkTraits,
  },
] as const satisfies readonly ChatProviderDescriptor[]

const instanceProviders = new Map<PlatformInstanceType, InstanceChatProviderFactory>([
  [
    'telegram',
    (id, config): ChatProvider => new TelegramChatProvider({ token: config['token'], platformInstanceId: id }),
  ],
  [
    'mattermost',
    (id, config): ChatProvider =>
      new MattermostChatProvider({ baseUrl: config['baseUrl'], token: config['token'], platformInstanceId: id }),
  ],
  [
    'discord',
    (id, config): ChatProvider => new DiscordChatProvider({ token: config['token'], platformInstanceId: id }),
  ],
  [
    'kontur-talk',
    (id, config): ChatProvider => new KonturTalkChatProvider({ jwtToken: config['jwtToken'], platformInstanceId: id }),
  ],
])

export const listPlatformProviderTypes = (): readonly ChatProviderDescriptor[] => platformDescriptors

const missingConfigMessage = (type: PlatformInstanceType): string => `Missing ${type} instance config`

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === ''

const isMissingInstanceConfig = (type: PlatformInstanceType, config: InstanceConfig): boolean => {
  const descriptor = platformDescriptors.find((candidate) => candidate.type === type)
  if (descriptor === undefined) return true
  return descriptor.instanceConfigSchema.some((field) => field.required && isBlank(config[field.key]))
}

export function createChatProviderFromConfig(
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
): ChatProvider {
  const factory = instanceProviders.get(type)
  if (factory === undefined || isMissingInstanceConfig(type, config)) {
    log.error({ type, id }, 'Invalid chat provider instance config')
    throw new Error(missingConfigMessage(type))
  }
  return factory(id, config)
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac, randomBytes } from 'node:crypto'

import type { AttachmentSourceProvider } from '../attachments/types.js'
import { getContextSettings } from '../instances/context-store.js'
import type { InstanceConfig, InstanceStatus, PlatformInstanceType } from '../instances/types.js'
import type { ManagedChatInstance, ManagedChatInstanceSnapshot } from './router-types.js'
import type {
  ChatCapability,
  ChatProviderTraits,
  ContextRendered,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ThreadCapabilities,
} from './types.js'

export const activeInstanceStatuses = new Set<InstanceStatus>(['active', 'pending'])

export const fallbackThreadCapabilities: ThreadCapabilities = {
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}

export const fallbackTraits: ChatProviderTraits = { observedGroupMessages: 'all' }

export const fallbackContextRendered: ContextRendered = {
  method: 'text',
  content: 'No active chat provider is available to render this context.',
}

const configFingerprintKey = randomBytes(32)

export const compareConfigKeyOrder = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const stableConfigEntries = (config: InstanceConfig): readonly (readonly [string, string])[] =>
  Object.entries(config).toSorted(([left], [right]) => compareConfigKeyOrder(left, right))

export const configFingerprint = (type: PlatformInstanceType, config: InstanceConfig): string => {
  const payload = JSON.stringify({ type, config: stableConfigEntries(config) })
  return createHmac('sha256', configFingerprintKey).update(payload).digest('hex')
}

export const activeManagedInstances = (instances: Iterable<ManagedChatInstance>): ManagedChatInstance[] =>
  [...instances].filter((instance) => activeInstanceStatuses.has(instance.status))

export const firstActiveManagedInstance = (instances: Iterable<ManagedChatInstance>): ManagedChatInstance | null => {
  const instance = activeManagedInstances(instances)[0]
  if (instance === undefined) return null
  return instance
}

export const threadCapabilitiesForManagedInstances = (instances: Iterable<ManagedChatInstance>): ThreadCapabilities => {
  const instance = firstActiveManagedInstance(instances)
  if (instance === null) return fallbackThreadCapabilities
  return instance.provider.threadCapabilities
}

export const traitsForManagedInstances = (instances: Iterable<ManagedChatInstance>): ChatProviderTraits => {
  const instance = firstActiveManagedInstance(instances)
  if (instance === null) return fallbackTraits
  return instance.provider.traits
}

export const managedInstanceOrNull = (instance: ManagedChatInstance | undefined): ManagedChatInstance | null => {
  if (instance === undefined) return null
  return instance
}

export const providerForManagedInstance = (
  instance: ManagedChatInstance | undefined,
): ManagedChatInstance['provider'] | null => {
  if (instance === undefined) return null
  return instance.provider
}

export const resolveGroupLabelForManagedInstance = (
  instances: Map<string, ManagedChatInstance>,
  groupId: string,
): Promise<string | null> => {
  const settings = getContextSettings(groupId)
  if (settings === null) return Promise.resolve(null)
  const instance = instances.get(settings.platformInstanceId)
  if (instance === undefined || instance.provider.resolveGroupLabel === undefined) return Promise.resolve(null)
  return instance.provider.resolveGroupLabel(groupId)
}

export const isGroupAdminForManagedInstance = (
  instance: ManagedChatInstance | undefined,
  platformInstanceId: string,
  groupId: string,
  userId: string,
): Promise<boolean | null> => {
  if (instance === undefined || instance.provider.isGroupAdmin === undefined) return Promise.resolve(null)
  return instance.provider.isGroupAdmin(platformInstanceId, groupId, userId)
}

export const managedInstanceSnapshots = (
  instances: Iterable<ManagedChatInstance>,
): readonly ManagedChatInstanceSnapshot[] =>
  [...instances].map((instance) => ({
    id: instance.id,
    type: instance.type,
    status: instance.status,
    configFingerprint: instance.configFingerprint,
  }))

export const renderContextFromManagedInstances = (
  instances: Iterable<ManagedChatInstance>,
  snapshot: Parameters<ManagedChatInstance['provider']['renderContext']>[0],
): ContextRendered => {
  const instance = firstActiveManagedInstance(instances)
  if (instance === null) return fallbackContextRendered
  return instance.provider.renderContext(snapshot)
}

export const renderContextForManagedInstance = (
  instance: ManagedChatInstance | undefined,
  fallback: ContextRendered,
  snapshot: Parameters<ManagedChatInstance['provider']['renderContext']>[0],
): ContextRendered => {
  if (instance === undefined) return fallback
  return instance.provider.renderContext(snapshot)
}

export const traitsForManagedInstance = (instance: ManagedChatInstance | undefined): ChatProviderTraits | null => {
  if (instance === undefined) return null
  return instance.provider.traits
}

export const capabilitiesForManagedInstance = (
  instance: ManagedChatInstance | undefined,
): ReadonlySet<ChatCapability> => {
  if (instance === undefined || !activeInstanceStatuses.has(instance.status)) return new Set()
  return instance.provider.capabilities
}

export const downloadFileFromManagedInstance = (
  instance: ManagedChatInstance | undefined,
  sourceProvider: AttachmentSourceProvider,
  fileId: string,
): Promise<Buffer | null> => {
  if (instance === undefined || instance.status !== 'active') return Promise.resolve(null)
  if (instance.type !== sourceProvider) return Promise.resolve(null)
  if (!hasDownloadFile(instance.provider)) return Promise.resolve(null)
  return instance.provider.downloadFile(fileId)
}

export const routedMessageHandler =
  (
    platformInstanceId: string,
    handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>,
  ): ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) =>
  (msg, reply) =>
    handler({ ...msg, platformInstanceId }, reply)

export const registerInteractionHandlerForManagedInstance = (
  instance: ManagedChatInstance,
  handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>,
): void => {
  if (instance.provider.onInteraction === undefined) return
  instance.provider.onInteraction((interaction, reply) =>
    handler({ ...interaction, platformInstanceId: instance.id }, reply),
  )
}

type FileDownloadingProvider = Readonly<{
  downloadFile: (fileId: string) => Promise<Buffer | null>
}>

const hasDownloadFile = (
  provider: ManagedChatInstance['provider'],
): provider is ManagedChatInstance['provider'] & FileDownloadingProvider => {
  const candidate = (provider as Readonly<Record<string, unknown>>)['downloadFile']
  return typeof candidate === 'function'
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../chat/types.js'
import type { ToolCapabilityCatalog } from './capability-catalog.js'

export type PapaiRuntimeConfig = Readonly<{
  adminUserId: string
  pluginDirectory: string
  startBackgroundServices: boolean
  startNetworkServer: boolean
  sendStartupAnnouncement: boolean
}>

type PapaiRuntimeConfigInput = Readonly<
  Pick<PapaiRuntimeConfig, 'adminUserId' | 'pluginDirectory'> &
    Partial<Pick<PapaiRuntimeConfig, 'sendStartupAnnouncement' | 'startBackgroundServices' | 'startNetworkServer'>>
>

export function normalizePapaiRuntimeConfig(config: PapaiRuntimeConfigInput): PapaiRuntimeConfig {
  return {
    adminUserId: config.adminUserId,
    pluginDirectory: config.pluginDirectory,
    startBackgroundServices: config.startBackgroundServices ?? true,
    startNetworkServer: config.startNetworkServer ?? true,
    sendStartupAnnouncement: config.sendStartupAnnouncement ?? true,
  }
}

export type RuntimeIngress = Readonly<{
  dispatch(message: IncomingMessage): Promise<void>
  dispatchInteraction(interaction: IncomingInteraction): Promise<void>
}>

export interface PapaiRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  dispatch(message: IncomingMessage): Promise<void>
  dispatchInteraction(interaction: IncomingInteraction): Promise<void>
  request(request: Request): Promise<Response>
  resolveToolCapability(capabilityId: string): string
}

export type PapaiRuntimeDeps = Readonly<{
  database: { start(): void | Promise<void>; stop(): void | Promise<void> }
  chat: {
    createRouter(): ChatRouter
    ingress: RuntimeIngress
    setRuntime(router: ChatRouter): void
    clearRuntime(): void
  }
  extensions: { start(router: ChatRouter): Promise<readonly string[]>; stop(): Promise<void> }
  application: {
    initializeStores(): void
    setupBot(router: ChatRouter, adminUserId: string): void
    registerCommandMenu(router: ChatRouter, adminUserId: string): Promise<void>
    announceStartup(router: ChatRouter, adminUserId: string): Promise<void>
    flush(): Promise<void>
  }
  background: { start(router: ChatRouter): void | Promise<void>; stop(): void | Promise<void> }
  web: { start(adminUserId: string): void; stop(): void; route(request: Request): Promise<Response> }
  capabilities: ToolCapabilityCatalog
}>

export type PartialRuntimeDeps = {
  [K in keyof PapaiRuntimeDeps]?: Partial<PapaiRuntimeDeps[K]>
}

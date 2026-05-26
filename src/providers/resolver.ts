// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfig } from '../config.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { InstanceConfig, TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getKaneoWorkspace } from '../users.js'
import { isKaneoSessionCookie } from './kaneo/client.js'
import { createProvider } from './registry.js'
import type { TaskProvider } from './types.js'

const log = logger.child({ scope: 'provider:resolver' })

export interface TaskProviderResolverDeps {
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  isKaneoSessionCookie: typeof isKaneoSessionCookie
  createProvider: typeof createProvider
}

const defaultDeps: TaskProviderResolverDeps = {
  getContextSettings,
  getTaskInstance,
  getConfig,
  getKaneoWorkspace,
  isKaneoSessionCookie,
  createProvider,
}

const resolveBaseUrl = (config: InstanceConfig): string | null => {
  const baseUrl = config['baseUrl'] ?? config['url']
  if (baseUrl === undefined || baseUrl.trim() === '') return null
  return baseUrl
}

const buildKaneoConfig = (
  contextId: string,
  instance: TaskInstance,
  deps: TaskProviderResolverDeps,
): Record<string, string> | null => {
  const baseUrl = resolveBaseUrl(instance.config)
  const credential = deps.getConfig(contextId, 'kaneo_apikey')
  const workspaceId = deps.getKaneoWorkspace(contextId)
  if (baseUrl === null || credential === null || workspaceId === null) {
    log.warn(
      {
        contextId,
        taskInstanceId: instance.id,
        hasBaseUrl: baseUrl !== null,
        hasCredential: credential !== null,
        hasWorkspaceId: workspaceId !== null,
      },
      'Cannot resolve Kaneo provider: missing config',
    )
    return null
  }
  if (deps.isKaneoSessionCookie(credential)) return { baseUrl, sessionCookie: credential, workspaceId }
  return { apiKey: credential, baseUrl, workspaceId }
}

const buildYouTrackConfig = (
  contextId: string,
  instance: TaskInstance,
  deps: TaskProviderResolverDeps,
): Record<string, string> | null => {
  const baseUrl = resolveBaseUrl(instance.config)
  const token = deps.getConfig(contextId, 'youtrack_token')
  if (baseUrl === null || token === null) {
    log.warn(
      { contextId, taskInstanceId: instance.id, hasBaseUrl: baseUrl !== null, hasToken: token !== null },
      'Cannot resolve YouTrack provider: missing config',
    )
    return null
  }
  return { baseUrl, token }
}

export class TaskProviderResolver {
  private readonly deps: TaskProviderResolverDeps

  constructor(deps: Partial<TaskProviderResolverDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  resolve(contextId: string): TaskProvider | null {
    const settings = this.deps.getContextSettings(contextId)
    if (settings === null) {
      log.warn({ contextId }, 'Cannot resolve task provider: context has no task assignment')
      return null
    }

    const instance = this.deps.getTaskInstance(settings.taskInstanceId)
    if (instance === null) {
      log.warn({ contextId, taskInstanceId: settings.taskInstanceId }, 'Cannot resolve task provider: instance missing')
      return null
    }
    if (instance.status !== 'active') {
      log.warn(
        { contextId, taskInstanceId: instance.id, status: instance.status },
        'Cannot resolve task provider: instance is not active',
      )
      return null
    }

    const config =
      instance.type === 'kaneo'
        ? buildKaneoConfig(contextId, instance, this.deps)
        : instance.type === 'youtrack'
          ? buildYouTrackConfig(contextId, instance, this.deps)
          : { ...instance.config }
    if (config === null) return null

    log.info({ contextId, taskInstanceId: instance.id, taskProvider: instance.type }, 'Task provider resolved')
    return this.deps.createProvider(instance.type, config)
  }

  resolveStrict(contextId: string): TaskProvider {
    const provider = this.resolve(contextId)
    if (provider === null) throw new Error(`Context ${contextId} needs /setup`)
    return provider
  }
}

export const defaultTaskProviderResolver = new TaskProviderResolver()

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import * as adminStore from '../instances/admin-store.js'
import { listContextsByPlatformInstance, listContextsByTaskInstance } from '../instances/context-store.js'
import { maskConfig, providerSensitiveKeys } from '../instances/encryption.js'
import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  listActivePlatformInstances,
  listPlatformInstances,
  updatePlatformInstance,
} from '../instances/platform-store.js'
import {
  deleteTaskInstance,
  getTaskInstance,
  insertTaskInstance,
  listTaskInstances,
  updateTaskInstance,
} from '../instances/task-store.js'
import { clearToolCachesForContexts } from '../instances/tool-cache-invalidation.js'
import type { InstanceConfig, PlatformInstance, TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getTaskProviderDescriptor, listTaskProviderTypes } from '../providers/registry.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'
import {
  adminSchema,
  applyPlatformInstances,
  type InstanceApiDeps,
  instanceExistsError,
  instancePatchSchema,
  parseBody,
  platformInstanceSchema,
  splitPath,
  statusSchema,
  taskInstanceSchema,
  textResponse,
} from './instance-route-support.js'
import { jsonResponse } from './json-response.js'
import { handlePlatformProviderTypes } from './platform-provider-type-routes.js'
import { handleTaskProviderTypes, validateTaskInstanceConfig } from './task-provider-type-routes.js'

const log = logger.child({ scope: 'debug:instance-routes' })

const defaultDeps: InstanceApiDeps = {
  getRuntimeChatRouter,
  listActivePlatformInstances,
}

const INSTANCE_ROUTE_MASK = '********'

const platformInstanceSensitiveKeys = (type: string, config: InstanceConfig): ReadonlySet<string> =>
  providerSensitiveKeys(
    config,
    listPlatformProviderTypes().find((descriptor) => descriptor.type === type)?.instanceConfigSchema,
  )

const maskedPlatformInstance = (instance: PlatformInstance): PlatformInstance => ({
  ...instance,
  config: maskConfig(
    instance.config,
    platformInstanceSensitiveKeys(instance.type, instance.config),
    INSTANCE_ROUTE_MASK,
  ),
})

// Defense-in-depth: mask a task-instance config key if its provider descriptor declares it
// instance-scoped sensitive, OR its name looks secret-bearing. The pattern arm covers arbitrary
// keys operators can now write in-place via PATCH, which the descriptor schema does not constrain.
const taskInstanceSensitiveKeys = (type: string, config: InstanceConfig): ReadonlySet<string> => {
  const descriptor = getTaskProviderDescriptor(type)
  return providerSensitiveKeys(config, descriptor?.instanceConfigSchema)
}

const maskedTaskInstance = (instance: TaskInstance): TaskInstance => ({
  ...instance,
  config: maskConfig(instance.config, taskInstanceSensitiveKeys(instance.type, instance.config), INSTANCE_ROUTE_MASK),
})

const taskInstanceView = (
  instance: TaskInstance,
): TaskInstance & { readonly referencingContextCount: number; readonly referencingContextIds: readonly string[] } => {
  const referencingContextIds = listContextsByTaskInstance(instance.id)
    .map((context) => context.contextId)
    .toSorted((a, b) => a.localeCompare(b))
  return {
    ...maskedTaskInstance(instance),
    referencingContextCount: referencingContextIds.length,
    referencingContextIds,
  }
}

const INSTANCE_API_PREFIXES = [
  '/api/admins',
  '/api/platform-provider-types',
  '/api/platform-instances',
  '/api/task-instances',
  '/api/task-provider-types',
] as const

const isInstanceApiPath = (pathname: string): boolean =>
  INSTANCE_API_PREFIXES.some((prefix) => [pathname === prefix, pathname.startsWith(`${prefix}/`)].includes(true))

const authorizeWrite = (req: Request): boolean => {
  const token = process.env['DEBUG_TOKEN']
  if (token === undefined || token === '') return false
  const authorization = req.headers.get('Authorization')
  if (authorization === null) return false
  const headerToken = authorization.replace('Bearer ', '')
  return headerToken === token
}

const handlePlatformStatusUpdate = async (req: Request, instanceId: string): Promise<Response> => {
  if (getPlatformInstance(instanceId) === null) return textResponse('Not found', 404)
  const body = await parseBody(req, statusSchema)
  if (body instanceof Response) return body
  updatePlatformInstance(instanceId, { config: undefined, status: body.status })
  const instance = getPlatformInstance(instanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
}

const handlePlatformPatch = async (req: Request, instanceId: string): Promise<Response> => {
  if (getPlatformInstance(instanceId) === null) return textResponse('Not found', 404)
  const body = await parseBody(req, instancePatchSchema)
  if (body instanceof Response) return body
  updatePlatformInstance(instanceId, { config: body.config, status: body.status })
  const instance = getPlatformInstance(instanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
}

const resolveAdminPlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId !== undefined) return platformInstanceId
  return adminStore.SUPER_ADMIN_PLATFORM_ID
}

const handlePlatformInstances = async (req: Request, url: URL, deps: InstanceApiDeps): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/platform-instances' && req.method === 'GET') {
    return jsonResponse(listPlatformInstances().map((instance) => maskedPlatformInstance(instance)))
  }

  if (url.pathname === '/api/platform-instances' && req.method === 'POST') {
    const body = await parseBody(req, platformInstanceSchema)
    if (body instanceof Response) return body
    if (getPlatformInstance(body.id) !== null) return instanceExistsError(body.id)
    insertPlatformInstance({ ...body, status: 'active' })
    const instance = getPlatformInstance(body.id)
    return jsonResponse(instance === null ? null : maskedPlatformInstance(instance), { status: 201 })
  }

  if (url.pathname === '/api/platform-instances/apply' && req.method === 'POST') {
    return applyPlatformInstances(deps)
  }

  if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'platform-instances' && parts[3] === 'status') {
    if (req.method !== 'POST') return textResponse('Method not allowed', 405)
    const instanceId = parts[2]
    if (instanceId === undefined) return textResponse('Not found', 404)
    return handlePlatformStatusUpdate(req, instanceId)
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'platform-instances' && req.method === 'PATCH') {
    const instanceId = parts[2]
    if (instanceId === undefined) return textResponse('Not found', 404)
    return handlePlatformPatch(req, instanceId)
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'platform-instances') {
    if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
    const instanceId = parts[2]
    if (instanceId === undefined) return textResponse('Not found', 404)
    const referencingContextIds = listContextsByPlatformInstance(instanceId).map((context) => context.contextId)
    deletePlatformInstance(instanceId)
    clearToolCachesForContexts(referencingContextIds)
    return new Response(null, { status: 204 })
  }

  return null
}

const handleTaskInstances = async (req: Request, url: URL): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/task-instances' && req.method === 'GET') {
    return jsonResponse(listTaskInstances().map((instance) => taskInstanceView(instance)))
  }

  if (url.pathname === '/api/task-instances' && req.method === 'POST') {
    const body = await parseBody(req, taskInstanceSchema)
    if (body instanceof Response) return body
    if (!listTaskProviderTypes().some((descriptor) => descriptor.type === body.type)) {
      return jsonResponse({ error: 'unknown_task_provider_type', type: body.type }, { status: 400 })
    }
    if (getTaskInstance(body.id) !== null) return instanceExistsError(body.id)
    const configError = await validateTaskInstanceConfig(body.type, body.config)
    if (configError !== null) return configError
    insertTaskInstance({ ...body, status: 'active' })
    const instance = getTaskInstance(body.id)
    return jsonResponse(instance === null ? null : maskedTaskInstance(instance), { status: 201 })
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'task-instances' && req.method === 'PATCH') {
    const taskInstanceId = parts[2]
    if (taskInstanceId === undefined) return textResponse('Not found', 404)
    if (getTaskInstance(taskInstanceId) === null) return textResponse('Not found', 404)
    const body = await parseBody(req, instancePatchSchema)
    if (body instanceof Response) return body
    const referencingContextIds = listContextsByTaskInstance(taskInstanceId).map((context) => context.contextId)
    updateTaskInstance(taskInstanceId, { config: body.config, status: body.status })
    clearToolCachesForContexts(referencingContextIds)
    const instance = getTaskInstance(taskInstanceId)
    return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedTaskInstance(instance))
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'task-instances') {
    if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
    const taskInstanceId = parts[2]
    if (taskInstanceId === undefined) return textResponse('Not found', 404)
    const referencingContextIds = listContextsByTaskInstance(taskInstanceId).map((context) => context.contextId)
    deleteTaskInstance(taskInstanceId)
    clearToolCachesForContexts(referencingContextIds)
    return new Response(null, { status: 204 })
  }

  return null
}

const handleAdmins = async (req: Request, url: URL): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/admins' && req.method === 'GET') return jsonResponse(adminStore.listAdmins())

  if (url.pathname === '/api/admins' && req.method === 'POST') {
    const body = await parseBody(req, adminSchema)
    if (body instanceof Response) return body
    const platformInstanceId = resolveAdminPlatformInstanceId(body.platformInstanceId)
    if (platformInstanceId !== adminStore.SUPER_ADMIN_PLATFORM_ID && getPlatformInstance(platformInstanceId) === null) {
      return jsonResponse({ error: 'platform_instance_not_found', id: platformInstanceId }, { status: 404 })
    }
    adminStore.addAdmin(body.userId, platformInstanceId)
    return jsonResponse({ userId: body.userId, platformInstanceId }, { status: 201 })
  }

  if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'admins') {
    if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
    const userId = parts[2]
    const platformInstanceId = parts[3]
    if (userId === undefined || platformInstanceId === undefined) return textResponse('Not found', 404)
    adminStore.removeAdmin(userId, platformInstanceId)
    return new Response(null, { status: 204 })
  }

  return null
}

const routeInstanceApi = (
  req: Request,
  url: URL,
  deps: InstanceApiDeps,
): Response | Promise<Response | null> | null => {
  if (url.pathname.startsWith('/api/platform-provider-types')) return handlePlatformProviderTypes(req, url)
  if (url.pathname.startsWith('/api/platform-instances')) return handlePlatformInstances(req, url, deps)
  if (url.pathname.startsWith('/api/task-provider-types')) return handleTaskProviderTypes(req, url)
  if (url.pathname.startsWith('/api/task-instances')) return handleTaskInstances(req, url)
  if (url.pathname.startsWith('/api/admins')) return handleAdmins(req, url)
  return null
}

export const handleInstanceApiRouteWithDeps = async (
  req: Request,
  url: URL,
  deps: InstanceApiDeps,
): Promise<Response | null> => {
  if (!isInstanceApiPath(url.pathname)) return null
  if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && !authorizeWrite(req)) {
    return textResponse('Unauthorized', 401)
  }

  try {
    const response = await routeInstanceApi(req, url, deps)
    if (response === null) return textResponse('Not found', 404)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ method: req.method, path: url.pathname, error: message }, 'instance API route failed')
    return jsonResponse({ error: 'config unreadable' }, { status: 500 })
  }
}

export const handleInstanceApiRoute = (req: Request, url: URL): Promise<Response | null> =>
  handleInstanceApiRouteWithDeps(req, url, defaultDeps)

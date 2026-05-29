// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import { authenticate } from '../dashboard-auth/index.js'
import { listContextsByPlatformInstance, listContextsByTaskInstance } from '../instances/context-store.js'
import { maskConfig, providerSensitiveKeys, unknownProviderSensitiveKeys } from '../instances/encryption.js'
import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  listPlatformInstances,
  listPlatformInstancesSafe,
  updatePlatformInstance,
} from '../instances/platform-store.js'
import {
  deleteTaskInstance,
  getTaskInstance,
  insertTaskInstance,
  listTaskInstancesSafe,
  updateTaskInstance,
} from '../instances/task-store.js'
import { clearToolCachesForContexts } from '../instances/tool-cache-invalidation.js'
import type { InstanceConfig, PlatformInstance, TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'
import { handleAdmins } from './instance-admin-routes.js'
import { validatePlatformInstanceConfig, validateTaskInstanceRouteConfig } from './instance-config-validation.js'
import {
  applyPlatformInstances,
  type InstanceApiDeps,
  instanceExistsError,
  instancePatchSchema,
  insertOrConflict,
  isInstanceApiPath,
  parseBody,
  platformInstanceSchema,
  splitPath,
  statusSchema,
  taskInstanceSchema,
  textResponse,
} from './instance-route-support.js'
import { jsonResponse } from './json-response.js'
import { handlePlatformProviderTypes } from './platform-provider-type-routes.js'
import { handleTaskProviderTypes } from './task-provider-type-routes.js'

const log = logger.child({ scope: 'debug:instance-routes' })

const defaultDeps: InstanceApiDeps = {
  getRuntimeChatRouter,
  listPlatformInstances,
}

const INSTANCE_ROUTE_MASK = '********'

const instanceListResponse = (instances: readonly unknown[], unreadable: readonly unknown[]): Response => {
  if (unreadable.length === 0) return jsonResponse(instances)
  return jsonResponse({ instances, unreadable })
}

const platformInstanceSensitiveKeys = (type: string, config: InstanceConfig): ReadonlySet<string> => {
  const descriptor = listPlatformProviderTypes().find((candidate) => candidate.type === type)
  if (descriptor === undefined) return unknownProviderSensitiveKeys(config)
  return providerSensitiveKeys(config, descriptor.instanceConfigSchema)
}

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
  if (descriptor === undefined) return unknownProviderSensitiveKeys(config)
  return providerSensitiveKeys(config, descriptor.instanceConfigSchema)
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

const handlePlatformStatusUpdate = async (req: Request, instanceId: string): Promise<Response> => {
  if (getPlatformInstance(instanceId) === null) return textResponse('Not found', 404)
  const body = await parseBody(req, statusSchema)
  if (body instanceof Response) return body
  const referencingContextIds = listContextsByPlatformInstance(instanceId).map((context) => context.contextId)
  updatePlatformInstance(instanceId, { config: undefined, status: body.status })
  clearToolCachesForContexts(referencingContextIds)
  const instance = getPlatformInstance(instanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
}

const handlePlatformPatch = async (req: Request, instanceId: string): Promise<Response> => {
  const existing = getPlatformInstance(instanceId)
  if (existing === null) return textResponse('Not found', 404)
  const body = await parseBody(req, instancePatchSchema)
  if (body instanceof Response) return body
  if (body.config !== undefined) {
    const configError = validatePlatformInstanceConfig(existing.type, body.config)
    if (configError !== null) return configError
  }
  const referencingContextIds = listContextsByPlatformInstance(instanceId).map((context) => context.contextId)
  updatePlatformInstance(instanceId, { config: body.config, status: body.status })
  clearToolCachesForContexts(referencingContextIds)
  const instance = getPlatformInstance(instanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
}

const handlePlatformCreate = async (req: Request): Promise<Response> => {
  const body = await parseBody(req, platformInstanceSchema)
  if (body instanceof Response) return body
  if (getPlatformInstance(body.id) !== null) return instanceExistsError(body.id)
  const configError = validatePlatformInstanceConfig(body.type, body.config)
  if (configError !== null) return configError
  const conflict = insertOrConflict(body.id, () => {
    insertPlatformInstance({ ...body, status: 'active' })
  })
  if (conflict !== null) return conflict
  const instance = getPlatformInstance(body.id)
  return jsonResponse(instance === null ? null : maskedPlatformInstance(instance), { status: 201 })
}

const handlePlatformInstances = (
  req: Request,
  url: URL,
  deps: InstanceApiDeps,
): Response | Promise<Response | null> | null => {
  const parts = splitPath(url)

  if (url.pathname === '/api/platform-instances' && req.method === 'GET') {
    const result = listPlatformInstancesSafe()
    return instanceListResponse(
      result.instances.map((instance) => maskedPlatformInstance(instance)),
      result.failures,
    )
  }

  if (url.pathname === '/api/platform-instances' && req.method === 'POST') {
    return handlePlatformCreate(req)
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

const handleTaskCreate = async (req: Request): Promise<Response> => {
  const body = await parseBody(req, taskInstanceSchema)
  if (body instanceof Response) return body
  if (getTaskInstance(body.id) !== null) return instanceExistsError(body.id)
  const configError = await validateTaskInstanceRouteConfig(body.type, body.config)
  if (configError !== null) return configError
  const conflict = insertOrConflict(body.id, () => {
    insertTaskInstance({ ...body, status: 'active' })
  })
  if (conflict !== null) return conflict
  const instance = getTaskInstance(body.id)
  return jsonResponse(instance === null ? null : maskedTaskInstance(instance), { status: 201 })
}

const handleTaskInstances = async (req: Request, url: URL): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/task-instances' && req.method === 'GET') {
    const result = listTaskInstancesSafe()
    return instanceListResponse(
      result.instances.map((instance) => taskInstanceView(instance)),
      result.failures,
    )
  }

  if (url.pathname === '/api/task-instances' && req.method === 'POST') {
    return handleTaskCreate(req)
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'task-instances' && req.method === 'PATCH') {
    const taskInstanceId = parts[2]
    if (taskInstanceId === undefined) return textResponse('Not found', 404)
    const existing = getTaskInstance(taskInstanceId)
    if (existing === null) return textResponse('Not found', 404)
    const body = await parseBody(req, instancePatchSchema)
    if (body instanceof Response) return body
    if (body.config !== undefined) {
      const configError = await validateTaskInstanceRouteConfig(existing.type, body.config)
      if (configError !== null) return configError
    }
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
  if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && authenticate(req) === null) {
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

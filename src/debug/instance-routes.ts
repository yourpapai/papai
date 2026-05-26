// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ChatRouter } from '../chat/router.js'
import { addAdmin, listAdmins, removeAdmin, SUPER_ADMIN_PLATFORM_ID } from '../instances/admin-store.js'
import {
  deleteContextsByPlatformInstance,
  deleteContextsByTaskInstance,
  listContextsByTaskInstance,
} from '../instances/context-store.js'
import { maskConfig } from '../instances/encryption.js'
import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  listActivePlatformInstances,
  listPlatformInstances,
  updatePlatformInstance,
} from '../instances/platform-store.js'
import { deleteTaskInstance, getTaskInstance, insertTaskInstance, listTaskInstances } from '../instances/task-store.js'
import type { InstanceConfig, PlatformInstance, TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'

const log = logger.child({ scope: 'debug:instance-routes' })

type InstanceApiDeps = {
  readonly getRuntimeChatRouter: () => ChatRouter | null
  readonly listActivePlatformInstances: () => PlatformInstance[]
}

const defaultDeps: InstanceApiDeps = {
  getRuntimeChatRouter,
  listActivePlatformInstances,
}

const instanceConfigSchema: z.ZodType<InstanceConfig> = z.record(z.string(), z.string())
const platformInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['telegram', 'mattermost', 'discord']),
  config: instanceConfigSchema,
})
const taskInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['kaneo', 'youtrack']),
  config: instanceConfigSchema,
})
const statusSchema = z.object({ status: z.enum(['pending', 'active', 'stopped']) })
const adminSchema = z.object({
  userId: z.string().min(1),
  platformInstanceId: z.string().min(1).optional(),
})

const jsonResponse = (body: unknown, ...args: [] | [ResponseInit]): Response => {
  if (args.length === 0) {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }
  const init = args[0]
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}

const textResponse = (body: string, status: number): Response => new Response(body, { status })

const maskedPlatformInstance = (instance: PlatformInstance): PlatformInstance => ({
  ...instance,
  config: maskConfig(instance.config),
})

const maskedTaskInstance = (instance: TaskInstance): TaskInstance => ({
  ...instance,
  config: maskConfig(instance.config),
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

const INSTANCE_API_PREFIXES = ['/api/admins', '/api/platform-instances', '/api/task-instances'] as const

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

const parseJson = async (req: Request): Promise<unknown> => {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}

const validationError = (error: z.ZodError): Response =>
  jsonResponse({ error: 'invalid_request', issues: error.issues }, { status: 400 })

const parseBody = async <T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> => {
  const result = schema.safeParse(await parseJson(req))
  return result.success ? result.data : validationError(result.error)
}

const splitPath = (url: URL): readonly string[] =>
  url.pathname
    .split('/')
    .filter((part) => part !== '')
    .map((part) => decodeURIComponent(part))

const handlePlatformInstances = async (req: Request, url: URL, deps: InstanceApiDeps): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/platform-instances' && req.method === 'GET') {
    return jsonResponse(listPlatformInstances().map((instance) => maskedPlatformInstance(instance)))
  }

  if (url.pathname === '/api/platform-instances' && req.method === 'POST') {
    const body = await parseBody(req, platformInstanceSchema)
    if (body instanceof Response) return body
    insertPlatformInstance({ ...body, status: 'active' })
    const instance = getPlatformInstance(body.id)
    return jsonResponse(instance === null ? null : maskedPlatformInstance(instance), { status: 201 })
  }

  if (url.pathname === '/api/platform-instances/apply' && req.method === 'POST') {
    return applyPlatformInstances(deps)
  }

  if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'platform-instances' && parts[3] === 'status') {
    if (req.method !== 'POST') return textResponse('Method not allowed', 405)
    const body = await parseBody(req, statusSchema)
    if (body instanceof Response) return body
    const instanceId = parts[2]
    if (instanceId === undefined) return textResponse('Not found', 404)
    updatePlatformInstance(instanceId, { config: undefined, status: body.status })
    const instance = getPlatformInstance(instanceId)
    return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'platform-instances') {
    if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
    const instanceId = parts[2]
    if (instanceId === undefined) return textResponse('Not found', 404)
    const router = getRuntimeChatRouter()
    if (router !== null) await router.removeInstance(instanceId)
    deleteContextsByPlatformInstance(instanceId)
    deletePlatformInstance(instanceId)
    return new Response(null, { status: 204 })
  }

  return null
}

const applyPlatformInstances = async (deps: InstanceApiDeps): Promise<Response> => {
  const router = deps.getRuntimeChatRouter()
  if (router === null) return jsonResponse({ error: 'router not initialised' }, { status: 503 })

  const activeInstances = deps.listActivePlatformInstances()
  const activeIds = new Set(activeInstances.map((instance) => instance.id))
  const runtimeIds = router.listInstances().map((instance) => instance.id)
  const removed = runtimeIds.filter((id) => !activeIds.has(id))
  const missing = activeInstances.filter((instance) => router.getInstance(instance.id) === null)
  const stopped = activeInstances.filter((instance) => {
    const runtimeInstance = router.getInstance(instance.id)
    return runtimeInstance !== null && runtimeInstance.status === 'stopped'
  })

  await Promise.all(removed.map((id) => router.removeInstance(id)))
  await Promise.all(
    missing.map((instance) => {
      router.addInstance(instance.id, instance.type, instance.config)
      return router.startInstance(instance.id)
    }),
  )
  await Promise.all(stopped.map((instance) => router.startInstance(instance.id)))

  return jsonResponse({ applied: activeInstances.length })
}

const handleTaskInstances = async (req: Request, url: URL): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/task-instances' && req.method === 'GET') {
    return jsonResponse(listTaskInstances().map((instance) => taskInstanceView(instance)))
  }

  if (url.pathname === '/api/task-instances' && req.method === 'POST') {
    const body = await parseBody(req, taskInstanceSchema)
    if (body instanceof Response) return body
    insertTaskInstance({ ...body, status: 'active' })
    const instance = getTaskInstance(body.id)
    return jsonResponse(instance === null ? null : maskedTaskInstance(instance), { status: 201 })
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'task-instances') {
    if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
    const taskInstanceId = parts[2]
    if (taskInstanceId === undefined) return textResponse('Not found', 404)
    deleteContextsByTaskInstance(taskInstanceId)
    deleteTaskInstance(taskInstanceId)
    return new Response(null, { status: 204 })
  }

  return null
}

const handleAdmins = async (req: Request, url: URL): Promise<Response | null> => {
  const parts = splitPath(url)

  if (url.pathname === '/api/admins' && req.method === 'GET') return jsonResponse(listAdmins())

  if (url.pathname === '/api/admins' && req.method === 'POST') {
    const body = await parseBody(req, adminSchema)
    if (body instanceof Response) return body
    const platformInstanceId = resolvePlatformInstanceId(body.platformInstanceId)
    addAdmin(body.userId, platformInstanceId)
    return jsonResponse({ userId: body.userId, platformInstanceId }, { status: 201 })
  }

  if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'admins') {
    if (req.method !== 'DELETE') return textResponse('Method not allowed', 405)
    const userId = parts[2]
    const platformInstanceId = parts[3]
    if (userId === undefined || platformInstanceId === undefined) return textResponse('Not found', 404)
    removeAdmin(userId, platformInstanceId)
    return new Response(null, { status: 204 })
  }

  return null
}

const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId !== undefined) return platformInstanceId
  return SUPER_ADMIN_PLATFORM_ID
}

const routeInstanceApi = (
  req: Request,
  url: URL,
  deps: InstanceApiDeps,
): Response | Promise<Response | null> | null => {
  if (url.pathname.startsWith('/api/platform-instances')) return handlePlatformInstances(req, url, deps)
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
  if ((req.method === 'POST' || req.method === 'DELETE') && !authorizeWrite(req)) {
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

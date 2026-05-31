// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { listPlatformProviderTypes } from '../../../chat/registry.js'
import { maskConfig } from '../../../instances/encryption.js'
import {
  deletePlatformInstance,
  insertPlatformInstance,
  listPlatformInstances,
  updatePlatformInstance,
} from '../../../instances/platform-store.js'
import {
  deleteTaskInstance,
  insertTaskInstance,
  listTaskInstances,
  updateTaskInstance,
} from '../../../instances/task-store.js'
import type { TaskInstance } from '../../../instances/types.js'
import { logger } from '../../../logger.js'
import { listTaskProviderTypes } from '../../../providers/registry.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-instances' })

const maskTask = (i: TaskInstance): unknown => ({ ...i, config: maskConfig(i.config) })

const PlatformInstanceCreateSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['telegram', 'mattermost', 'discord', 'kontur-talk']),
  config: z.record(z.string(), z.string()).default({}),
  status: z.enum(['pending', 'active', 'stopped']).default('pending'),
})

const TaskInstanceCreateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.string()).default({}),
  status: z.enum(['pending', 'active', 'stopped']).default('pending'),
})

const InstancePatchSchema = z.object({
  config: z.record(z.string(), z.string()).optional(),
  status: z.enum(['pending', 'active', 'stopped']).optional(),
})

function lastPathSegment(url: URL): string | undefined {
  const parts = url.pathname.split('/').filter((p) => p.length > 0)
  return parts.at(-1)
}

function handleTaskInstancesGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return settingsJson(200, { instances: listTaskInstances().map(maskTask) })
}

async function handleTaskInstancesPost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = TaskInstanceCreateSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  insertTaskInstance(body.data)
  log.info({ id: body.data.id }, 'Settings admin created task instance')
  return settingsJson(201, { ok: true, id: body.data.id })
}

async function handleTaskInstancePatch(
  req: Request,
  id: string,
  authed: AuthenticatedSettingsRequest,
): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = InstancePatchSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  updateTaskInstance(id, { config: body.data.config, status: body.data.status })
  return settingsJson(200, { ok: true, id })
}

function handleTaskInstanceDelete(req: Request, id: string, authed: AuthenticatedSettingsRequest): Response {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  deleteTaskInstance(id)
  return settingsJson(200, { ok: true, id })
}

function handleTaskInstances(req: Request, url: URL, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleTaskInstancesGet(authed))

  const writeGuard = requireAdmin(authed, 'write')
  if (writeGuard !== null) return Promise.resolve(writeGuard)

  if (req.method === 'POST' && url.pathname === '/settings/api/admin/task-instances') {
    return handleTaskInstancesPost(req, authed)
  }

  const id = lastPathSegment(url)
  if (id === undefined || id === 'task-instances') return Promise.resolve(settingsJson(404, { error: 'not found' }))

  if (req.method === 'PATCH') return handleTaskInstancePatch(req, id, authed)
  if (req.method === 'DELETE') return Promise.resolve(handleTaskInstanceDelete(req, id, authed))

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

function handlePlatformInstancesGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return settingsJson(200, { instances: listPlatformInstances().map((i) => ({ ...i, config: maskConfig(i.config) })) })
}

async function handlePlatformInstancesPost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PlatformInstanceCreateSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  insertPlatformInstance(body.data)
  log.info({ id: body.data.id }, 'Settings admin created platform instance')
  return settingsJson(201, { ok: true, id: body.data.id })
}

async function handlePlatformInstancePatch(
  req: Request,
  id: string,
  authed: AuthenticatedSettingsRequest,
): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = InstancePatchSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  updatePlatformInstance(id, { config: body.data.config, status: body.data.status })
  return settingsJson(200, { ok: true, id })
}

function handlePlatformInstanceDelete(req: Request, id: string, authed: AuthenticatedSettingsRequest): Response {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  deletePlatformInstance(id)
  return settingsJson(200, { ok: true, id })
}

function handlePlatformInstances(req: Request, url: URL, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handlePlatformInstancesGet(authed))

  const writeGuard = requireAdmin(authed, 'write')
  if (writeGuard !== null) return Promise.resolve(writeGuard)

  if (req.method === 'POST' && url.pathname === '/settings/api/admin/platform-instances') {
    return handlePlatformInstancesPost(req, authed)
  }

  const id = lastPathSegment(url)
  if (id === undefined || id === 'platform-instances') {
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }

  if (req.method === 'PATCH') return handlePlatformInstancePatch(req, id, authed)
  if (req.method === 'DELETE') return Promise.resolve(handlePlatformInstanceDelete(req, id, authed))

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

function routeAdminInstances(req: Request, url: URL, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (url.pathname.startsWith('/settings/api/admin/task-instances')) {
    return handleTaskInstances(req, url, authed)
  }
  return handlePlatformInstances(req, url, authed)
}

function handleProviderTypesRead(authed: AuthenticatedSettingsRequest, pathname: string): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  if (pathname === '/settings/api/admin/platform-provider-types') {
    return settingsJson(200, { providerTypes: listPlatformProviderTypes() })
  }
  return settingsJson(200, { providerTypes: listTaskProviderTypes() })
}

export function handleAdminInstancesRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (
    pathname === '/settings/api/admin/platform-provider-types' ||
    pathname === '/settings/api/admin/task-provider-types'
  ) {
    if (req.method !== 'GET') return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
    return Promise.resolve(handleProviderTypesRead(auth.authed, pathname))
  }

  return routeAdminInstances(req, url, auth.authed)
}

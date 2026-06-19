// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getContextSettings, setContextSettings } from '../../instances/context-store.js'
import { getTaskInstance, listTaskInstancesSafe } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import { getTaskProviderProvision } from '../../providers/registry.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-context-task-instance' })

const TaskInstanceBodySchema = z.object({
  taskInstanceId: z.string().min(1),
  contextId: z.string().optional(),
})

/**
 * True when the bound task instance is active and its provider type has a
 * provision hook (e.g. Kaneo). Mirrors the precondition enforced by
 * `handleProvisionKaneo`, so the settings UI only offers auto-provision when it
 * would actually succeed.
 */
export function isBoundInstanceProvisionable(taskInstanceId: string | null | undefined): boolean {
  if (taskInstanceId === null || taskInstanceId === undefined || taskInstanceId === '') return false
  const taskInstance = getTaskInstance(taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return false
  return getTaskProviderProvision(taskInstance.type) !== undefined
}

/** Active task instances offered as binding targets; unreadable rows are excluded. */
function listActiveTaskInstanceOptions(): { id: string; type: string; status: string }[] {
  return listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({ id: taskInstance.id, type: taskInstance.type, status: taskInstance.status }))
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const settings = getContextSettings(scope.scope.contextId)
  return settingsJson(200, {
    contextId: scope.scope.contextId,
    taskInstanceId: settings?.taskInstanceId ?? null,
    available: listActiveTaskInstanceOptions(),
    canProvision: isBoundInstanceProvisionable(settings?.taskInstanceId),
  })
}

async function handlePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = TaskInstanceBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const safe = listTaskInstancesSafe()
  if (safe.failures.some((failure) => failure.id === body.data.taskInstanceId)) {
    return settingsJson(422, { error: 'unreadable task instance' })
  }
  const taskInstance = safe.instances.find((instance) => instance.id === body.data.taskInstanceId)
  if (taskInstance === undefined) {
    return settingsJson(422, { error: 'unknown task instance' })
  }
  if (taskInstance.status !== 'active') {
    return settingsJson(422, { error: 'inactive task instance' })
  }

  const existing = getContextSettings(scope.scope.contextId)
  setContextSettings({
    contextId: scope.scope.contextId,
    taskInstanceId: body.data.taskInstanceId,
    platformInstanceId: existing?.platformInstanceId ?? authed.principal.platformInstanceId,
  })
  log.info(
    { contextId: scope.scope.contextId, taskInstanceId: body.data.taskInstanceId },
    'Settings context task instance set',
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handleContextTaskInstanceRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'PATCH') {
    const auth = authenticate(req)
    if (!auth.ok) return Promise.resolve(auth.response)
    return handlePatch(req, auth.authed)
  }
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

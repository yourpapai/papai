// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { getGroupAnnounceSubscribed, setGroupAnnounceSubscribed } from '../../announcements/store.js'
import {
  getGroupCodingIdentity,
  isGuestModeEnabled,
  setGroupCodingIdentity,
  setGuestMode,
} from '../../authorized-groups.js'
import { getDrizzleDb } from '../../db/drizzle.js'
import { taskInstances } from '../../db/instance-schema.js'
import { addGroupMember, isGroupMember, listGroupMembers, removeGroupMember } from '../../groups.js'
import { getContextSettings, setContextSettings } from '../../instances/context-store.js'
import { listTaskInstancesSafe } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { requireScope } from '../../settings/scope-guard.js'
import { isBoundInstanceProvisionable } from './context-task-instance-routes.js'
import { enrichMembers } from './member-enrichment.js'
import { resolveSettingsUserId } from './resolve-user-id.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-group' })

type GroupContext = { contextId: string }
type GroupOutcome = { ok: true; group: GroupContext } | { ok: false; response: Response }
type TaskInstanceLookup = { status: string }

function lookupTaskInstance(id: string): TaskInstanceLookup | null {
  const row = getDrizzleDb()
    .select({ status: taskInstances.status })
    .from(taskInstances)
    .where(eq(taskInstances.id, id))
    .get()
  return row ?? null
}

/** Resolve a required group scope from a raw contextId; 403 if not a manageable group. */
function requireGroup(
  authed: AuthenticatedSettingsRequest,
  action: 'read' | 'write',
  rawContextId: string | null,
): GroupOutcome {
  if (rawContextId === null || rawContextId.length === 0) {
    return { ok: false, response: settingsJson(403, { error: 'forbidden' }) }
  }
  const result = requireScope(authed.principal, { action, target: { kind: 'group', contextId: rawContextId } })
  if (!result.ok) return { ok: false, response: settingsJson(403, { error: 'forbidden' }) }
  return { ok: true, group: { contextId: result.contextId } }
}

async function handleMembersGet(authed: AuthenticatedSettingsRequest, url: URL): Promise<Response> {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  const contextId = outcome.group.contextId
  const members = await enrichMembers(contextId, listGroupMembers(contextId))
  return settingsJson(200, { contextId, members })
}

const MemberBodySchema = z.object({ userId: z.string().min(1), contextId: z.string().min(1) })
const GuestModeBodySchema = z.object({ enabled: z.boolean(), contextId: z.string().min(1) })
const ReleaseSubBodySchema = z.object({ enabled: z.boolean(), contextId: z.string().min(1) })
const CodingIdentityBodySchema = z.object({ identity: z.string().min(1), contextId: z.string().min(1) })

const VALID_PLAIN_IDENTITIES = new Set(['initiator', 'shared'])

async function handleMembersWrite(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = MemberBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response

  if (req.method === 'POST') {
    const resolution = await resolveSettingsUserId(body.data.userId, authed.principal)
    if (resolution.kind === 'unresolved') {
      return settingsJson(422, {
        error: `could not resolve "${body.data.userId}" to a user ID — use the numeric user ID`,
      })
    }
    addGroupMember(outcome.group.contextId, resolution.userId, authed.principal.platformUserId)
    log.info({ contextId: outcome.group.contextId }, 'Settings group member added')
  } else {
    removeGroupMember(outcome.group.contextId, body.data.userId)
    log.info({ contextId: outcome.group.contextId }, 'Settings group member removed')
  }
  return settingsJson(200, { ok: true, contextId: outcome.group.contextId })
}

function handleGuestModeGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  return settingsJson(200, { contextId: outcome.group.contextId, enabled: isGuestModeEnabled(outcome.group.contextId) })
}

async function handleGuestModePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = GuestModeBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response
  setGuestMode(outcome.group.contextId, body.data.enabled)
  log.info({ contextId: outcome.group.contextId, enabled: body.data.enabled }, 'Settings group guest mode updated')
  return settingsJson(200, { ok: true, contextId: outcome.group.contextId, enabled: body.data.enabled })
}

function handleReleaseSubGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  return settingsJson(200, {
    contextId: outcome.group.contextId,
    enabled: getGroupAnnounceSubscribed(outcome.group.contextId),
  })
}

async function handleReleaseSubPatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ReleaseSubBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response
  setGroupAnnounceSubscribed(outcome.group.contextId, body.data.enabled)
  log.info({ contextId: outcome.group.contextId, enabled: body.data.enabled }, 'group release subscription updated')
  return settingsJson(200, { ok: true, contextId: outcome.group.contextId, enabled: body.data.enabled })
}

function handleCodingIdentityGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  return settingsJson(200, {
    contextId: outcome.group.contextId,
    identity: getGroupCodingIdentity(outcome.group.contextId),
  })
}

async function handleCodingIdentityPatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = CodingIdentityBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response
  const { identity } = body.data
  const groupId = outcome.group.contextId
  if (!VALID_PLAIN_IDENTITIES.has(identity)) {
    if (!identity.startsWith('designated:')) {
      return settingsJson(422, { error: 'invalid identity' })
    }
    const userId = identity.slice('designated:'.length)
    if (!isGroupMember(groupId, userId)) {
      return settingsJson(422, { error: 'designated user is not a group member' })
    }
  }
  setGroupCodingIdentity(groupId, identity)
  log.info({ contextId: groupId, identity }, 'Settings group coding identity updated')
  return settingsJson(200, { ok: true, contextId: groupId, identity })
}

function handleTaskInstanceGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  const settings = getContextSettings(outcome.group.contextId)
  const available = listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({
      id: taskInstance.id,
      type: taskInstance.type,
      status: taskInstance.status,
      name: taskInstance.config['baseUrl'],
    }))
  return settingsJson(200, {
    contextId: outcome.group.contextId,
    taskInstanceId: settings?.taskInstanceId ?? null,
    available,
    canProvision: isBoundInstanceProvisionable(settings?.taskInstanceId),
  })
}

const TaskInstanceBodySchema = z.object({ taskInstanceId: z.string().min(1), contextId: z.string().min(1) })

async function handleTaskInstancePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = TaskInstanceBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response

  const taskInstanceResult = listTaskInstancesSafe()
  if (taskInstanceResult.failures.some((failure) => failure.id === body.data.taskInstanceId)) {
    return settingsJson(422, { error: 'unreadable task instance' })
  }
  const taskInstance = lookupTaskInstance(body.data.taskInstanceId)
  if (taskInstance === null) {
    return settingsJson(422, { error: 'unknown task instance' })
  }
  if (taskInstance.status !== 'active') {
    return settingsJson(422, { error: 'inactive task instance' })
  }
  const existing = getContextSettings(outcome.group.contextId)
  setContextSettings({
    contextId: outcome.group.contextId,
    taskInstanceId: body.data.taskInstanceId,
    platformInstanceId: existing?.platformInstanceId ?? authed.principal.platformInstanceId,
  })
  log.info(
    { contextId: outcome.group.contextId, taskInstanceId: body.data.taskInstanceId },
    'Settings group task instance set',
  )
  return settingsJson(200, { ok: true, contextId: outcome.group.contextId })
}

export function handleGroupRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (pathname === '/settings/api/group/members') {
    if (req.method === 'GET') return handleMembersGet(auth.authed, url)
    if (req.method === 'POST' || req.method === 'DELETE') return handleMembersWrite(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/group/task-instance') {
    if (req.method === 'GET') return Promise.resolve(handleTaskInstanceGet(auth.authed, url))
    if (req.method === 'PATCH') return handleTaskInstancePatch(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/group/guest-mode') {
    if (req.method === 'GET') return Promise.resolve(handleGuestModeGet(auth.authed, url))
    if (req.method === 'PATCH') return handleGuestModePatch(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/group/release-subscription') {
    if (req.method === 'GET') return Promise.resolve(handleReleaseSubGet(auth.authed, url))
    if (req.method === 'PATCH') return handleReleaseSubPatch(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/group/coding-identity') {
    if (req.method === 'GET') return Promise.resolve(handleCodingIdentityGet(auth.authed, url))
    if (req.method === 'PATCH') return handleCodingIdentityPatch(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { isAuthorizedGroup } from '../../authorized-groups.js'
import { getNativeContextId, parseScopedContextId } from '../../chat/scoped-context.js'
import { getDrizzleDb } from '../../db/drizzle.js'
import { kaneoWorkspaceMembers, knownGroupContexts, type KaneoWorkspaceMember } from '../../db/schema.js'
import { getContextSettings } from '../../instances/context-store.js'
import { decryptInstanceConfig } from '../../instances/encryption.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import type { SettingsPrincipal } from '../../settings/principal.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-kaneo-credentials' })

function getKaneoMemberRow(groupContextId: string, chatUserId: string): KaneoWorkspaceMember | undefined {
  return getDrizzleDb()
    .select()
    .from(kaneoWorkspaceMembers)
    .where(
      and(eq(kaneoWorkspaceMembers.groupContextId, groupContextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)),
    )
    .get()
}

function getKaneoPublicUrl(groupContextId: string): string | null {
  const settings = getContextSettings(groupContextId)
  if (settings === null) return null
  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.type !== 'kaneo') return null
  return instance.config['baseUrl'] ?? null
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const { contextId } = scope.scope
  const chatUserId = auth.authed.principal.platformUserId
  const row = getKaneoMemberRow(contextId, chatUserId)
  if (row === undefined) {
    return settingsJson(404, { error: 'No Kaneo account provisioned for this member in this group.' })
  }
  const kaneoUrl = getKaneoPublicUrl(contextId)
  return settingsJson(200, {
    contextId,
    login: row.login,
    status: row.status,
    kaneoUrl,
    // password is never returned in GET — use POST { action: 'reveal' } to reveal it once.
  })
}

const PostBodySchema = z.object({
  action: z.literal('reveal'),
  contextId: z.string().optional(),
})

function decryptStoredPassword(
  contextId: string,
  encryptedPassword: string,
): { ok: true; password: string } | { ok: false; response: Response } {
  let password: string
  try {
    const decrypted = decryptInstanceConfig(encryptedPassword)
    password = decrypted['password'] ?? ''
  } catch (err: unknown) {
    log.error(
      { contextId, error: err instanceof Error ? err.message : String(err) },
      'Failed to decrypt Kaneo password',
    )
    return {
      ok: false,
      response: settingsJson(500, { error: 'Failed to decrypt stored password — contact your administrator.' }),
    }
  }
  if (password === '')
    return {
      ok: false,
      response: settingsJson(500, { error: 'Stored password is empty — contact your administrator.' }),
    }
  return { ok: true, password }
}

function clearStoredPassword(contextId: string, chatUserId: string): void {
  getDrizzleDb()
    .update(kaneoWorkspaceMembers)
    .set({ encryptedPassword: null })
    .where(and(eq(kaneoWorkspaceMembers.groupContextId, contextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)))
    .run()
}

async function handlePost(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PostBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const { contextId } = scope.scope
  const chatUserId = auth.authed.principal.platformUserId
  const row = getKaneoMemberRow(contextId, chatUserId)
  if (row === undefined) return settingsJson(404, { error: 'No Kaneo account provisioned for this member.' })

  // Branch B only: reveal stored encrypted password once (Branch A admin/set-password → 404 in Kaneo 2.7.2).
  if (row.encryptedPassword === null) {
    return settingsJson(409, {
      error:
        'No stored password for this account. This account was provisioned before credential storage was introduced — ask an admin to re-provision it.',
    })
  }

  const decryptResult = decryptStoredPassword(contextId, row.encryptedPassword)
  if (!decryptResult.ok) return decryptResult.response

  clearStoredPassword(contextId, chatUserId)
  log.info({ contextId, chatUserId }, 'Kaneo member password revealed (reveal-once)')
  return settingsJson(200, {
    password: decryptResult.password,
    warning: 'This password is shown once. Store it securely.',
  })
}

export function handleKaneoCredentialsRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'POST') return handlePost(req)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

// ---------------------------------------------------------------------------
// Member-scoped route: a member reads/reveals only their own rows, authorized
// by row ownership rather than group-manager scope.
// ---------------------------------------------------------------------------

type MembershipSummary = Readonly<{
  contextId: string
  groupLabel: string
  login: string
  status: string
  kaneoUrl: string | null
}>

const NOT_PROVISIONED_ERROR = 'No Kaneo account provisioned for this member.'

/** A row counts only for an authorized group on the caller's own platform instance. */
function isOwnedGroupContext(contextId: string, platformInstanceId: string): boolean {
  if (parseScopedContextId(contextId)?.platformInstanceId !== platformInstanceId) return false
  return isAuthorizedGroup(contextId)
}

function getKnownGroupLabel(contextId: string): string {
  const row = getDrizzleDb()
    .select({ displayName: knownGroupContexts.displayName })
    .from(knownGroupContexts)
    .where(eq(knownGroupContexts.contextId, contextId))
    .get()
  return row?.displayName ?? getNativeContextId(contextId)
}

function getMemberRowsForUser(chatUserId: string): KaneoWorkspaceMember[] {
  return getDrizzleDb()
    .select()
    .from(kaneoWorkspaceMembers)
    .where(eq(kaneoWorkspaceMembers.chatUserId, chatUserId))
    .all()
}

/** Personal-read scope is the existing gate for a live, authorized principal. */
function requireAuthorizedPrincipal(
  req: Request,
): { ok: true; principal: SettingsPrincipal } | { ok: false; response: Response } {
  const auth = authenticate(req)
  if (!auth.ok) return { ok: false, response: auth.response }
  const access = resolveContextScope(auth.authed.principal, 'read', undefined)
  if (!access.ok) return { ok: false, response: access.response }
  return { ok: true, principal: auth.authed.principal }
}

function handleSelfGet(req: Request): Response {
  const access = requireAuthorizedPrincipal(req)
  if (!access.ok) return access.response

  const { platformInstanceId, platformUserId } = access.principal
  const memberships: MembershipSummary[] = getMemberRowsForUser(platformUserId)
    .filter((row) => isOwnedGroupContext(row.groupContextId, platformInstanceId))
    .map((row) => ({
      contextId: row.groupContextId,
      groupLabel: getKnownGroupLabel(row.groupContextId),
      login: row.login,
      status: row.status,
      kaneoUrl: getKaneoPublicUrl(row.groupContextId),
    }))
    .toSorted((left, right) => left.groupLabel.localeCompare(right.groupLabel))

  return settingsJson(200, { memberships })
}

const SelfRevealBodySchema = z.object({
  action: z.literal('reveal'),
  contextId: z.string(),
})

async function handleSelfPost(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = SelfRevealBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const access = resolveContextScope(auth.authed.principal, 'write', undefined)
  if (!access.ok) return access.response

  const { platformInstanceId, platformUserId } = auth.authed.principal
  const { contextId } = body.data
  // Ownership (context + caller) and non-disclosure: every refusal below is one shape.
  if (!isOwnedGroupContext(contextId, platformInstanceId)) return settingsJson(404, { error: NOT_PROVISIONED_ERROR })

  const row = getKaneoMemberRow(contextId, platformUserId)
  if (row === undefined) return settingsJson(404, { error: NOT_PROVISIONED_ERROR })
  if (row.encryptedPassword === null) {
    return settingsJson(409, {
      error:
        'No stored password for this account. This account was provisioned before credential storage was introduced — ask an admin to re-provision it.',
    })
  }

  const decryptResult = decryptStoredPassword(contextId, row.encryptedPassword)
  if (!decryptResult.ok) return decryptResult.response

  clearStoredPassword(contextId, platformUserId)
  log.info({ contextId, chatUserId: platformUserId }, 'Kaneo member password revealed (self, reveal-once)')
  return settingsJson(200, {
    password: decryptResult.password,
    warning: 'This password is shown once. Store it securely.',
  })
}

export function handleKaneoCredentialsSelfRoutes(req: Request): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleSelfGet(req))
  if (req.method === 'POST') return handleSelfPost(req)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

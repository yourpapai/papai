// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getDrizzleDb } from '../../db/drizzle.js'
import { kaneoWorkspaceMembers, type KaneoWorkspaceMember } from '../../db/schema.js'
import { getContextSettings } from '../../instances/context-store.js'
import { decryptInstanceConfig } from '../../instances/encryption.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
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

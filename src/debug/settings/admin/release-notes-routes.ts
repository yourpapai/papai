// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import packageJson from '../../../../package.json' with { type: 'json' }
import { broadcastAnnouncement } from '../../../announcements/broadcast.js'
import { humanizeChangelog } from '../../../announcements/humanize.js'
import { countSubscribers, getAnnouncementDraft, updateHumanizedBody } from '../../../announcements/store.js'
import { readChangelogFile } from '../../../changelog-reader.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { extractChangelogSection } from '../../../utils/changelog.js'
import { getRuntimeChatRouter } from '../../chat-router-runtime.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-release-notes' })

const VERSION: string = packageJson.version

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('regenerate') }),
  z.object({ action: z.literal('save'), body: z.string().min(1) }),
  z.object({ action: z.literal('broadcast') }),
])

function view(): Response {
  const draft = getAnnouncementDraft(VERSION)
  return settingsJson(200, {
    version: VERSION,
    body: draft?.humanizedBody ?? draft?.rawBody ?? null,
    broadcastAt: draft?.broadcastAt ?? null,
    counts: countSubscribers(),
  })
}

async function resolveRawSection(): Promise<string | null> {
  const draft = getAnnouncementDraft(VERSION)
  if (draft?.rawBody !== null && draft?.rawBody !== undefined && draft.rawBody.length > 0) return draft.rawBody
  try {
    return extractChangelogSection(VERSION, await readChangelogFile())
  } catch {
    return null
  }
}

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return view()
}

async function handlePost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ActionSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (body.data.action === 'save') {
    updateHumanizedBody(VERSION, body.data.body)
    log.info({ version: VERSION }, 'release notes draft saved')
    return view()
  }

  if (body.data.action === 'regenerate') {
    const raw = await resolveRawSection()
    if (raw === null) return settingsJson(422, { error: 'no changelog content for this version' })
    const humanized = await humanizeChangelog(raw)
    if (humanized === null) return settingsJson(422, { error: 'LLM unavailable or returned empty output' })
    updateHumanizedBody(VERSION, humanized)
    log.info({ version: VERSION }, 'release notes draft regenerated')
    return view()
  }

  if (body.data.action === 'broadcast') {
    const draft = getAnnouncementDraft(VERSION)
    const sendBody = draft?.humanizedBody ?? draft?.rawBody
    if (sendBody === null || sendBody === undefined || sendBody.length === 0)
      return settingsJson(422, { error: 'nothing to broadcast' })
    const chat = getRuntimeChatRouter()
    if (chat === null) return settingsJson(422, { error: 'chat router not running' })
    const result = await broadcastAnnouncement(chat, VERSION, sendBody)
    log.info({ version: VERSION, ...result }, 'release notes broadcast')
    return settingsJson(200, { version: VERSION, broadcast: result, counts: countSubscribers() })
  }

  return settingsJson(422, { error: 'invalid request' })
}

export function handleAdminReleaseNotesRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/release-notes') {
    if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
    if (req.method === 'POST') return handlePost(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}

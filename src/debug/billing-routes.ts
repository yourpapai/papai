// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { AdminLlmError, applyAdminLlmUpdate, getAdminLlmSnapshot } from './admin-llm.js'
import { getBillingDetail, listBillingSubjects, parseWindow } from './billing.js'

const log = logger.child({ scope: 'debug-server:billing-routes' })

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export const handleBillingSubjects = (url: URL): Response => {
  const window = parseWindow(url.searchParams.get('window'))
  if (window === null) {
    return jsonResponse(400, { error: 'unknown window' })
  }
  const subjects = listBillingSubjects(window)
  return jsonResponse(200, { window, subjects })
}

export const handleBillingSubject = (url: URL): Response => {
  const window = parseWindow(url.searchParams.get('window'))
  if (window === null) {
    return jsonResponse(400, { error: 'unknown window' })
  }
  const rawId = url.pathname.slice('/billing/subject/'.length)
  if (rawId === '') {
    return jsonResponse(400, { error: 'missing subject id' })
  }
  const subjectId = decodeURIComponent(rawId)
  const detail = getBillingDetail(subjectId, window)
  if (detail === null) {
    return jsonResponse(404, { error: 'subject not found' })
  }
  return jsonResponse(200, { window, ...detail })
}

export const handleAdminLlmGet = (): Response => jsonResponse(200, getAdminLlmSnapshot())

export const handleAdminLlmPost = async (req: Request): Promise<Response> => {
  const debugToken = process.env['DEBUG_TOKEN']
  if (debugToken === undefined || debugToken === '') {
    log.warn('admin/llm POST refused: DEBUG_TOKEN is not set in env')
    return jsonResponse(401, { error: 'credentials API requires DEBUG_TOKEN' })
  }
  const adminUserId = process.env['ADMIN_USER_ID']
  if (adminUserId === undefined || adminUserId === '') {
    log.error('admin/llm POST refused: ADMIN_USER_ID is not set in env')
    return jsonResponse(503, { error: 'admin user id not configured' })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' })
  }

  try {
    const result = applyAdminLlmUpdate(body, adminUserId)
    return jsonResponse(200, { ok: true, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof AdminLlmError) {
      return jsonResponse(400, { error: err.message })
    }
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'admin/llm POST failed')
    return jsonResponse(500, { error: 'internal server error' })
  }
}

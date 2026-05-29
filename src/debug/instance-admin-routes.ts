// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import * as adminStore from '../instances/admin-store.js'
import { getPlatformInstance } from '../instances/platform-store.js'
import { adminSchema, parseBody, splitPath, textResponse } from './instance-route-support.js'
import { jsonResponse } from './json-response.js'

const resolveAdminPlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId !== undefined) return platformInstanceId
  return adminStore.SUPER_ADMIN_PLATFORM_ID
}

export const handleAdmins = async (req: Request, url: URL): Promise<Response | null> => {
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

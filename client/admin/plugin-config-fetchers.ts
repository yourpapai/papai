// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AdminPluginConfigSnapshot, SubmitAdminPluginConfigResponse } from '../shared/api-types.js'
import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  AdminPluginConfigSnapshotSchema,
  SubmitAdminPluginConfigResponseSchema,
} from './plugin-config-fetcher-schemas.js'

export const fetchAdminPluginConfig = async (): Promise<AdminPluginConfigSnapshot> => {
  const res = await fetch('/admin/plugin-config')
  const body = await readBody(res)
  requireOk(res, body)
  return AdminPluginConfigSnapshotSchema.parse(body)
}

export const submitAdminPluginConfig = async (input: {
  pluginId: string
  key: string
  value: string
}): Promise<SubmitAdminPluginConfigResponse> => {
  const res = await fetch('/admin/plugin-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return SubmitAdminPluginConfigResponseSchema.parse(body)
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getPluginAdminConfig } from '../plugins/store.js'

export type ViewerMagiConfig = { baseUrl: string; token: string }

export function getViewerMagiConfig(): ViewerMagiConfig | null {
  const baseUrl = getPluginAdminConfig('acp', 'magi_base_url')
  const token = getPluginAdminConfig('acp', 'magi_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}

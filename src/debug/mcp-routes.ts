// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mcpPool } from '../mcp/client-pool.js'
import { jsonResponse } from './json-response.js'

export function handleMcpStatus(): Response {
  const infos = mcpPool.getServerInfos()
  return jsonResponse({
    servers: infos.map((info) => ({
      ...info,
      url: maskUrl(info.url),
    })),
  })
}

function maskUrl(url: string | null): string | null {
  if (url === null) return null
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
  } catch {
    return '***'
  }
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../cache.js'

const PREFIX = '__admin_mcp_redaction__:'
const KEY = 'mcp_redaction'

export const mcpRedactionConfigSchema = z.object({
  model_url: z.url().refine((u) => u.startsWith('https://'), { message: 'model_url must be https' }),
  api_key: z.string().min(1),
  model_name: z.string().min(1),
  timeout_ms: z.number().int().positive().min(1000).max(600_000).optional(),
})
export type McpRedactionConfig = z.infer<typeof mcpRedactionConfigSchema>

export function adminMcpRedactionContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}

export function resolveMcpRedactionConfig(platformInstanceId: string): McpRedactionConfig | null {
  const raw = getCachedConfig(adminMcpRedactionContextId(platformInstanceId), KEY)
  if (raw === null) return null
  try {
    const parsed = mcpRedactionConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function setMcpRedactionConfig(platformInstanceId: string, config: McpRedactionConfig): void {
  setCachedConfig(
    adminMcpRedactionContextId(platformInstanceId),
    KEY,
    JSON.stringify(mcpRedactionConfigSchema.parse(config)),
  )
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../cache.js'
import { decryptSecretPayload, encryptSecretPayload } from '../secret-payload-crypto.js'

const PREFIX = '__admin_mcp_redaction__:'
const KEY = 'mcp_redaction'
const PAYLOAD_FIELD = 'config'

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
  const encrypted = getCachedConfig(adminMcpRedactionContextId(platformInstanceId), KEY)
  if (encrypted === null) return null
  try {
    const payload = decryptSecretPayload(encrypted)
    const serialized = payload[PAYLOAD_FIELD]
    if (serialized === undefined) return null
    const parsed = mcpRedactionConfigSchema.safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function setMcpRedactionConfig(platformInstanceId: string, config: McpRedactionConfig): void {
  const validated = mcpRedactionConfigSchema.parse(config)
  const encrypted = encryptSecretPayload({ [PAYLOAD_FIELD]: JSON.stringify(validated) })
  setCachedConfig(adminMcpRedactionContextId(platformInstanceId), KEY, encrypted)
}

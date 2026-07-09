// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../cache.js'
import { INTERNAL_SERVER_PREFIX } from './mcp-plugin-servers.js'

const PREFIX = '__admin_mcp_catalog__:'
const KEY = 'mcp_catalog'

export const mcpCatalogEntrySchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_.:/-]+$/u, { message: 'name may only contain letters, digits, and _ . : / -' })
    .refine((name) => !name.startsWith(INTERNAL_SERVER_PREFIX), {
      message: `name must not start with '${INTERNAL_SERVER_PREFIX}' (reserved for internal MCP servers)`,
    }),
  upstream_url: z.url().refine((url) => url.startsWith('https://'), {
    message: 'must be https',
  }),
  header: z.string().optional(),
  default_tool_policy: z.enum(['allow', 'ask', 'deny']),
  tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
})
export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>

export const mcpCatalogSchema = z.array(mcpCatalogEntrySchema)

export function adminMcpCatalogContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}

export function resolveMcpCatalog(platformInstanceId: string): McpCatalogEntry[] {
  const raw = getCachedConfig(adminMcpCatalogContextId(platformInstanceId), KEY)
  if (raw === null) return []
  try {
    const parsed = mcpCatalogSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function setMcpCatalog(platformInstanceId: string, entries: McpCatalogEntry[]): void {
  setCachedConfig(adminMcpCatalogContextId(platformInstanceId), KEY, JSON.stringify(mcpCatalogSchema.parse(entries)))
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const toolFilterSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
})

export type McpToolFilter = z.output<typeof toolFilterSchema>

export const mcpEndpointConfigSchema = z.object({
  id: z.string().min(1),
  url: z.url().refine((url) => url.startsWith('https://'), {
    message: 'URL must use HTTPS',
  }),
  label: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  toolFilter: toolFilterSchema.optional(),
})

export type McpEndpointConfig = z.output<typeof mcpEndpointConfigSchema>

export const mcpPluginConfigSchema = z
  .object({
    transport: z.enum(['streamable-http', 'stdio']),
    url: z.url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    toolFilter: toolFilterSchema.optional(),
    idleTimeoutMs: z.number().int().positive().min(1000).max(3_600_000).optional(),
  })
  .refine(
    (data) => {
      if (data.transport === 'streamable-http') return data.url !== undefined
      if (data.transport === 'stdio') return data.command !== undefined
      return false
    },
    {
      message: 'streamable-http requires url; stdio requires command',
    },
  )

export type McpPluginConfig = z.output<typeof mcpPluginConfigSchema>

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'idle'

export type McpServerInfo = {
  id: string
  label: string | null
  status: McpServerStatus
  toolCount: number
  lastError: string | null
  lastConnectedAt: number | null
  url: string | null
}

export function sanitizeServerId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

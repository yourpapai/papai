// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { INTERNAL_SERVER_PREFIX } from './mcp-plugin-servers.js'
import type { CodingCredentialConfig } from './types.js'

export const codingMcpSelectionSchema = z.object({
  server: z.string().min(1),
  upstream_token: z.string().optional(),
})
export type CodingMcpSelection = z.infer<typeof codingMcpSelectionSchema>

export const codingMcpSelectionsSchema = z.array(codingMcpSelectionSchema)

/** Serialize the selection array into the single `servers` vault field (JSON string). */
export function serializeMcpSelections(selections: CodingMcpSelection[]): string {
  return JSON.stringify(codingMcpSelectionsSchema.parse(selections))
}

/** Parse the `servers` vault field into a selection array. Fail-safe: [] on missing/invalid. */
export function parseMcpSelections(config: CodingCredentialConfig | null): CodingMcpSelection[] {
  const raw = config?.servers
  if (raw === undefined || raw.length === 0) return []
  try {
    const parsed = codingMcpSelectionsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/** Whether a stored non-empty MCP selection payload cannot be parsed as the expected array. */
export function hasMalformedMcpSelections(config: CodingCredentialConfig | null): boolean {
  const raw = config?.servers
  if (raw === undefined || raw.length === 0) return false
  try {
    return !codingMcpSelectionsSchema.safeParse(JSON.parse(raw)).success
  } catch {
    return true
  }
}

/**
 * Token-preserving merge for a PATCH to the `servers` vault field. The client never receives
 * upstream tokens back (see the GET `selections` view), so a kept external row is submitted with
 * `upstream_token` blank/absent to mean "keep the stored one". For each incoming external
 * selection with no (or a blank) token, carry forward the token from the previously stored
 * selection with the same `server` name, if any. Internal (`plugin:`-prefixed) selections never
 * carry a token, incoming or stored — papai mints their credential at resolve time.
 */
export function mergeMcpTokens(incoming: CodingMcpSelection[], stored: CodingMcpSelection[]): CodingMcpSelection[] {
  const storedByServer = new Map(stored.map((sel) => [sel.server, sel]))
  return incoming.map((sel) => {
    if (sel.server.startsWith(INTERNAL_SERVER_PREFIX)) return { server: sel.server }
    const token = sel.upstream_token?.trim()
    if (token !== undefined && token.length > 0) return { server: sel.server, upstream_token: token }
    const preserved = storedByServer.get(sel.server)?.upstream_token?.trim()
    return preserved !== undefined && preserved.length > 0
      ? { server: sel.server, upstream_token: preserved }
      : { server: sel.server }
  })
}

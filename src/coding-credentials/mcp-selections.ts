// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

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
  const raw = (config as Record<string, string | undefined> | null)?.['servers']
  if (raw === undefined || raw.length === 0) return []
  try {
    const parsed = codingMcpSelectionsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

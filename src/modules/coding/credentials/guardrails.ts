// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../../../cache.js'
import { AGENTS } from './types.js'

const PREFIX = '__admin_coding_guardrails__:'
const KEY = 'coding_guardrails'

export const guardrailsSchema = z.object({
  allowedAgents: z.array(z.string()).default([...AGENTS]),
  whoMayUse: z.union([z.literal('members'), z.array(z.string())]).default('members'),
  forceSharedKey: z.boolean().default(false),
})
export type CodingGuardrails = z.infer<typeof guardrailsSchema>

export function adminCodingGuardrailsContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}

const DEFAULTS = (): CodingGuardrails => ({ allowedAgents: [...AGENTS], whoMayUse: 'members', forceSharedKey: false })

export function resolveCodingGuardrails(platformInstanceId: string): CodingGuardrails {
  const raw = getCachedConfig(adminCodingGuardrailsContextId(platformInstanceId), KEY)
  if (raw === null) return DEFAULTS()
  try {
    return guardrailsSchema.parse(JSON.parse(raw))
  } catch {
    return DEFAULTS()
  }
}

export function setCodingGuardrails(platformInstanceId: string, g: CodingGuardrails): void {
  setCachedConfig(adminCodingGuardrailsContextId(platformInstanceId), KEY, JSON.stringify(guardrailsSchema.parse(g)))
}

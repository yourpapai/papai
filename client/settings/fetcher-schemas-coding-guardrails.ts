// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const CodingGuardrailsSchema = z.object({
  allowedAgents: z.array(z.string()),
  whoMayUse: z.union([z.literal('members'), z.array(z.string())]),
  forceSharedKey: z.boolean(),
  maxMcpServers: z.number().int().min(1).max(8).default(3),
})
export const AdminCodingGuardrailsResponseSchema = z.object({
  guardrails: CodingGuardrailsSchema,
  sharedKeySet: z.boolean(),
})
export type AdminCodingGuardrailsResponse = z.infer<typeof AdminCodingGuardrailsResponseSchema>

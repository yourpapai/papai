// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Kaneo member credentials ---

export const KaneoCredentialsSchema = z.object({
  contextId: z.string(),
  login: z.string(),
  status: z.enum(['active', 'inactive', 'failed']),
  kaneoUrl: z.string().nullable(),
})
export type KaneoCredentials = z.infer<typeof KaneoCredentialsSchema>

export const KaneoResetSchema = z.object({
  password: z.string(),
  warning: z.string(),
})
export type KaneoReset = z.infer<typeof KaneoResetSchema>

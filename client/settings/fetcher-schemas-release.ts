// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ReleaseSubscriptionResponseSchema = z.object({ enabled: z.boolean() })
export type ReleaseSubscriptionResponse = z.infer<typeof ReleaseSubscriptionResponseSchema>

export const GroupReleaseSubscriptionResponseSchema = z.object({ contextId: z.string(), enabled: z.boolean() })
export type GroupReleaseSubscriptionResponse = z.infer<typeof GroupReleaseSubscriptionResponseSchema>

export const ReleaseNotesResponseSchema = z.object({
  version: z.string(),
  body: z.string().nullable(),
  broadcastAt: z.string().nullable(),
  counts: z.object({ dm: z.number(), group: z.number() }),
})
export type ReleaseNotesResponse = z.infer<typeof ReleaseNotesResponseSchema>

export const ReleaseBroadcastResultSchema = z.object({
  version: z.string(),
  broadcast: z.object({ sent: z.number(), failed: z.number(), skipped: z.number() }),
  counts: z.object({ dm: z.number(), group: z.number() }),
})
export type ReleaseBroadcastResult = z.infer<typeof ReleaseBroadcastResultSchema>

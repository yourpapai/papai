// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const AdminFeatureFlagStateSchema = z.object({
  result_compaction: z.boolean(),
  progressive_disclosure: z.boolean(),
  semantic_tool_retrieval: z.boolean(),
  cross_thread_memory: z.boolean(),
})

export const AdminFeatureFlagRowSchema = z.object({
  contextId: z.string(),
  kind: z.enum(['user', 'group']),
  label: z.string(),
  platformInstanceLabel: z.string(),
  flags: AdminFeatureFlagStateSchema,
})

export const AdminFeatureFlagsSnapshotSchema = z.object({
  killSwitchEngaged: z.boolean(),
  contexts: z.array(AdminFeatureFlagRowSchema),
})

export type AdminFeatureFlagState = z.infer<typeof AdminFeatureFlagStateSchema>
export type AdminFeatureFlagRow = z.infer<typeof AdminFeatureFlagRowSchema>
export type AdminFeatureFlagsSnapshot = z.infer<typeof AdminFeatureFlagsSnapshotSchema>

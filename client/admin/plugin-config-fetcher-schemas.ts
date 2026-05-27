// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const AdminPluginConfigKeyStateSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  sensitive: z.boolean(),
  required: z.boolean(),
})

const AdminPluginConfigEntrySchema = z.object({
  pluginId: z.string(),
  keys: z.array(AdminPluginConfigKeyStateSchema),
})

export const AdminPluginConfigSnapshotSchema = z.object({
  plugins: z.array(AdminPluginConfigEntrySchema),
})

export const SubmitAdminPluginConfigResponseSchema = z.object({
  ok: z.literal(true),
  pluginId: z.string(),
  key: z.string(),
  updatedAt: z.number(),
})

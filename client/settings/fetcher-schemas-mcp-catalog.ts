// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const ToolPolicySchema = z.enum(['allow', 'ask', 'deny'])

export const AdminMcpCatalogEntrySchema = z.object({
  name: z.string(),
  upstream_url: z.string(),
  host: z.string(),
  header: z.string().optional(),
  default_tool_policy: ToolPolicySchema.optional(),
  tool_policy: z.record(z.string(), ToolPolicySchema).optional(),
})
export type AdminMcpCatalogEntry = z.infer<typeof AdminMcpCatalogEntrySchema>

export const AdminMcpCatalogResponseSchema = z.object({ entries: z.array(AdminMcpCatalogEntrySchema) })
export type AdminMcpCatalogResponse = z.infer<typeof AdminMcpCatalogResponseSchema>

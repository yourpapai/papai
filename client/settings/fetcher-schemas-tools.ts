// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Tools ---

export const ToolRiskSchema = z.enum(['read', 'write', 'destructive', 'open-world'])
export type ToolRisk = z.infer<typeof ToolRiskSchema>

export const ToolPermissionSchema = z.enum(['allow', 'ask', 'deny'])
export type ToolPermission = z.infer<typeof ToolPermissionSchema>

export const ToolPresetSchema = z.enum(['allow-all', 'non-destructive', 'read-only'])
export type ToolPreset = z.infer<typeof ToolPresetSchema>

export const ToolDomainSummarySchema = z.enum(['allow', 'ask', 'deny', 'partial'])
export type ToolDomainSummary = z.infer<typeof ToolDomainSummarySchema>

export const ToolEntrySchema = z.object({
  name: z.string(),
  permission: ToolPermissionSchema,
  risk: ToolRiskSchema,
  group: z.string().optional(),
})

export const ToolDomainSchema = z.object({
  domain: z.string(),
  summary: ToolDomainSummarySchema,
  tools: z.array(ToolEntrySchema),
})

export const ToolsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(ToolDomainSchema),
  activePreset: ToolPresetSchema.nullable().default(null),
  hasStoredDefaults: z.boolean().optional().default(false),
})

export type ToolsResponse = z.infer<typeof ToolsResponseSchema>
export type ToolDomainView = z.infer<typeof ToolDomainSchema>
export type ToolEntry = z.infer<typeof ToolEntrySchema>

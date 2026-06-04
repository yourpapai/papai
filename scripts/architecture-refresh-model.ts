// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const focusedServerAreaIds = [
  'chat',
  'llm-orchestrator',
  'tools',
  'providers/plugins',
  'attachments',
  'message-queue',
  'instances',
  'identity',
  'deferred-prompts',
  'memory/memos',
  'mcp/web',
  'settings/debug',
  'stats/usage',
] as const

export const clientSurfaceIds = ['settings', 'admin', 'debug'] as const

export const areaNodeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  kind: z.enum(['server', 'client']),
  paths: z.array(z.string()),
  dependsOn: z.array(z.string()),
  dependedOnBy: z.array(z.string()),
})

export const architectureLlmSchema = z.object({
  scope: z.object({
    includedRoots: z.array(z.string()),
    excludedPrefixes: z.array(z.string()),
  }),
  rawArtifact: z.literal('raw/dependency-cruiser.json'),
  server: z.object({
    areas: z.array(areaNodeSchema),
    focusedAreaIds: z.array(z.string()),
  }),
  client: z.object({
    surfaces: z.array(areaNodeSchema),
  }),
})

export type FocusedServerAreaId = (typeof focusedServerAreaIds)[number]
export type ClientSurfaceId = (typeof clientSurfaceIds)[number]
export type ArchitectureLlm = z.infer<typeof architectureLlmSchema>

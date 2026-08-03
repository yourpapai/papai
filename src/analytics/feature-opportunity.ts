// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac } from 'node:crypto'

import type { AnalyticsRequestContext } from './provider-observer.js'

export const FEATURE_V1 = [
  'recurring',
  'deferred',
  'memory_write',
  'memory_search',
  'attachment',
  'coding',
  'mcp',
  'byok',
  'guest_mode',
  'web_fetch',
  'live_status',
] as const

export type FeatureV1 = (typeof FEATURE_V1)[number]

export type FeatureOpportunityReason =
  | 'available'
  | 'capability_missing'
  | 'provider_missing'
  | 'role_denied'
  | 'configuration_missing'
  | 'platform_unsupported'
  | 'other'

export const FEATURE_OPPORTUNITY_REFERENCE_DOMAIN = 'feature-opportunity:v1'

export const utcDayOf = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10)

/**
 * Deterministic per-day dedupe reference for feature-opportunity facts:
 * `HMAC(feature-opportunity:v1, actor_basis, feature, utc_day)`. The actor
 * basis is the raw platform identity pair; the normalizer pseudonymizes the
 * resulting event ID, so no raw identity persists.
 */
export const featureOpportunitySourceReference = (input: {
  actorBasis: string
  feature: FeatureV1
  utcDay: string
}): string =>
  createHmac('sha256', FEATURE_OPPORTUNITY_REFERENCE_DOMAIN)
    .update(`${input.actorBasis}|${input.feature}|${input.utcDay}`)
    .digest('hex')

export const actorBasisOf = (requestContext: AnalyticsRequestContext): string =>
  `${requestContext.source.platformInstanceId}|${requestContext.source.chatUserId ?? ''}`

export type FeatureOpportunityInput = Readonly<{
  feature: FeatureV1
  available: boolean
  reason: FeatureOpportunityReason
  nowMs?: number
}>

export type FeatureOpportunitySurface = Readonly<{
  mode: 'normal' | 'proactive'
  contextType: 'dm' | 'group' | undefined
  hasProvider: boolean
  hasChatUser: boolean
  codingPluginActive: boolean
  mcpToolCount: number
}>

const entry = (
  feature: FeatureV1,
  available: boolean,
  unavailableReason: Exclude<FeatureOpportunityReason, 'available'>,
): FeatureOpportunityInput => ({
  feature,
  available,
  reason: available ? 'available' : unavailableReason,
})

/**
 * Pure content-free snapshot of feature availability for one resolved tool
 * surface. Availability derives only from capability/provider/role/
 * configuration/platform flags — never from prior or later tool use.
 */
export const featureOpportunitySnapshot = (surface: FeatureOpportunitySurface): readonly FeatureOpportunityInput[] => {
  const normal = surface.mode === 'normal'
  const memberTools = normal && surface.hasChatUser
  return [
    entry('recurring', normal, 'capability_missing'),
    entry('deferred', normal, 'capability_missing'),
    entry('memory_write', memberTools, 'capability_missing'),
    entry('memory_search', memberTools, 'capability_missing'),
    entry('attachment', normal, 'capability_missing'),
    entry('coding', surface.codingPluginActive, 'configuration_missing'),
    entry('mcp', surface.mcpToolCount > 0, 'configuration_missing'),
    entry('byok', true, 'configuration_missing'),
    entry('guest_mode', surface.contextType === 'group', 'platform_unsupported'),
    entry('web_fetch', true, 'platform_unsupported'),
    entry('live_status', normal, 'platform_unsupported'),
  ]
}

/**
 * Named producer registry: every registered feature maps to one representative
 * named success/failure/blocked producer site plus one opportunity producer.
 * The list is representative, not exhaustive: a feature may have additional
 * co-producers emitting the same observeActiveFeatureUsed call (e.g. 'deferred'
 * is also produced by src/tools/create-alert.ts alongside create-reminder.ts
 * after the reminder/alert split). The closure test asserts this map stays
 * shape-complete (one entry per feature with the four slots); it does not
 * reverse-audit every emit site.
 */
export const FEATURE_PRODUCERS: Readonly<
  Record<FeatureV1, Readonly<{ opportunity: string; success: string; failure: string; blocked: string }>>
> = Object.freeze({
  recurring: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/tools/create-recurring-task.ts#executeCreate',
    failure: 'src/tools/create-recurring-task.ts#executeCreate',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  deferred: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/tools/create-reminder.ts#executeCreate',
    failure: 'src/tools/create-reminder.ts#executeCreate',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  memory_write: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/long-term-memory/capture.ts#runMemoryCapture',
    failure: 'src/long-term-memory/capture.ts#runMemoryCapture',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  memory_search: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/long-term-memory/store.ts#searchMemoryRecords',
    failure: 'src/long-term-memory/store.ts#searchMemoryRecords',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  attachment: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/attachments/store.ts#saveAttachment',
    failure: 'src/attachments/store.ts#saveAttachment',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  coding: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'plugins/acp/session-tools.ts#startSessionTool',
    failure: 'plugins/acp/session-tools.ts#startSessionTool',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  mcp: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/mcp/tool-adapter.ts#convertMcpToolsToToolSet',
    failure: 'src/mcp/tool-adapter.ts#convertMcpToolsToToolSet',
    blocked: 'src/tools/permission-gate.ts#gatedExecute',
  },
  byok: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/debug/settings/byok-routes.ts#handlePutByok',
    failure: 'src/debug/settings/byok-routes.ts#handlePutByok',
    blocked: 'src/debug/settings/byok-routes.ts#handlePutByok',
  },
  guest_mode: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/debug/settings/group-routes.ts#handlePutGroupGuestMode',
    failure: 'src/debug/settings/group-routes.ts#handlePutGroupGuestMode',
    blocked: 'src/debug/settings/group-routes.ts#handlePutGroupGuestMode',
  },
  web_fetch: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/web/fetch-extract.ts#fetchAndExtract',
    failure: 'src/web/fetch-extract.ts#fetchAndExtract',
    blocked: 'src/web/fetch-extract.ts#enforceQuota',
  },
  live_status: {
    opportunity: 'src/tools/index.ts#observeFeatureOpportunities',
    success: 'src/live-status/reporter.ts#startStatus',
    failure: 'src/live-status/reporter.ts#startStatus',
    blocked: 'src/live-status/reporter.ts#startStatus',
  },
})

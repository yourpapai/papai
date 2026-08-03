// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { analyticsEvents } from './analytics-schema.js'

export const analyticsPolicy = sqliteTable('analytics_policy', {
  singletonId: integer('singleton_id').primaryKey(),
  localMode: text('local_mode').notNull().default('local_aggregate'),
  externalAggregateEnabled: integer('external_aggregate_enabled', {
    mode: 'boolean',
  })
    .notNull()
    .default(false),
  externalPseudonymousEnabled: integer('external_pseudonymous_enabled', {
    mode: 'boolean',
  })
    .notNull()
    .default(false),
  policyVersion: integer('policy_version'),
  noticeVersion: integer('notice_version'),
  controllerContact: text('controller_contact'),
  purpose: text('purpose'),
  lawfulBasisMode: text('lawful_basis_mode'),
  retainedEventHorizonDays: integer('retained_event_horizon_days'),
  subjectRightsLookupHorizonDays: integer('subject_rights_lookup_horizon_days').notNull().default(90),
  reviewDateMs: integer('review_date_ms'),
  acknowledgedAtMs: integer('acknowledged_at_ms'),
  policyEffectiveAtMs: integer('policy_effective_at_ms'),
  configVersion: integer('config_version').notNull().default(1),
  updatedAtMs: integer('updated_at_ms').notNull(),
})

export const analyticsPreferences = sqliteTable('analytics_preferences', {
  governanceActorKey: text('governance_actor_key').primaryKey(),
  keyVersion: text('key_version').notNull(),
  localLongitudinal: text('local_longitudinal').notNull().default('unknown'),
  externalPseudonymous: text('external_pseudonymous').notNull().default('unknown'),
  policyVersion: integer('policy_version').notNull(),
  source: text('source').notNull(),
  effectiveAt: integer('effective_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const analyticsPolicyAudit = sqliteTable('analytics_policy_audit', {
  auditId: text('audit_id').primaryKey(),
  governanceActorKey: text('governance_actor_key').notNull(),
  action: text('action').notNull(),
  policyVersion: integer('policy_version').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  result: text('result').notNull(),
  failureClass: text('failure_class'),
})

export const analyticsDeletionRequests = sqliteTable('analytics_deletion_requests', {
  requestId: text('request_id').primaryKey(),
  governanceActorKey: text('governance_actor_key').notNull(),
  keyVersion: text('key_version').notNull(),
  state: text('state').notNull(),
  policyVersion: integer('policy_version').notNull(),
  requestedAtMs: integer('requested_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
})

export const analyticsCollectionEligibility = sqliteTable('analytics_collection_eligibility', {
  refKey: text('ref_key').primaryKey(),
  keyVersion: text('key_version').notNull(),
  state: text('state').notNull(),
  generation: integer('generation').notNull(),
  policyVersion: integer('policy_version').notNull(),
  effectiveAt: integer('effective_at').notNull(),
  revokedAt: integer('revoked_at'),
})

export const analyticsEventCollectionRefs = sqliteTable('analytics_event_collection_refs', {
  eventId: text('event_id')
    .primaryKey()
    .references(() => analyticsEvents.eventId),
  refKey: text('ref_key').notNull(),
  keyVersion: text('key_version').notNull(),
  generation: integer('generation').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const analyticsEligibilityGrants = sqliteTable('analytics_eligibility_grants', {
  grantKey: text('grant_key').primaryKey(),
  keyVersion: text('key_version').notNull(),
  state: text('state').notNull(),
  generation: integer('generation').notNull(),
  policyVersion: integer('policy_version').notNull(),
  effectiveAt: integer('effective_at').notNull(),
  revokedAt: integer('revoked_at'),
})

export const analyticsDeletionTargetBundles = sqliteTable('analytics_deletion_target_bundles', {
  requestId: text('request_id')
    .primaryKey()
    .references(() => analyticsDeletionRequests.requestId),
  targetCiphertext: text('target_ciphertext').notNull(),
  targetHash: text('target_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  destroyedAt: integer('destroyed_at'),
})

export const analyticsActiveGeneration = sqliteTable('analytics_active_generation', {
  singletonId: integer('singleton_id').primaryKey(),
  activeGeneration: text('active_generation').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
})

export const analyticsRekeyRuns = sqliteTable('analytics_rekey_runs', {
  runId: text('run_id').primaryKey(),
  sourceGeneration: text('source_generation').notNull(),
  targetGeneration: text('target_generation').notNull(),
  fromVersions: text('from_versions').notNull(),
  toVersions: text('to_versions').notNull(),
  sourceHighWater: text('source_high_water').notNull(),
  phase: text('phase').notNull(),
  subphase: text('subphase'),
  planHash: text('plan_hash').notNull(),
  status: text('status').notNull(),
  mappedCount: integer('mapped_count').notNull().default(0),
  copiedCount: integer('copied_count').notNull().default(0),
  verifiedCount: integer('verified_count').notNull().default(0),
  swapCompletedAtMs: integer('swap_completed_at_ms'),
  retireNotBeforeMs: integer('retire_not_before_ms'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const analyticsRekeyMappings = sqliteTable(
  'analytics_rekey_mappings',
  {
    runId: text('run_id')
      .notNull()
      .references(() => analyticsRekeyRuns.runId),
    domain: text('domain').notNull(),
    oldKeyHash: text('old_key_hash').notNull(),
    mappingCiphertext: text('mapping_ciphertext').notNull(),
    mappingHash: text('mapping_hash').notNull(),
    state: text('state').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.domain, table.oldKeyHash] })],
)

export const analyticsSnapshotPublications = sqliteTable('analytics_snapshot_publications', {
  snapshotId: text('snapshot_id').primaryKey(),
  storageGeneration: text('storage_generation').notNull(),
  transitionRunId: text('transition_run_id').references(() => analyticsRekeyRuns.runId),
  pathHash: text('path_hash').notNull(),
  sourceHighWater: text('source_high_water').notNull(),
  state: text('state').notNull(),
  publishedAt: integer('published_at'),
  invalidatedAt: integer('invalidated_at'),
})

export type AnalyticsPolicyRow = typeof analyticsPolicy.$inferSelect
export type AnalyticsPreferenceRow = typeof analyticsPreferences.$inferSelect
export type AnalyticsPolicyAuditRow = typeof analyticsPolicyAudit.$inferSelect
export type AnalyticsDeletionRequestRow = typeof analyticsDeletionRequests.$inferSelect
export type AnalyticsCollectionEligibilityRow = typeof analyticsCollectionEligibility.$inferSelect
export type AnalyticsEventCollectionRefRow = typeof analyticsEventCollectionRefs.$inferSelect
export type AnalyticsEligibilityGrantRow = typeof analyticsEligibilityGrants.$inferSelect
export type AnalyticsDeletionTargetBundleRow = typeof analyticsDeletionTargetBundles.$inferSelect
export type AnalyticsActiveGenerationRow = typeof analyticsActiveGeneration.$inferSelect
export type AnalyticsRekeyRunRow = typeof analyticsRekeyRuns.$inferSelect
export type AnalyticsRekeyMappingRow = typeof analyticsRekeyMappings.$inferSelect
export type AnalyticsSnapshotPublicationRow = typeof analyticsSnapshotPublications.$inferSelect

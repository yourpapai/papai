// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getTableName } from 'drizzle-orm'

import {
  analyticsActiveGeneration,
  analyticsCollectionEligibility,
  analyticsDeletionRequests,
  analyticsDeletionTargetBundles,
  analyticsEligibilityGrants,
  analyticsEventCollectionRefs,
  analyticsPolicy,
  analyticsPolicyAudit,
  analyticsPreferences,
  analyticsRekeyMappings,
  analyticsRekeyRuns,
  analyticsSnapshotPublications,
} from '../../src/db/analytics-governance-schema.js'

describe('analytics governance drizzle schema', () => {
  test('maps every governance table name', () => {
    const names = [
      analyticsPolicy,
      analyticsPreferences,
      analyticsPolicyAudit,
      analyticsDeletionRequests,
      analyticsCollectionEligibility,
      analyticsEventCollectionRefs,
      analyticsEligibilityGrants,
      analyticsDeletionTargetBundles,
      analyticsActiveGeneration,
      analyticsRekeyRuns,
      analyticsRekeyMappings,
      analyticsSnapshotPublications,
    ].map((table) => getTableName(table))
    expect(names).toEqual([
      'analytics_policy',
      'analytics_preferences',
      'analytics_policy_audit',
      'analytics_deletion_requests',
      'analytics_collection_eligibility',
      'analytics_event_collection_refs',
      'analytics_eligibility_grants',
      'analytics_deletion_target_bundles',
      'analytics_active_generation',
      'analytics_rekey_runs',
      'analytics_rekey_mappings',
      'analytics_snapshot_publications',
    ])
  })
})

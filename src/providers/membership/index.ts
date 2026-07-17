// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Compatibility facade for consumers that still import the pre-module path.
 * Membership belongs to the task-tracker module; re-exporting it keeps the
 * public kernel boundary stable while callers migrate.
 */
export {
  ensureWorkspaceMember,
  markMemberInactive,
  defaultMembershipDeps,
  type MemberOutcome,
  type MembershipDeps,
  registerMembershipSubscriber,
  type SubscriberHandlers,
  runMembershipBackfill,
  type BackfillResult,
} from '../../modules/task-tracker/membership/index.js'

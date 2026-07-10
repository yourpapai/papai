// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MembershipStore, UserLabelResolver } from '../../ports/membership-store.js'
import {
  defaultMembershipDeps,
  ensureWorkspaceMember,
  markMemberInactive,
  runMembershipBackfill,
} from './membership/index.js'

/** The task-tracker adapter binding the membership store implementation to the port. */
export const taskProviderMembershipStore: MembershipStore = {
  ensureMember: (groupContextId, chatUserId, opts, resolveUserLabel: UserLabelResolver) =>
    ensureWorkspaceMember(groupContextId, chatUserId, { ...defaultMembershipDeps, resolveUserLabel }, opts),
  markMemberInactive: (groupContextId, chatUserId) => {
    markMemberInactive(groupContextId, chatUserId)
  },
  runStartupBackfill: (resolveUserLabel: UserLabelResolver) =>
    runMembershipBackfill({
      ensure: (groupContextId, chatUserId) =>
        ensureWorkspaceMember(groupContextId, chatUserId, { ...defaultMembershipDeps, resolveUserLabel }),
    }),
}

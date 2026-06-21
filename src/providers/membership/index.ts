// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export {
  ensureWorkspaceMember,
  markMemberInactive,
  defaultMembershipDeps,
  type MemberOutcome,
  type MembershipDeps,
} from './ensure-member.js'
export { registerMembershipSubscriber, type SubscriberHandlers } from './subscriber.js'

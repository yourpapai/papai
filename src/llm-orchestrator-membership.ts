// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ActorRole } from './chat/types.js'

/**
 * Returns true when the group-membership backstop should fire for this turn.
 * Guests must never be provisioned a workspace account — they are explicitly
 * excluded from all provisioning paths (guest-mode contract).
 */
export const shouldBackstopGroupMembership = (contextType: 'dm' | 'group', actorRole: ActorRole | undefined): boolean =>
  contextType === 'group' && actorRole !== 'guest'

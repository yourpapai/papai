// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { migration060KaneoWorkspaceMembers } from '../../db/migrations/060_kaneo_workspace_members.js'
import { migration068TaskProviderMembers } from '../../db/migrations/068_task_provider_members.js'
import type { TrustedModule } from '../../ports/module.js'

/**
 * The task-tracker trusted module. It owns the host-side membership store (`task_provider_members`)
 * via `migrations`. Later tasks in this phase add an `onActivate` that registers the membership
 * provisioning behavior into `membershipStorePort` and wires the group-member event subscriber, so
 * the kernel never imports the membership feature directly.
 */
export const taskTrackerModule: TrustedModule = {
  id: 'task-tracker',
  migrations: [migration060KaneoWorkspaceMembers, migration068TaskProviderMembers],
}

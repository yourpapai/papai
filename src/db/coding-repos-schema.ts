// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const codingSessionRepos = sqliteTable(
  'coding_session_repos',
  {
    contextId: text('context_id').notNull(),
    repoId: text('repo_id').notNull(),
    name: text('name').notNull(),
    repoUrl: text('repo_url').notNull(),
    baseBranch: text('base_branch').notNull(),
    permissionPreset: text('permission_preset').notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.contextId, t.repoId] }),
    index('idx_coding_session_repos_name').on(t.contextId, t.name),
  ],
)

export type CodingSessionRepoRow = typeof codingSessionRepos.$inferSelect

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Migration } from '../migrate.js'

const KANEO_WORKSPACE_CONFIG_KEY = 'kaneo_workspace_id'

export const migration042UserWorkspaceConfigBackfill: Migration = {
  id: '042_user_workspace_config_backfill',
  up(db) {
    db.run(
      `
        INSERT OR IGNORE INTO user_config (user_id, key, value)
        SELECT platform_user_id, ?, kaneo_workspace_id
        FROM users
        WHERE kaneo_workspace_id IS NOT NULL
          AND platform_user_id IN (
            SELECT platform_user_id
            FROM users
            GROUP BY platform_user_id
            HAVING COUNT(*) = 1
          )
      `,
      [KANEO_WORKSPACE_CONFIG_KEY],
    )
  },
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Migration } from '../migrate.js'

export const migration048NamespaceKaneoConfig: Migration = {
  id: '048_namespace_kaneo_config',
  up(db) {
    db.run(
      `UPDATE OR IGNORE user_config SET key = 'plugin:task-provider-kaneo:provider:credential' WHERE key = 'kaneo_apikey'`,
    )
    db.run(
      `UPDATE OR IGNORE user_config SET key = 'plugin:task-provider-kaneo:provider:workspaceId' WHERE key = 'kaneo_workspace_id'`,
    )
  },
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Migration } from '../migrate.js'

export const migration049NamespaceYoutrackConfig: Migration = {
  id: '049_namespace_youtrack_config',
  up(db) {
    db.run(
      `UPDATE OR IGNORE user_config SET key = 'plugin:task-provider-youtrack:provider:token' WHERE key = 'youtrack_token'`,
    )
  },
}

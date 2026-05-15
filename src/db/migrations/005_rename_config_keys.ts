// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['kaneo_key', 'kaneo_apikey'],
  ['openai_key', 'llm_apikey'],
  ['openai_base_url', 'llm_baseurl'],
  ['openai_model', 'main_model'],
  ['memory_model', 'small_model'],
]

export const migration005RenameConfigKeys: Migration = {
  id: '005_rename_config_keys',
  up(db: Database): void {
    for (const [oldKey, newKey] of RENAMES) {
      // If the new key already exists for a user, prefer it and drop the old one.
      // Otherwise rename the old key to the new key.
      db.run(
        `DELETE FROM user_config WHERE key = ? AND user_id IN (
          SELECT user_id FROM user_config WHERE key = ?
        )`,
        [oldKey, newKey],
      )
      db.run(`UPDATE user_config SET key = ? WHERE key = ?`, [newKey, oldKey])
    }
  },
}

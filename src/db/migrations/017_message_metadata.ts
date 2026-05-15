// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration017MessageMetadata: Migration = {
  id: '017_message_metadata',
  up(db: Database): void {
    db.run(`
      CREATE TABLE message_metadata (
        context_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        author_id TEXT,
        author_username TEXT,
        text TEXT,
        reply_to_message_id TEXT,
        timestamp INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (context_id, message_id)
      )
    `)
    db.run(`CREATE INDEX idx_message_metadata_expires_at ON message_metadata(expires_at)`)
    db.run(`CREATE INDEX idx_message_metadata_reply_to ON message_metadata(context_id, reply_to_message_id)`)
  },
}

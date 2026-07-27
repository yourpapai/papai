// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:071' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE message_embeddings (
      context_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      embedding_dim INTEGER,
      embedded_at TEXT,
      PRIMARY KEY (context_id, message_id)
    )
  `)
  log.info('migration 071: message_embeddings side table created')
}

export const migration071MessageEmbeddings: Migration = {
  id: '071_message_embeddings',
  up,
}

export default migration071MessageEmbeddings

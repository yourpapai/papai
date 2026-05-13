import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:031' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE staged_files (
      staged_id         TEXT PRIMARY KEY,
      context_id        TEXT NOT NULL,
      message_id        TEXT,
      sender_id         TEXT NOT NULL,
      sender_username   TEXT,
      filename          TEXT NOT NULL,
      mime_type         TEXT,
      size              INTEGER,
      platform_file_id  TEXT NOT NULL,
      source_provider   TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'staged',
      created_at        TEXT NOT NULL,
      expires_at        TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX idx_staged_context_sender ON staged_files(context_id, sender_id, expires_at)`)
  db.run(`CREATE INDEX idx_staged_context_message ON staged_files(context_id, message_id)`)
  db.run(`CREATE INDEX idx_staged_expires_at ON staged_files(expires_at)`)
  log.info('migration 031: staged_files table and indexes created')
}

export const migration031StagedFiles: Migration = {
  id: '031_staged_files',
  up,
}

export default migration031StagedFiles

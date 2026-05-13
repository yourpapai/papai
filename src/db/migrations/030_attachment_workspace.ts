import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:030' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE attachments (
      attachment_id     TEXT PRIMARY KEY,
      context_id        TEXT NOT NULL,
      source_provider   TEXT NOT NULL,
      source_message_id TEXT,
      source_file_id    TEXT,
      filename          TEXT NOT NULL,
      mime_type         TEXT,
      size              INTEGER,
      checksum          TEXT NOT NULL,
      blob_key          TEXT NOT NULL,
      status            TEXT NOT NULL,
      is_active         INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT NOT NULL,
      cleared_at        TEXT,
      last_used_at      TEXT
    )
  `)
  db.run(`CREATE INDEX idx_attachments_context_active ON attachments(context_id, is_active, created_at)`)
  db.run(`CREATE INDEX idx_attachments_context_checksum ON attachments(context_id, checksum)`)
  log.info('migration 030: attachments table and indexes created')
}

export const migration030AttachmentWorkspace: Migration = {
  id: '030_attachment_workspace',
  up,
}

export default migration030AttachmentWorkspace

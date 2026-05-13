import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:032' })

const up = (db: Database): void => {
  db.run(`ALTER TABLE staged_files ADD COLUMN attachment_id TEXT`)
  db.run(`CREATE INDEX idx_staged_attachment ON staged_files(attachment_id)`)
  log.info('migration 032: staged_files.attachment_id column added')
}

export const migration032StagedAttachmentId: Migration = {
  id: '032_staged_attachment_id',
  up,
}

export default migration032StagedAttachmentId

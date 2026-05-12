import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createGroupUserObservationsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE group_user_observations (
      provider TEXT NOT NULL,
      context_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      display_label TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, context_id, user_id)
    )
  `)
  db.run('CREATE INDEX idx_group_user_observations_provider_user ON group_user_observations(provider, user_id)')
}

export const migration028GroupUserObservations: Migration = {
  id: '028_group_user_observations',
  up(db: Database): void {
    createGroupUserObservationsTable(db)
  },
}

export default migration028GroupUserObservations

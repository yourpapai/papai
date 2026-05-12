import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const recreateKnownGroupContexts = (db: Database): void => {
  db.run(`
    CREATE TABLE known_group_contexts_v2 (
      provider      TEXT NOT NULL,
      context_id    TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      parent_name   TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      PRIMARY KEY (provider, context_id)
    )
  `)
  db.run(`
    INSERT INTO known_group_contexts_v2 (
      provider,
      context_id,
      display_name,
      parent_name,
      first_seen_at,
      last_seen_at
    )
    SELECT
      provider,
      context_id,
      display_name,
      parent_name,
      first_seen_at,
      last_seen_at
    FROM known_group_contexts
  `)
  db.run('DROP TABLE known_group_contexts')
  db.run('ALTER TABLE known_group_contexts_v2 RENAME TO known_group_contexts')
  db.run('CREATE INDEX idx_known_group_contexts_provider ON known_group_contexts(provider)')
}

const recreateGroupAdminObservations = (db: Database): void => {
  db.run(`
    CREATE TABLE group_admin_observations_v2 (
      provider     TEXT NOT NULL,
      context_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      username     TEXT,
      is_admin     INTEGER NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (provider, context_id, user_id)
    )
  `)
  db.run(`
    INSERT INTO group_admin_observations_v2 (
      provider,
      context_id,
      user_id,
      username,
      is_admin,
      last_seen_at
    )
    SELECT
      known_group_contexts.provider,
      group_admin_observations.context_id,
      group_admin_observations.user_id,
      group_admin_observations.username,
      group_admin_observations.is_admin,
      group_admin_observations.last_seen_at
    FROM group_admin_observations
    INNER JOIN known_group_contexts ON known_group_contexts.context_id = group_admin_observations.context_id
  `)
  db.run('DROP TABLE group_admin_observations')
  db.run('ALTER TABLE group_admin_observations_v2 RENAME TO group_admin_observations')
  db.run(
    'CREATE INDEX idx_group_admin_observations_user_admin ON group_admin_observations(provider, user_id, is_admin)',
  )
}

export const migration029ProviderScopeGroupObservations: Migration = {
  id: '029_provider_scope_group_observations',
  up(db: Database): void {
    recreateKnownGroupContexts(db)
    recreateGroupAdminObservations(db)
  },
}

export default migration029ProviderScopeGroupObservations

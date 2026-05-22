// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'db:migrate' })

export interface Migration {
  readonly id: string
  up(db: Database): void
}

const extractNumericPrefix = (id: string): number | undefined => {
  const match = id.match(/^\d+/u)
  return match === null ? undefined : Number.parseInt(match[0], 10)
}

const extractBaseName = (id: string): string | undefined => {
  const match = id.match(/^\d+_(.+)$/u)
  return match === null ? undefined : match[1]
}

const validateSingleMigration = (migration: Migration, seenIds: Set<string>, seenBaseNames: Set<string>): void => {
  if (!/^\d+/u.test(migration.id)) {
    throw new Error(`Migration ID must start with a numeric prefix: ${migration.id}`)
  }

  if (seenIds.has(migration.id)) {
    throw new Error(`Migration ${migration.id} has duplicate full ID`)
  }
  seenIds.add(migration.id)

  const baseName = extractBaseName(migration.id)
  if (baseName !== undefined) {
    if (seenBaseNames.has(baseName)) {
      throw new Error(`Migration ${migration.id} has duplicate base name: ${baseName}`)
    }
    seenBaseNames.add(baseName)
  }
}

const validatePairwiseOrder = (current: Migration, previous: Migration): void => {
  const currentNum = extractNumericPrefix(current.id)
  const previousNum = extractNumericPrefix(previous.id)

  if (currentNum === undefined || previousNum === undefined) {
    throw new Error(`Failed to extract numeric prefix from ${current.id} or ${previous.id}`)
  }

  if (currentNum === previousNum) {
    log.error(
      { current: current.id, previous: previous.id },
      'Migration ID prefix conflict: duplicate numeric prefix detected',
    )
    throw new Error(`Migration ${current.id} has duplicate prefix`)
  }

  if (currentNum < previousNum) {
    log.error(
      { current: current.id, previous: previous.id },
      'Migration order violation: migrations must be in ascending order',
    )
    throw new Error(`Migration ${current.id} is out of order`)
  }
}

const validateOrder = (migrations: readonly Migration[]): void => {
  const seenIds = new Set<string>()
  const seenBaseNames = new Set<string>()

  // Per-element check: every migration must have a numeric prefix + no duplicates
  for (const migration of migrations) {
    validateSingleMigration(migration, seenIds, seenBaseNames)
  }

  // Pairwise check: reject equal or decreasing numeric prefixes
  for (let i = 1; i < migrations.length; i++) {
    const current = migrations[i]
    const previous = migrations[i - 1]

    if (current === undefined || previous === undefined) {
      throw new Error('Unexpected undefined migration in pairwise check')
    }

    validatePairwiseOrder(current, previous)
  }
}

const createMigrationsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

const getAppliedIds = (db: Database): Set<string> =>
  new Set(
    db
      .query<{ id: string }, []>(`SELECT id FROM migrations`)
      .all()
      .map((row) => row.id),
  )

const applyMigration = (db: Database, migration: Migration): void => {
  log.debug({ migrationId: migration.id }, 'Applying migration')

  try {
    // NOTE: PRAGMAs cannot run inside transactions and will be silently ignored.
    // If you need PRAGMA settings (like WAL mode), configure them at connection
    // time in src/db/index.ts, not inside migration up() functions.
    db.transaction(() => {
      migration.up(db)

      const appliedAt = new Date().toISOString()
      db.run(`INSERT INTO migrations (id, applied_at) VALUES (?, ?)`, [migration.id, appliedAt])
    })()

    log.debug({ migrationId: migration.id }, 'Migration applied successfully')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error({ migrationId: migration.id, error: errorMessage }, 'Migration failed')
    throw error
  }
}

export const runMigrations = (db: Database, migrations: readonly Migration[]): void => {
  log.debug({ migrationCount: migrations.length }, 'Starting migrations')

  validateOrder(migrations)
  createMigrationsTable(db)

  const appliedIds = getAppliedIds(db)
  const pendingMigrations = migrations.filter((m) => !appliedIds.has(m.id))

  if (pendingMigrations.length === 0) {
    log.info({ pending: 0, alreadyApplied: appliedIds.size }, 'No pending migrations')
    return
  }

  for (const migration of pendingMigrations) {
    applyMigration(db, migration)
  }

  log.info({ appliedCount: pendingMigrations.length }, 'Migrations complete')
}

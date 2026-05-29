// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from './schema.js'

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined
let sqliteInstance: Database | undefined

export const getDrizzleDb = (): ReturnType<typeof drizzle<typeof schema>> => {
  if (dbInstance === undefined) {
    const sqlite = new Database(DB_PATH)
    // WAL mode and foreign keys are set in existing getDb, keep for compatibility
    sqlite.run('PRAGMA journal_mode=WAL')
    sqlite.run('PRAGMA foreign_keys=ON')
    sqliteInstance = sqlite
    dbInstance = drizzle(sqlite, { schema })
  }
  return dbInstance
}

export const closeDrizzleDb = (): void => {
  if (sqliteInstance !== undefined) {
    sqliteInstance.close()
    sqliteInstance = undefined
  } else if (dbInstance !== undefined && '$client' in dbInstance) {
    dbInstance.$client.close()
  }
  dbInstance = undefined
}

/**
 * Reset the Drizzle DB instance. Useful for testing.
 * @internal
 */
export const resetDrizzleDbForTesting = (): void => {
  dbInstance = undefined
  sqliteInstance = undefined
}

/**
 * Set a custom Drizzle DB instance. Useful for testing with in-memory DB.
 * @internal
 */
export const setDrizzleDbForTesting = (db: ReturnType<typeof drizzle<typeof schema>>): void => {
  dbInstance = db
  sqliteInstance = db.$client
}

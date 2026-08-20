// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createTokensTable = (db: Database): void => {
  db.run(`
    CREATE TABLE context_vault_tokens (
      config_context_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      last_used_at INTEGER CHECK(last_used_at IS NULL OR last_used_at >= 0),
      revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at >= 0),
      PRIMARY KEY(config_context_id, token_id)
    )
  `)
  db.run(`
    CREATE INDEX idx_context_vault_tokens_token_hash
      ON context_vault_tokens(token_hash)
  `)
}

const createSpecsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE context_vault_specs (
      config_context_id TEXT NOT NULL,
      id TEXT NOT NULL,
      repo TEXT NOT NULL,
      change_name TEXT NOT NULL,
      one_line TEXT NOT NULL,
      summary TEXT,
      outline TEXT,
      stage TEXT NOT NULL CHECK(stage IN ('draft', 'approved', 'in-progress', 'done')),
      progress_pct INTEGER NOT NULL CHECK(progress_pct BETWEEN 0 AND 100),
      mtime INTEGER NOT NULL CHECK(mtime >= 0),
      source_hash TEXT NOT NULL,
      PRIMARY KEY(config_context_id, id)
    )
  `)
}

const createFilesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE context_vault_files (
      config_context_id TEXT NOT NULL,
      spec_id TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL CHECK(mtime >= 0),
      PRIMARY KEY(config_context_id, spec_id, path)
    )
  `)
}

const createIndexerStateTable = (db: Database): void => {
  db.run(`
    CREATE TABLE context_vault_indexer_state (
      config_context_id TEXT PRIMARY KEY,
      last_push_at INTEGER NOT NULL CHECK(last_push_at >= 0)
    )
  `)
}

const up = (db: Database): void => {
  createTokensTable(db)
  createSpecsTable(db)
  createFilesTable(db)
  createIndexerStateTable(db)
}

export const migration076ContextVault: Migration = {
  id: '076_context_vault',
  up,
}

export default migration076ContextVault

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { runMigrations } from '../../../src/db/migrate.js'
import { migration064CodingSessionRepos } from '../../../src/db/migrations/064_coding_session_repos.js'
import { migration066CodingReposEgress } from '../../../src/db/migrations/066_coding_repos_egress.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

// This migration ALTERs coding_session_repos, so its own dependency chain (owned by the coding
// module) must run first — core MIGRATIONS no longer contains these coding-table migrations.
const CODING_REPOS_MIGRATIONS = [migration064CodingSessionRepos, migration066CodingReposEgress]

describe('migration 066', () => {
  test('has correct id', () => {
    expect(migration066CodingReposEgress.id).toBe('066_coding_repos_egress')
  })

  test('adds additional_egress_domains to coding_session_repos', () => {
    const db = new Database(':memory:')
    runMigrations(db, CODING_REPOS_MIGRATIONS)
    expect(cols(db, 'coding_session_repos')).toContain('additional_egress_domains')
  })

  test("additional_egress_domains defaults to '[]'", () => {
    const db = new Database(':memory:')
    runMigrations(db, CODING_REPOS_MIGRATIONS)
    db.run(
      `INSERT INTO coding_session_repos (context_id, repo_id, name, repo_url, base_branch, permission_preset, updated_at, updated_by) VALUES ('c1', 'r1', 'name1', 'url', 'main', 'preset', 0, 'admin')`,
    )
    const row = db
      .query<{ additional_egress_domains: string }, []>(
        `SELECT additional_egress_domains FROM coding_session_repos WHERE context_id='c1' AND repo_id='r1'`,
      )
      .get()
    expect(row?.additional_egress_domains).toBe('[]')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration064CodingSessionRepos } from '../../../src/db/migrations/064_coding_session_repos.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('migration064CodingSessionRepos', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates coding_session_repos table', () => {
    migration064CodingSessionRepos.up(db)

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name)
    expect(tables).toContain('coding_session_repos')
  })

  test('enforces composite primary key (context_id, repo_id)', () => {
    migration064CodingSessionRepos.up(db)

    db.run(
      `INSERT INTO coding_session_repos VALUES ('ctx1','r1','demo','https://x.com/r.git','main','cautious',1,'u1')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO coding_session_repos VALUES ('ctx1','r1','demo2','https://x.com/r.git','main','cautious',1,'u1')`,
      ),
    ).toThrow()
  })

  test('enforces unique index on (context_id, name)', () => {
    migration064CodingSessionRepos.up(db)

    db.run(
      `INSERT INTO coding_session_repos VALUES ('ctx1','r1','demo','https://x.com/r.git','main','cautious',1,'u1')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO coding_session_repos VALUES ('ctx1','r2','demo','https://x.com/r2.git','main','cautious',1,'u1')`,
      ),
    ).toThrow()
  })

  test('allows same name in different contexts', () => {
    migration064CodingSessionRepos.up(db)

    db.run(
      `INSERT INTO coding_session_repos VALUES ('ctx1','r1','demo','https://x.com/r.git','main','cautious',1,'u1')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO coding_session_repos VALUES ('ctx2','r2','demo','https://x.com/r.git','main','cautious',1,'u1')`,
      ),
    ).not.toThrow()
  })
})

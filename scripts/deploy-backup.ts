// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { rmSync } from 'node:fs'

// Pre-deploy database backup, run *inside* the running papai container via:
//   docker compose exec -T papai bun run - <src> <dest> < scripts/deploy-backup.ts
//
// It is piped over stdin (not baked into the image) on purpose: the backup runs
// against the previously-deployed container, which would not yet contain a newer
// copy of this file. Streaming it in keeps the backup independent of the image
// version, so the very deploy that changes this script still backs up correctly.
//
// The DB runs in WAL mode, so a plain file copy of the main db misses everything
// still in the -wal file. VACUUM INTO produces a consistent single-file snapshot
// that includes committed WAL pages. The copy is then verified before the deploy
// is allowed to proceed; any failure exits non-zero and aborts the deploy.

const [source, dest] = process.argv.slice(2)
if (source === undefined || dest === undefined) {
  throw new Error('usage: bun run - <source-db> <dest-backup>')
}

// VACUUM INTO refuses to overwrite, so clear any leftover from a failed run.
try {
  rmSync(dest)
} catch {
  // nothing to remove
}

const db = new Database(source)
db.run(`VACUUM INTO '${dest.replaceAll("'", "''")}'`)
db.close()

const backup = new Database(dest, { readonly: true })
const integrity = backup.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()
const tables = backup.query<{ c: number }, []>("SELECT count(*) c FROM sqlite_master WHERE type='table'").get()
backup.close()

if (integrity?.integrity_check !== 'ok') {
  throw new Error(`integrity check failed: ${JSON.stringify(integrity)}`)
}
if ((tables?.c ?? 0) < 1) {
  throw new Error('backup has no tables; source missing or empty')
}

console.log(`backup verified: integrity=${integrity.integrity_check} tables=${tables?.c ?? 0}`)

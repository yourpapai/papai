// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const up = (db: Database): void => {
  db.run(`ALTER TABLE context_vault_files ADD COLUMN outline TEXT`)
  db.run(`ALTER TABLE context_vault_files ADD COLUMN tasks_ticked INTEGER`)
  db.run(`ALTER TABLE context_vault_files ADD COLUMN tasks_total INTEGER`)
}

export const migration077ContextVaultFileArtifacts: Migration = {
  id: '077_context_vault_file_artifacts',
  up,
}

export default migration077ContextVaultFileArtifacts

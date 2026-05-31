// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { decryptInstanceConfig, encryptInstanceConfig } from '../../instances/encryption.js'
import type { InstanceConfig } from '../../instances/types.js'
import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

type InstanceConfigRow = Readonly<{ id: string; config: string }>
const log = logger.child({ scope: 'migration:045' })

const withBaseUrlBackfill = (config: InstanceConfig): InstanceConfig => {
  if (config['baseUrl'] !== undefined || config['url'] === undefined) return config
  return { ...config, baseUrl: config['url'] }
}

const backfillRow = (db: Database, table: 'platform_instances' | 'task_instances', row: InstanceConfigRow): void => {
  try {
    const config = decryptInstanceConfig(row.config)
    const nextConfig = withBaseUrlBackfill(config)
    if (nextConfig === config) return
    db.query(`UPDATE ${table} SET config = ? WHERE id = ?`).run(encryptInstanceConfig(nextConfig), row.id)
  } catch (error) {
    log.warn(
      { table, id: row.id, error: error instanceof Error ? error.message : String(error) },
      'migration 045: skipping undecryptable instance row',
    )
  }
}

const backfillBaseUrl = (db: Database, table: 'platform_instances' | 'task_instances'): void => {
  const rows = db.query<InstanceConfigRow, []>(`SELECT id, config FROM ${table}`).all()
  rows.forEach((row) => {
    backfillRow(db, table, row)
  })
}

export const migration045ProviderBaseUrl: Migration = {
  id: '045_provider_base_url',
  up(db) {
    backfillBaseUrl(db, 'platform_instances')
    backfillBaseUrl(db, 'task_instances')
    log.info('migration 045: provider baseUrl backfill complete')
  },
}

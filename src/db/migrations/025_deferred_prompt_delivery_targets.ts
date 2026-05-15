// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration025DeferredPromptDeliveryTargets: Migration = {
  id: '025_deferred_prompt_delivery_targets',
  up(db: Database): void {
    // Rename user_id → created_by_user_id and add delivery columns for scheduled_prompts
    db.run('ALTER TABLE scheduled_prompts RENAME COLUMN user_id TO created_by_user_id')
    db.run('ALTER TABLE scheduled_prompts ADD COLUMN created_by_username TEXT')
    db.run('ALTER TABLE scheduled_prompts ADD COLUMN delivery_context_id TEXT')
    db.run('ALTER TABLE scheduled_prompts ADD COLUMN delivery_context_type TEXT')
    db.run('ALTER TABLE scheduled_prompts ADD COLUMN delivery_thread_id TEXT')
    db.run("ALTER TABLE scheduled_prompts ADD COLUMN audience TEXT NOT NULL DEFAULT 'personal'")
    db.run("ALTER TABLE scheduled_prompts ADD COLUMN mention_user_ids TEXT NOT NULL DEFAULT '[]'")
    db.run('DROP INDEX IF EXISTS idx_scheduled_prompts_user')
    db.run('CREATE INDEX idx_scheduled_prompts_creator ON scheduled_prompts(created_by_user_id)')

    // Same for alert_prompts
    db.run('ALTER TABLE alert_prompts RENAME COLUMN user_id TO created_by_user_id')
    db.run('ALTER TABLE alert_prompts ADD COLUMN created_by_username TEXT')
    db.run('ALTER TABLE alert_prompts ADD COLUMN delivery_context_id TEXT')
    db.run('ALTER TABLE alert_prompts ADD COLUMN delivery_context_type TEXT')
    db.run('ALTER TABLE alert_prompts ADD COLUMN delivery_thread_id TEXT')
    db.run("ALTER TABLE alert_prompts ADD COLUMN audience TEXT NOT NULL DEFAULT 'personal'")
    db.run("ALTER TABLE alert_prompts ADD COLUMN mention_user_ids TEXT NOT NULL DEFAULT '[]'")
    db.run('DROP INDEX IF EXISTS idx_alert_prompts_user')
    db.run('CREATE INDEX idx_alert_prompts_creator ON alert_prompts(created_by_user_id)')
  },
}

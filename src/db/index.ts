// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'db:index' })

import type { Migration } from './migrate.js'
import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from './migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from './migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from './migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from './migrations/006_version_announcements.js'
import { migration007PlatformUserId } from './migrations/007_platform_user_id.js'
import { migration008GroupMembers } from './migrations/008_group_members.js'
import { migration009RecurringTasks } from './migrations/009_recurring_tasks.js'
import { migration010RecurringTaskOccurrences } from './migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from './migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from './migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from './migrations/013_deferred_prompts.js'
import { migration014BackgroundEvents } from './migrations/014_background_events.js'
import { migration015DropBackgroundEvents } from './migrations/015_drop_background_events.js'
import { migration016ExecutionMetadata } from './migrations/016_execution_metadata.js'
import { migration017MessageMetadata } from './migrations/017_message_metadata.js'
import { migration018Memos } from './migrations/018_memos.js'
import { migration019UserIdentityMappings } from './migrations/019_user_identity_mappings.js'
import { migration020GroupSettingsRegistry } from './migrations/020_group_settings_registry.js'
import { migration021WebFetch } from './migrations/021_web_fetch.js'
import { migration022DropUnusedLastSeenIndex } from './migrations/022_drop_unused_last_seen_index.js'
import { migration023AddForeignKeys } from './migrations/023_add_foreign_keys.js'
import { migration024AuthorizedGroups } from './migrations/024_authorized_groups.js'
import { migration025DeferredPromptDeliveryTargets } from './migrations/025_deferred_prompt_delivery_targets.js'
import { migration026RruleUnification } from './migrations/026_rrule_unification.js'
import { migration027ScheduledPromptTimezone } from './migrations/027_scheduled_prompt_timezone.js'
import { migration028GroupUserObservations } from './migrations/028_group_user_observations.js'
import { migration029ProviderScopeGroupObservations } from './migrations/029_provider_scope_group_observations.js'
import { migration030AttachmentWorkspace } from './migrations/030_attachment_workspace.js'
import { migration031StagedFiles } from './migrations/031_staged_files.js'
import { migration032StagedAttachmentId } from './migrations/032_staged_attachment_id.js'
import { migration033StagedFilesUniquePlatformContext } from './migrations/033_staged_files_unique_platform_context.js'
import { migration034SystemConfig } from './migrations/034_system_config.js'
import { migration036DropUserLlmConfig } from './migrations/036_drop_user_llm_config.js'

const getDbPath = (): string => {
  const dbPath = process.env['DB_PATH']
  if (dbPath === undefined || dbPath === '') {
    return 'papai.db'
  }
  return dbPath
}

const DB_PATH = getDbPath()

let migrationDbInstance: Database | undefined

const getMigrationDb = (): Database => {
  if (migrationDbInstance === undefined) {
    migrationDbInstance = new Database(DB_PATH)
    // WAL mode is set here rather than in migrations because it must be
    // configured per-database-connection, not per-database-file. This ensures
    // WAL is active immediately on first connection, before any migrations run.
    migrationDbInstance.run('PRAGMA journal_mode=WAL')
    migrationDbInstance.run('PRAGMA foreign_keys=ON')
    log.info({ dbPath: DB_PATH }, 'Database connection created for migrations')
  }
  return migrationDbInstance
}

const closeMigrationDb = (): void => {
  if (migrationDbInstance !== undefined) {
    migrationDbInstance.close()
    migrationDbInstance = undefined
    log.info({ dbPath: DB_PATH }, 'Migration database connection closed')
  }
}

export const MIGRATIONS: readonly Migration[] = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020GroupSettingsRegistry,
  migration021WebFetch,
  migration022DropUnusedLastSeenIndex,
  migration023AddForeignKeys,
  migration024AuthorizedGroups,
  migration025DeferredPromptDeliveryTargets,
  migration026RruleUnification,
  migration027ScheduledPromptTimezone,
  migration028GroupUserObservations,
  migration029ProviderScopeGroupObservations,
  migration030AttachmentWorkspace,
  migration031StagedFiles,
  migration032StagedAttachmentId,
  migration033StagedFilesUniquePlatformContext,
  migration034SystemConfig,
  migration036DropUserLlmConfig,
]

export const initDb = (): void => {
  runMigrations(getMigrationDb(), MIGRATIONS)
}

export const closeMigrationDbInstance = (): void => {
  closeMigrationDb()
}

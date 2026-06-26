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
import { migration035LlmUsageEvents } from './migrations/035_llm_usage_events.js'
import { migration036DropUserLlmConfig } from './migrations/036_drop_user_llm_config.js'
import { migration037ToolCallEvents } from './migrations/037_tool_call_events.js'
import { migration038LlmUsageEventsOutbox } from './migrations/038_llm_usage_events_outbox.js'
import { migration039Plugins } from './migrations/039_plugins.js'
import { migration040PlatformInstances } from './migrations/040_platform_instances.js'
import { migration041UsersPlatformInstanceIndex } from './migrations/041_users_platform_instance_index.js'
import { migration042UserWorkspaceConfigBackfill } from './migrations/042_user_workspace_config_backfill.js'
import { migration043ScopedContextIds } from './migrations/043_scoped_context_ids.js'
import { migration044InstanceIntegrity } from './migrations/044_instance_integrity.js'
import { migration045ProviderBaseUrl } from './migrations/045_provider_base_url.js'
import { migration046ParentSharedContextEntities } from './migrations/046_parent_shared_context_entities.js'
import { migration047DashboardSessions } from './migrations/047_dashboard_sessions.js'
import { migration048NamespaceKaneoConfig } from './migrations/048_namespace_kaneo_config.js'
import { migration049NamespaceYoutrackConfig } from './migrations/049_namespace_youtrack_config.js'
import { migration050SettingsAuth } from './migrations/050_settings_auth.js'
import { migration051LegacyContextIdBackfill } from './migrations/051_legacy_context_id_backfill.js'
import { migration052ByokLlmCredentials } from './migrations/052_byok_llm_credentials.js'
import { migration053LongTermMemory } from './migrations/053_long_term_memory.js'
import { migration054AttachmentOrigin } from './migrations/054_attachment_origin.js'
import { migration055UserConfigKeyIndex } from './migrations/055_user_config_key_index.js'
import { migration056ProvisionalMemory } from './migrations/056_provisional_memory.js'
import { migration057AttachmentGroupContext } from './migrations/057_attachment_group_context.js'
import { migration058OpenDmAccess } from './migrations/058_open_dm_access.js'
import { migration059GuestMode } from './migrations/059_guest_mode.js'
import { migration060KaneoWorkspaceMembers } from './migrations/060_kaneo_workspace_members.js'
import { migration061CodingSessionCredentials } from './migrations/061_coding_session_credentials.js'
import { migration062NullableContextTaskInstance } from './migrations/062_nullable_context_task_instance.js'
import { migration063ReleaseAnnouncements } from './migrations/063_release_announcements.js'
import { migration064CodingSessionRepos } from './migrations/064_coding_session_repos.js'

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
  migration035LlmUsageEvents,
  migration036DropUserLlmConfig,
  migration037ToolCallEvents,
  migration038LlmUsageEventsOutbox,
  migration039Plugins,
  migration040PlatformInstances,
  migration041UsersPlatformInstanceIndex,
  migration042UserWorkspaceConfigBackfill,
  migration043ScopedContextIds,
  migration044InstanceIntegrity,
  migration045ProviderBaseUrl,
  migration046ParentSharedContextEntities,
  migration047DashboardSessions,
  migration048NamespaceKaneoConfig,
  migration049NamespaceYoutrackConfig,
  migration050SettingsAuth,
  migration051LegacyContextIdBackfill,
  migration052ByokLlmCredentials,
  migration053LongTermMemory,
  migration054AttachmentOrigin,
  migration055UserConfigKeyIndex,
  migration056ProvisionalMemory,
  migration057AttachmentGroupContext,
  migration058OpenDmAccess,
  migration059GuestMode,
  migration060KaneoWorkspaceMembers,
  migration061CodingSessionCredentials,
  migration062NullableContextTaskInstance,
  migration063ReleaseAnnouncements,
  migration064CodingSessionRepos,
]

export const initDb = (): void => {
  runMigrations(getMigrationDb(), MIGRATIONS)
}

export const closeMigrationDbInstance = (): void => {
  closeMigrationDb()
}

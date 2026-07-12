// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Global mock reset preload.
 *
 * Captures real exports of all commonly-mocked modules at startup (before any
 * test file can mock them), then restores originals in a global beforeEach.
 * Individual test files override in their own describe-level beforeEach.
 *
 * Order per test:
 *   global beforeEach (restore originals) -> file beforeEach (apply mocks) -> test -> global afterEach (restore spies/originals)
 */

import { afterEach, beforeEach, mock } from 'bun:test'

import * as _openaiCompat from '@ai-sdk/openai-compatible'
import * as _ai from 'ai'

import * as _provision from '../plugins/task-provider-kaneo/provision.js'
// Additional modules mocked by tests/index.test.ts (graceful shutdown tests).
// Bun's mock.module() is process-wide, so any module mocked there leaks into
// subsequent test files. Capturing originals here lets the global beforeEach
// restore them before each test.
import * as _announcements from '../src/announcements.js'
// Capture real module exports BEFORE any test file loads.
// Spread into plain objects to snapshot current values.
import { createInMemoryBlobStoreForTesting, setBlobStoreForTesting } from '../src/attachments/blob-store.js'
import * as _attachmentsIndex from '../src/attachments/index.js'
import * as _stagedDownload from '../src/attachments/staged-download.js'
import * as _authorizedGroups from '../src/authorized-groups.js'
import * as _bot from '../src/bot.js'
import * as _interactionRouter from '../src/chat/interaction-router.js'
import * as _chatMattermost from '../src/chat/mattermost/index.js'
import * as _chatRegistry from '../src/chat/registry.js'
import * as _chatRouter from '../src/chat/router.js'
import * as _chatStartup from '../src/chat/startup.js'
import * as _chatTelegram from '../src/chat/telegram/index.js'
import { resetDrizzleDbForTesting } from '../src/db/drizzle.js'
import * as _dbDrizzle from '../src/db/drizzle.js'
import * as _dbIndex from '../src/db/index.js'
import * as _chatRouterRuntime from '../src/debug/chat-router-runtime.js'
import * as _debugServer from '../src/debug/server.js'
import * as _poller from '../src/deferred-prompts/poller.js'
import * as _scheduledPrompts from '../src/deferred-prompts/scheduled.js'
import * as _identityMapping from '../src/identity/mapping.js'
import * as _instancesBootstrap from '../src/instances/bootstrap.js'
import * as _platformStore from '../src/instances/platform-store.js'
import * as _taskStore from '../src/instances/task-store.js'
import * as _llmModelBuilder from '../src/llm-model-builder.js'
import * as _logger from '../src/logger.js'
import * as _mcpIndex from '../src/mcp/index.js'
import * as _mcpPluginEndpoints from '../src/mcp/plugin-endpoints.js'
import * as _mcpToolAdapter from '../src/mcp/tool-adapter.js'
import * as _mcpUserEndpoints from '../src/mcp/user-endpoints.js'
import * as _memos from '../src/memos.js'
import * as _messageCache from '../src/message-cache/cache.js'
import * as _messageCacheIndex from '../src/message-cache/index.js'
import * as _messageQueueIndex from '../src/message-queue/index.js'
import * as _pluginDiscovery from '../src/plugins/discovery.js'
import * as _pluginLoader from '../src/plugins/loader.js'
import * as _pluginRegistry from '../src/plugins/registry.js'
import * as _pluginStartupGuard from '../src/plugins/startup-guard.js'
import * as _providerMembership from '../src/providers/membership/index.js'
import * as _taskProviderResolver from '../src/providers/resolver.js'
import * as _recurring from '../src/recurring.js'
import * as _schedulerInstance from '../src/scheduler-instance.js'
import * as _scheduler from '../src/scheduler.js'
import * as _systemConfig from '../src/system-config.js'
import * as _toolsIndex from '../src/tools/index.js'
import * as _usageIndex from '../src/usage/index.js'
import * as _users from '../src/users.js'

const originals: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['../src/logger.js', { ..._logger }],
  ['../src/message-cache/cache.js', { ..._messageCache }],
  ['../plugins/task-provider-kaneo/provision.js', { ..._provision }],
  ['../src/chat/interaction-router.js', { ..._interactionRouter }],
  ['ai', { ..._ai }],
  ['@ai-sdk/openai-compatible', { ..._openaiCompat }],
  ['../src/llm-model-builder.js', { ..._llmModelBuilder }],
  ['../src/announcements.js', { ..._announcements }],
  ['../src/attachments/index.js', { ..._attachmentsIndex }],
  ['../src/attachments/staged-download.js', { ..._stagedDownload }],
  ['../src/authorized-groups.js', { ..._authorizedGroups }],
  ['../src/bot.js', { ..._bot }],
  ['../src/chat/mattermost/index.js', { ..._chatMattermost }],
  ['../src/chat/registry.js', { ..._chatRegistry }],
  ['../src/chat/router.js', { ..._chatRouter }],
  ['../src/chat/startup.js', { ..._chatStartup }],
  ['../src/chat/telegram/index.js', { ..._chatTelegram }],
  ['../src/db/drizzle.js', { ..._dbDrizzle }],
  ['../src/db/index.js', { ..._dbIndex }],
  ['../src/debug/chat-router-runtime.js', { ..._chatRouterRuntime }],
  ['../src/debug/server.js', { ..._debugServer }],
  ['../src/deferred-prompts/scheduled.js', { ..._scheduledPrompts }],
  ['../src/deferred-prompts/poller.js', { ..._poller }],
  ['../src/identity/mapping.js', { ..._identityMapping }],
  ['../src/instances/bootstrap.js', { ..._instancesBootstrap }],
  ['../src/instances/platform-store.js', { ..._platformStore }],
  ['../src/instances/task-store.js', { ..._taskStore }],
  ['../src/memos.js', { ..._memos }],
  ['../src/message-cache/index.js', { ..._messageCacheIndex }],
  ['../src/message-queue/index.js', { ..._messageQueueIndex }],
  ['../src/mcp/index.js', { ..._mcpIndex }],
  ['../src/mcp/plugin-endpoints.js', { ..._mcpPluginEndpoints }],
  ['../src/mcp/tool-adapter.js', { ..._mcpToolAdapter }],
  ['../src/mcp/user-endpoints.js', { ..._mcpUserEndpoints }],
  ['../src/plugins/discovery.js', { ..._pluginDiscovery }],
  ['../src/plugins/loader.js', { ..._pluginLoader }],
  ['../src/plugins/registry.js', { ..._pluginRegistry }],
  ['../src/plugins/startup-guard.js', { ..._pluginStartupGuard }],
  ['../src/providers/membership/index.js', { ..._providerMembership }],
  ['../src/providers/resolver.js', { ..._taskProviderResolver }],
  ['../src/recurring.js', { ..._recurring }],
  ['../src/scheduler.js', { ..._scheduler }],
  ['../src/scheduler-instance.js', { ..._schedulerInstance }],
  ['../src/system-config.js', { ..._systemConfig }],
  ['../src/tools/index.js', { ..._toolsIndex }],
  ['../src/usage/index.js', { ..._usageIndex }],
  ['../src/users.js', { ..._users }],
]

const restoreOriginalModules = (): void => {
  for (const [path, exports] of originals) {
    void mock.module(path, () => ({ ...exports }))
  }
}

beforeEach(() => {
  resetDrizzleDbForTesting()
  // The system_config cache is a module-level Map that survives across test files
  // in serial mode (`bun test`, CI). Clearing it here keeps serial runs matching
  // the isolated (`--parallel`) per-file processes, so a config-seeding file can't
  // leave LLM credentials visible to a later file that assumes none are configured.
  _systemConfig.systemConfigCacheForTesting.clear()
  setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  process.env['S3_BUCKET'] = 'test-bucket'
  process.env['S3_ACCESS_KEY_ID'] = 'test-key'
  process.env['S3_SECRET_ACCESS_KEY'] = 'test-secret'
  restoreOriginalModules()
})

afterEach(() => {
  mock.restore()
  restoreOriginalModules()
  delete process.env['S3_BUCKET']
  delete process.env['S3_ACCESS_KEY_ID']
  delete process.env['S3_SECRET_ACCESS_KEY']
})

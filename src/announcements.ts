// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import packageJson from '../package.json' with { type: 'json' }
import { humanizeChangelog as defaultHumanizeChangelog } from './announcements/humanize.js'
import {
  upsertAnnouncementDraft as defaultUpsertDraft,
  updateHumanizedBody as defaultUpdateHumanizedBody,
} from './announcements/store.js'
import { readChangelogFile as defaultReadChangelogFile } from './changelog-reader.js'
import type { ChatProvider } from './chat/types.js'
import { dmTarget } from './chat/types.js'
import { getDrizzleDb } from './db/drizzle.js'
import { versionAnnouncements } from './db/schema.js'
import { logger } from './logger.js'
import { extractChangelogSection } from './utils/changelog.js'

export interface AnnouncementsDeps {
  readChangelogFile: () => Promise<string>
  humanizeChangelog: (rawSection: string) => Promise<string | null>
  // synchronous (SQLite); call site does not await
  persistDraft: (input: { version: string; rawBody: string; humanizedBody: string | null }) => void
  // synchronous (SQLite)
  updateHumanizedBody: (version: string, body: string) => void
  isVersionAnnounced: (version: string) => boolean
}

function defaultIsVersionAnnounced(version: string): boolean {
  const row = getDrizzleDb().select().from(versionAnnouncements).where(eq(versionAnnouncements.version, version)).get()
  return row !== undefined
}

const defaultAnnouncementsDeps: AnnouncementsDeps = {
  readChangelogFile: defaultReadChangelogFile,
  humanizeChangelog: defaultHumanizeChangelog,
  persistDraft: defaultUpsertDraft,
  updateHumanizedBody: defaultUpdateHumanizedBody,
  isVersionAnnounced: defaultIsVersionAnnounced,
}

const log = logger.child({ scope: 'announcements' })

const VERSION: string = packageJson.version
type RouterInstanceLookup = { getInstance: (id: string) => unknown }

const hasRouterInstanceLookup = (chat: ChatProvider): chat is ChatProvider & RouterInstanceLookup =>
  typeof Reflect.get(chat, 'getInstance') === 'function'

async function sendAnnouncementToAdmin(
  platformInstanceId: string,
  adminUserId: string,
  markdown: string,
  chat: ChatProvider,
): Promise<boolean> {
  try {
    if (hasRouterInstanceLookup(chat)) {
      const instance = chat.getInstance(platformInstanceId)
      if (instance === undefined || instance === null) return false
    }
    const result = await chat.sendMessage(platformInstanceId, dmTarget(adminUserId), markdown)
    if (result === false) return false
    log.debug({ version: VERSION }, 'Announcement review notice sent to admin')
    return true
  } catch (error) {
    log.warn(
      { version: VERSION, error: error instanceof Error ? error.message : String(error) },
      'Failed to send announcement review notice to admin',
    )
    return false
  }
}

/**
 * Detect a new version, humanize its changelog once, persist the draft, and DM
 * the admin a review notice. The dedup anchor (rawBody, humanizedBody: null) is
 * persisted immediately after the dedup check and BEFORE the LLM humanization
 * call, so a concurrent process (rolling restart) cannot pass the dedup check
 * and trigger a duplicate LLM call or duplicate admin DM. On DM failure the
 * admin reviews/broadcasts from Settings → Release notes. Does NOT fan out to
 * subscribers.
 */
export async function announceNewVersion(
  chat: ChatProvider,
  platformInstanceId: string,
  adminUserId: string,
  ...args: [] | [deps: AnnouncementsDeps]
): Promise<void> {
  log.debug({ version: VERSION }, 'Checking if version announcement is needed')

  const deps = args.length === 0 ? defaultAnnouncementsDeps : args[0]
  const rawSection = await loadChangelogSection(deps)
  if (rawSection === null) return

  if (deps.isVersionAnnounced(VERSION)) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }

  log.info({ version: VERSION }, 'Humanizing changelog and notifying admin')

  deps.persistDraft({ version: VERSION, rawBody: rawSection, humanizedBody: null })
  const humanized = await deps.humanizeChangelog(rawSection)
  if (humanized !== null) deps.updateHumanizedBody(VERSION, humanized)

  const draftBody = humanized ?? rawSection
  const message =
    `🆕 papai v${VERSION} is ready to announce!\n\n${draftBody}\n\n` +
    `_Review and broadcast to subscribers in Settings → Release notes._`
  const success = await sendAnnouncementToAdmin(platformInstanceId, adminUserId, message, chat)

  log.info({ version: VERSION, success, humanized: humanized !== null }, 'Version announcement notice complete')
}

async function loadChangelogSection(deps: AnnouncementsDeps): Promise<string | null> {
  let changelogContent: string
  try {
    changelogContent = await deps.readChangelogFile()
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Could not read CHANGELOG.md')
    return null
  }

  const section = extractChangelogSection(VERSION, changelogContent)
  if (section === null) {
    log.warn({ version: VERSION }, 'No changelog section found for version, skipping announcement')
    return null
  }
  return section
}
